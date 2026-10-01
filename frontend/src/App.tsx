import { AcademicPanel, AcademicSummary, useAcademic } from './Academic'
import { generateTimetables as runTimetableEngine } from '../../engine-b/src/index.ts'
import { useEffect, useMemo, useRef, useState } from 'react'
import collegeByDepartment from './department-colleges.json'
import './App.css'
import creditExemptions from './credit-exemptions.json'

type Day = 'MON' | 'TUE' | 'WED' | 'THU' | 'FRI' | 'SAT' | 'SUN'
type TimeSlot = { day: Day; startTime: string; endTime: string; classroom?: string | null }
type Section = { creditLimitExcluded?: boolean; sectionId: string; days: TimeSlot[]; classroom: string | null; professor?: string | null; timeStatus?: 'parsed' | 'missing' | 'partial' | 'failed' }
type Course = { courseId: string; courseName: string; credits: number; category: string; requirement: 'required' | 'optional'; sections: Section[]; mustInclude?: boolean; departments: string[]; targetGrades: string[]; detailCategories: string[]; isElearning: boolean; offeringDepartments: string[] }
type TimetableRequest = { semester: string; major: string; grade: number | null; courses: Array<Omit<Course, 'departments' | 'targetGrades' | 'detailCategories' | 'isElearning' | 'offeringDepartments'>>; conditions: { minCredits: number | null; maxCredits: number | null; unavailableTimes: TimeSlot[]; maxGapMinutes?: number | null; maxDailyMinutes?: number | null } }
type TimetableResponse = { candidates: Array<{ candidateId: string; totalCredits: number; sections: Array<{ courseId: string; sectionId: string }>; summary: { classDays: number; lastClassTime: string | null; travelWarnings: string[] } }>; message?: string }
type CsvRow = Record<string, string>
type WalkingRoute = { fromBuilding: string; toBuilding: string; distanceMeters: number; minutes: number }
type Candidate = TimetableResponse['candidates'][number]
type Area = '전체' | '전공' | '교양(기초)' | '교양(소양)' | '교양(심화)' | '이러닝' | '자선' | '교직' | '기타'
const areaTabs: Area[] = ['전체', '전공', '교양(기초)', '교양(소양)', '교양(심화)', '이러닝', '자선', '교직', '기타']
const detailCategoriesByArea: Record<string, string[]> = { '교양(기초)': ['발표와토론', '외국어기초', '글쓰기', '인문기초', '과학기초'], '교양(소양)': ['실무', '실기', '인성'], '교양(심화)': ['글로벌언어', '인간과문화', '인간과사회', '과학과기술', '예술과체육', '신문과미디어', '융복합', 'AI/데이터'] }

const csvUrl = 'https://raw.githubusercontent.com/alswo412m/hyunwoo/main/timetable_data/건국대_GLOCAL_전체강좌_이수구분_2026_2.csv'
const walkingCsvUrl = 'https://raw.githubusercontent.com/alswo412m/hyunwoo/main/campus_data/건국대_글로컬_도보경로.csv'
const dayMap: Record<string, Day> = { '월': 'MON', '화': 'TUE', '수': 'WED', '목': 'THU', '금': 'FRI', '토': 'SAT', '일': 'SUN' }
const weekdayNames: Record<Day, string> = { MON: '월', TUE: '화', WED: '수', THU: '목', FRI: '금', SAT: '토', SUN: '일' }

function parseCsv(text: string): CsvRow[] {
  const rows: string[][] = []
  let row: string[] = []
  let field = ''
  let quoted = false
  for (let i = 0; i < text.length; i += 1) {
    const char = text[i]
    if (char === '"') {
      if (quoted && text[i + 1] === '"') { field += '"'; i += 1 }
      else quoted = !quoted
    } else if (char === ',' && !quoted) {
      row.push(field); field = ''
    } else if ((char === '\n' || char === '\r') && !quoted) {
      if (char === '\r' && text[i + 1] === '\n') i += 1
      row.push(field); rows.push(row); row = []; field = ''
    } else field += char
  }
  if (field || row.length) { row.push(field); rows.push(row) }
  const headers = (rows.shift() ?? []).map((value, index) => index === 0 ? value.replace(/^\uFEFF/, '') : value).map((value) => value.trim())
  return rows.filter((values) => values.some((value) => value.trim())).map((values) => Object.fromEntries(headers.map((header, index) => [header, (values[index] ?? '').trim()])))
}

function toTime(value: string): string | null {
  const digits = value.padStart(4, '0')
  const hour = Number(digits.slice(0, -2))
  const minute = Number(digits.slice(-2))
  if (hour > 23 || minute > 59) return null
  return String(hour).padStart(2, '0') + ':' + String(minute).padStart(2, '0')
}

function parseMeetingTime(value: string): { days: TimeSlot[]; classroom: string | null; timeStatus: Section['timeStatus'] } {
  const days: TimeSlot[] = []
  let classroom: string | null = null
  const pattern = /([월화수목금토일]+)\s*(\d{3,4})\s*-\s*(\d{3,4})\s*(?:\(([^)]*)\))?/g
  let match: RegExpExecArray | null
  while ((match = pattern.exec(value)) !== null) {
    const startTime = toTime(match[2])
    const endTime = toTime(match[3])
    if (!startTime || !endTime || startTime >= endTime) continue
    const room = match[4]?.trim() || null
    if (!classroom && room) classroom = room
    for (const koreanDay of match[1]) {
      const day = dayMap[koreanDay]
      if (day && !days.some((slot) => slot.day === day && slot.startTime === startTime && slot.endTime === endTime)) {
        days.push({ day, startTime, endTime, classroom: room })
      }
    }
  }
  return { days, classroom, timeStatus: days.length ? 'parsed' : value.trim() ? 'failed' : 'missing' }
}

function groupCourses(rows: CsvRow[]): Course[] {
  const byId = new Map<string, Course>()
  rows.filter((row) => !row['폐강여부'] || row['폐강여부'].includes('정상')).forEach((row, index) => {
    const courseId = row['학수번호'] || row['과목번호'] || 'unknown-' + index
    const courseName = row['교과목명'] || '과목명 없음'
    const category = row['이수구분'] || row['대분류'] || '구분 없음'
    const credits = Number(row['학점']) || 0
    const course = byId.get(courseId) || { courseId, courseName, credits, category, requirement: 'optional' as const, sections: [], departments: [], targetGrades: [], detailCategories: [], isElearning: false, offeringDepartments: [] }
    const offeringDepartment = row['개설학과']?.trim(); if (offeringDepartment && !course.offeringDepartments.includes(offeringDepartment)) course.offeringDepartments.push(offeringDepartment); const departmentText = [row['개설학과'], row['수강대상학과_원문']].filter(Boolean).join(',')
    for (const department of departmentText.split(',').map((value) => value.trim()).filter(Boolean)) if (!course.departments.includes(department)) course.departments.push(department)
    for (const year of (row['대상학년'] || '').match(/\d+/g) || []) if (!course.targetGrades.includes(year)) course.targetGrades.push(year); const tags = (row['조회분류'] || '').split('|').map((tag) => tag.trim()).filter(Boolean); if (tags.includes('이러닝')) course.isElearning = true; for (const tag of tags) if (tag !== '이러닝' && !course.detailCategories.includes(tag)) course.detailCategories.push(tag)
    const number = row['분반'] || row['과목번호'] || '미정'
    const sectionId = [courseId, row['과목번호'], number, row['담당교수']].join(':')
    const rawTime = row['강의시간_강의실'] || ''
    const parsed = parseMeetingTime(rawTime)
    const existing = course.sections.find((section) => section.sectionId === sectionId)
    if (existing) {
      for (const slot of parsed.days) if (!existing.days.some((item) => item.day === slot.day && item.startTime === slot.startTime && item.endTime === slot.endTime)) existing.days.push(slot)
      if (!existing.classroom && parsed.classroom) existing.classroom = parsed.classroom
    } else {
      course.sections.push({ sectionId, days: parsed.days, classroom: parsed.classroom, professor: row['담당교수'] || null, timeStatus: parsed.timeStatus })
    }
    const added = course.sections.find((item) => item.sectionId === sectionId)
    if (added) added.creditLimitExcluded = !!(creditExemptions as Record<string, string>)[row['과목번호']]
    byId.set(courseId, course)
  })
  return [...byId.values()].sort((a, b) => a.courseName.localeCompare(b.courseName, 'ko'))
}

function isMajor(course: Course) { return course.category.includes('전공') } function isBasic(course: Course) { return course.category.includes('기초') } function isSoft(course: Course) { return course.category.includes('소양') || course.category === 'KU소양' } function isAdvanced(course: Course) { return course.category.includes('심화') } function isSelfElective(course: Course) { return course.category.includes('자선') } function isTeaching(course: Course) { return course.category.includes('교직') } function inArea(course: Course, area: Area) { if (area === '전체') return true; if (area === '전공') return isMajor(course); if (area === '교양(기초)') return isBasic(course); if (area === '교양(소양)') return isSoft(course); if (area === '교양(심화)') return isAdvanced(course); if (area === '이러닝') return course.isElearning; if (area === '자선') return isSelfElective(course); if (area === '교직') return isTeaching(course); return !isMajor(course) && !isBasic(course) && !isSoft(course) && !isAdvanced(course) && !isSelfElective(course) && !isTeaching(course) }

function generateTimetables(request: TimetableRequest): TimetableResponse {
  return runTimetableEngine(request)
}

function parseWalkingRoutes(rows: CsvRow[]): WalkingRoute[] {
  return rows.map((row) => ({
    fromBuilding: row['출발건물'] || '',
    toBuilding: row['도착건물'] || '',
    distanceMeters: Number(row['거리_m']),
    minutes: Number(row['시간_분'])
  })).filter((route) => route.fromBuilding && route.toBuilding && Number.isFinite(route.distanceMeters) && Number.isFinite(route.minutes))
}

function normalizeBuilding(value: string) {
  return value.replace(/\s+/g, '').replace(/[()（）]/g, '').toLocaleLowerCase()
}

function classroomMatchesBuilding(classroom: string, building: string) {
  return normalizeBuilding(classroom).includes(normalizeBuilding(building))
}

function describeWalkingTransfers(candidate: Candidate, courses: Course[], routes: WalkingRoute[]) {
  if (!routes.length) return []
  const meetings = candidate.sections.flatMap((picked) => {
    const course = courses.find((item) => item.courseId === picked.courseId)
    const section = course?.sections.find((item) => item.sectionId === picked.sectionId)
    if (!course || !section) return []
    return section.days.map((slot) => {
      const classroom = slot.classroom || section.classroom || ''
      const online = course.isElearning || /온라인|이러닝|원격|비대면/i.test(course.courseName + ' ' + classroom)
      return { ...slot, classroom, courseName: course.courseName, online }
    })
  })
  const transfers: string[] = []
  for (const day of ['MON', 'TUE', 'WED', 'THU', 'FRI'] as Day[]) {
    const dayMeetings = meetings.filter((meeting) => meeting.day === day).sort((a, b) => a.startTime.localeCompare(b.startTime))
    for (let index = 0; index < dayMeetings.length - 1; index += 1) {
      const previous = dayMeetings[index]
      const next = dayMeetings[index + 1]
      if (previous.online || next.online || !previous.classroom || !next.classroom || previous.endTime > next.startTime) continue
      const previousEnd = Number(previous.endTime.slice(0, 2)) * 60 + Number(previous.endTime.slice(3, 5))
      const nextStart = Number(next.startTime.slice(0, 2)) * 60 + Number(next.startTime.slice(3, 5))
      const gap = nextStart - previousEnd
      if (gap > 30) continue
      const sameBuilding = routes.some((route) => classroomMatchesBuilding(previous.classroom, route.fromBuilding) && classroomMatchesBuilding(next.classroom, route.fromBuilding))
      const route = sameBuilding ? undefined : routes.find((item) => classroomMatchesBuilding(previous.classroom, item.fromBuilding) && classroomMatchesBuilding(next.classroom, item.toBuilding))
      if (!sameBuilding && !route) continue
      const minimumMinutes = Math.ceil((sameBuilding ? 0 : route!.minutes) + 1)
      transfers.push(weekdayNames[day] + '요일 · ' + previous.courseName + ' → ' + next.courseName + ': 이동 최소 ' + minimumMinutes + '분')
    }
  }
  return transfers
}

function hasFirstPeriodClass(candidate: Candidate, courses: Course[]): boolean {
  return candidate.sections.some((picked) => {
    const section = courses.find((course) => course.courseId === picked.courseId)?.sections.find((section) => section.sectionId === picked.sectionId)
    return section?.days.some((slot) => slot.startTime < '10:00' && slot.endTime > '09:00') ?? false
  })
}

function hasLongConsecutiveWalk(candidate: Candidate, courses: Course[], routes: WalkingRoute[]): boolean {
  if (!routes.length) return false
  const meetings = candidate.sections.flatMap((picked) => {
    const course = courses.find((item) => item.courseId === picked.courseId)
    const section = course?.sections.find((item) => item.sectionId === picked.sectionId)
    if (!course || !section) return []
    return section.days.map((slot) => {
      const classroom = slot.classroom || section.classroom || ''
      const online = course.isElearning || /온라인|이러닝|원격|비대면/i.test(course.courseName + ' ' + classroom)
      return { ...slot, classroom, courseName: course.courseName, online }
    })
  })
  for (const day of ['MON', 'TUE', 'WED', 'THU', 'FRI'] as Day[]) {
    const dayMeetings = meetings.filter((meeting) => meeting.day === day).sort((a, b) => a.startTime.localeCompare(b.startTime))
    for (let index = 0; index < dayMeetings.length - 1; index += 1) {
      const previous = dayMeetings[index]
      const next = dayMeetings[index + 1]
      if (previous.online || next.online || !previous.classroom || !next.classroom || previous.endTime > next.startTime) continue
      const previousEnd = Number(previous.endTime.slice(0, 2)) * 60 + Number(previous.endTime.slice(3, 5))
      const nextStart = Number(next.startTime.slice(0, 2)) * 60 + Number(next.startTime.slice(3, 5))
      const gap = nextStart - previousEnd
      if (gap > 30) continue
      const sameBuilding = routes.some((route) => classroomMatchesBuilding(previous.classroom, route.fromBuilding) && classroomMatchesBuilding(next.classroom, route.fromBuilding))
      const route = sameBuilding ? undefined : routes.find((item) => classroomMatchesBuilding(previous.classroom, item.fromBuilding) && classroomMatchesBuilding(next.classroom, item.toBuilding))
      if (!sameBuilding && !route) continue
      if (gap === 0 && (sameBuilding ? 0 : route!.minutes) + 1 >= 5) return true
    }
  }
  return false
}

export default function App() {
  const [academicOpen, setAcademicOpen] = useState(false)
  const [completedMode, setCompletedMode] = useState(false)
  const [courses, setCourses] = useState<Course[]>([])
  const academic = useAcademic(courses)
  const [walkingRoutes, setWalkingRoutes] = useState<WalkingRoute[]>([])
  const [selected, setSelected] = useState<string[]>([])
  const [requirements, setRequirements] = useState<Record<string, 'required' | 'optional'>>({})
  const [query, setQuery] = useState('')
  const [majorQuery, setMajorQuery] = useState('')
  const [major, setMajor] = useState('')
  const [area, setArea] = useState<Area>('전공')
  const [selectedCollege, setSelectedCollege] = useState('')
  const [detailFilter, setDetailFilter] = useState('')
  const [grade, setGrade] = useState('전체 학년')
  const [minCredits, setMinCredits] = useState('')
  const [maxCredits, setMaxCredits] = useState('')
  const [maxGapMinutes, setMaxGapMinutes] = useState('')
  const [maxDailyMinutes, setMaxDailyMinutes] = useState('')
  const [blockedDay, setBlockedDay] = useState<Day>('MON')
  const [blockedStart, setBlockedStart] = useState('09:00')
  const [blockedEnd, setBlockedEnd] = useState('10:00')
  const [unavailableTimes, setUnavailableTimes] = useState<TimeSlot[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [response, setResponse] = useState<TimetableResponse | null>(null)
  const [showAll, setShowAll] = useState(false)
  const [excludeFirstPeriod, setExcludeFirstPeriod] = useState(false)
  const [excludeLongConsecutiveWalks, setExcludeLongConsecutiveWalks] = useState(false)
  const [candidatePage, setCandidatePage] = useState(0)
  const [professorPreferences, setProfessorPreferences] = useState<Record<string, string[]>>({})
  const candidateResultsRef = useRef<HTMLDivElement | null>(null)
  useEffect(() => { setCandidatePage(0) }, [response])

  useEffect(() => {
    let cancelled = false
    fetch(csvUrl)
      .then((result) => { if (!result.ok) throw new Error('CSV fetch failed'); return result.text() })
      .then((text) => { if (!cancelled) setCourses(groupCourses(parseCsv(text))) })
      .catch(() => { if (!cancelled) setError('CSV를 불러오지 못했어요. GitHub CSV 경로와 인터넷 연결을 확인해 주세요.') })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [])

  useEffect(() => {
    let cancelled = false
    fetch(walkingCsvUrl)
      .then((result) => { if (!result.ok) throw new Error('Walking CSV fetch failed'); return result.text() })
      .then((text) => { if (!cancelled) setWalkingRoutes(parseWalkingRoutes(parseCsv(text))) })
      .catch(() => { if (!cancelled) setWalkingRoutes([]) })

  return () => { cancelled = true }
  }, [])

  const departmentNames = useMemo(() => [...new Set(courses.flatMap((course) => course.departments))].sort((a, b) => a.localeCompare(b, 'ko')), [courses])
  const areaCourses = useMemo(() => courses.filter((course) => inArea(course, area)), [courses, area])
  const collegeNames = useMemo(() => [...new Set(Object.values(collegeByDepartment as Record<string, string>))].sort((a, b) => a.localeCompare(b, 'ko')), [])
  const detailOptions = useMemo(() => (detailCategoriesByArea[area] || []).filter((tag) => areaCourses.some((course) => course.detailCategories.includes(tag))), [areaCourses, area])
  const matchingCourses = useMemo(() => areaCourses.filter((course) =>
    (!detailFilter || course.detailCategories.includes(detailFilter)) &&
    (area !== '전공' || !selectedCollege || (selectedCollege === '__unmapped' ? course.offeringDepartments.length === 0 || course.offeringDepartments.some((department) => !(collegeByDepartment as Record<string, string>)[department]) : course.offeringDepartments.some((department) => (collegeByDepartment as Record<string, string>)[department] === selectedCollege))) &&
    (grade === '전체 학년' || course.targetGrades.length === 0 || course.targetGrades.includes(grade[0])) &&
    (area !== '전공' || ((!major || course.departments.includes(major)) && (!majorQuery || course.departments.some((department) => department.toLowerCase().includes(majorQuery.trim().toLowerCase()))))) &&
    
    (course.courseName + ' ' + course.courseId + ' ' + course.category + ' ' + course.departments.join(' ') + ' ' + course.sections.map((section) => section.professor).join(' ')).toLowerCase().includes(query.trim().toLowerCase())
  ), [areaCourses, area, selectedCollege, detailFilter, grade, major, majorQuery, query])
  const visible = matchingCourses.filter((course) => completedMode || !academic.completedIds.has(course.courseId))
  const completedMatches = !completedMode && query.trim() ? matchingCourses.filter((course) => academic.completedIds.has(course.courseId)) : []
  const chosen = courses.filter((course) => selected.includes(course.courseId) && !academic.completedIds.has(course.courseId))
  const totalCredits = chosen.reduce((sum, course) => sum + course.credits, 0)
  const shown = showAll ? visible : visible.slice(0, 40)

  const exemptionGroup = (course: Course) => course.sections.map((section) => (creditExemptions as Record<string, string>)[section.sectionId.split(':')[1]]).find(Boolean)
  const excludedCredits = chosen.filter((course) => course.sections.every((section) => section.creditLimitExcluded)).reduce((sum, course) => sum + course.credits, 0)
  const toggle = (courseId: string) => {
    const course = courses.find((item) => item.courseId === courseId)
    const group = course && exemptionGroup(course)
    const addedCredits = course?.sections.every((section) => section.creditLimitExcluded) ? 0 : course?.credits || 0
    if (!selected.includes(courseId) && maxCredits.trim() && totalCredits - excludedCredits + addedCredits > Number(maxCredits)) { setNotice('최대학점을 초과하여 이 과목을 담을 수 없어요.'); return }
    if (!selected.includes(courseId) && group && chosen.some((item) => exemptionGroup(item) === group)) { setNotice(group + ' 유형은 한 과목만 선택할 수 있어요. 기존 선택을 해제해 주세요.'); return }
    setSelected((old) => old.includes(courseId) ? old.filter((id) => id !== courseId) : [...old, courseId])
    setResponse(null)
  }
  useEffect(() => {
    setSelected((old) => old.filter((code) => !academic.completedIds.has(code)))
    setResponse(null)
    setCandidatePage(0)
  }, [academic.completedIds])
  useEffect(() => {
    if (!maxCredits.trim() || !Number.isFinite(Number(maxCredits)) || Number(maxCredits) < 0) return
    setSelected((old) => {
      let counted = 0
      return old.filter((code) => {
        const course = courses.find((item) => item.courseId === code)
        if (!course) return true
        const credits = course.sections.every((section) => section.creditLimitExcluded) ? 0 : course.credits
        if (counted + credits > Number(maxCredits)) return false
        counted += credits
        return true
      })
    })
    setResponse(null)
  }, [maxCredits, courses])
  useEffect(() => {
    setResponse(null)
    setCandidatePage(0)
  }, [minCredits, maxCredits, unavailableTimes, professorPreferences, requirements, major, grade])
  useEffect(() => {
    if (major) academic.setDepartment(major)
  }, [major])
  const buildRequest = (): TimetableRequest => ({
    semester: '2026-2',
    major: area === '전공' ? (major || majorQuery.trim() || '건국대 GLOCAL') : '건국대 GLOCAL',
    grade: grade === '전체 학년' ? null : Number(grade[0]),
    courses: chosen.map((course) => ({ courseId: course.courseId, courseName: course.courseName, credits: course.credits, category: course.category, requirement: course.category.includes('필수') ? 'required' : 'optional', mustInclude: (requirements[course.courseId] || 'required') === 'required', sections: (professorPreferences[course.courseId]?.length ? course.sections.filter((section) => professorPreferences[course.courseId].includes(section.professor || '')) : course.sections) })),
    conditions: {
      minCredits: minCredits.trim() ? Number(minCredits) : null,
      maxCredits: maxCredits.trim() ? Number(maxCredits) : null,
      unavailableTimes,
      maxGapMinutes: maxGapMinutes.trim() ? Number(maxGapMinutes) : null,
      maxDailyMinutes: maxDailyMinutes.trim() ? Number(maxDailyMinutes) : null
    }
  })
  const sendSelection = async () => {
    if (!chosen.length) { setNotice('먼저 과목을 선택해 주세요.'); return }
    if ((minCredits && !Number.isFinite(Number(minCredits))) || (maxCredits && !Number.isFinite(Number(maxCredits)))) { setNotice('목표 학점을 숫자로 입력해 주세요.'); return }
    if (minCredits && maxCredits && Number(minCredits) > Number(maxCredits)) { setNotice('최소 학점은 최대 학점보다 클 수 없어요.'); return }
    if ([maxGapMinutes, maxDailyMinutes].some((value) => value.trim() && (!Number.isFinite(Number(value)) || Number(value) < 0))) { setNotice('시간 제한은 0 이상의 분으로 입력해 주세요.'); return }
    const request = buildRequest()
    try { localStorage.setItem('timetable:selected-courses', JSON.stringify(request)) } catch { /* local storage is optional */ }
    window.dispatchEvent(new CustomEvent('timetable:selection-change', { detail: request }))
    setNotice('시간표 엔진에 선택 과목과 조건을 전달하고 있어요.')
    const result = await generateTimetables(request)
    setResponse(result)
    setCandidatePage(0)
    setNotice(result.candidates.length ? result.candidates.length + '개의 시간표 후보를 받았어요.' : result.message || '조건에 맞는 후보가 없어요.')
    window.setTimeout(() => candidateResultsRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 80)
  }
  const addUnavailableTime = () => {
    if (!blockedStart || !blockedEnd) { setNotice('시작 시각과 종료 시각을 모두 입력해 주세요.'); return }
    if (blockedStart >= blockedEnd) { setNotice('비워둘 시간의 종료 시각은 시작 시각보다 늦어야 해요.'); return }
    setUnavailableTimes((old) => [...old, { day: blockedDay, startTime: blockedStart, endTime: blockedEnd }])
  }
  const changeArea = (next: Area) => { setArea(next); setSelectedCollege(''); setDetailFilter(''); setQuery(''); setShowAll(false) }
  const classTime = (slot: TimeSlot) => weekdayNames[slot.day] + ' ' + slot.startTime + '-' + slot.endTime


  const filteredCandidates = (response?.candidates ?? []).filter((candidate) => (!excludeLongConsecutiveWalks || !hasLongConsecutiveWalk(candidate, courses, walkingRoutes)) && (!excludeFirstPeriod || !hasFirstPeriodClass(candidate, courses)))
  useEffect(() => { setCandidatePage(0) }, [excludeLongConsecutiveWalks, excludeFirstPeriod])

  return <div className="app-shell">
    <header className="topbar"><a className="brand">시간을 달리는 현우</a><button className="academic-toggle" aria-expanded={academicOpen} aria-controls="academic-panel" onClick={() => setAcademicOpen((open) => !open)}>요람</button></header>
    <main className="page">
      {academicOpen && <AcademicPanel courses={courses} selected={selected} major={major} entries={academic.entries} update={academic.update} department={academic.department} setDepartment={academic.setDepartment} />}
      <div className="eyebrow">YOUR SEMESTER, YOUR WAY</div>
      <div className="intro-row"><div><h1>듣고 싶은 과목을 골라보세요</h1><p className="subtitle">전공·학년과 학점 조건을 설정하고, 시간표 엔진에 보낼 과목과 분반 후보를 선택하세요.</p></div></div>
      <div className="workspace">
        <aside className="panel settings">
          <AcademicSummary entries={academic.classifiedEntries} />
          <div className="panel-title"><h2>선택 조건</h2><span>* 필수 입력</span></div>
          {area === '전공' && <div className="major-picker"><label htmlFor="major-search">학과 검색 및 선택</label><input id="major-search" list="major-options" placeholder="학과명 검색 (예: 컴퓨터공학과)" value={majorQuery} onChange={(event) => { setMajorQuery(event.target.value); setMajor(departmentNames.includes(event.target.value) ? event.target.value : '') }} /><datalist id="major-options">{departmentNames.map((name) => <option value={name} key={name} />)}</datalist><small>선택한 학과의 강좌를 필터링해요.</small></div>}
          <div className="filter-row"><label htmlFor="grade-filter">대상 학년</label><select id="grade-filter" value={grade} onChange={(event) => setGrade(event.target.value)}>{['전체 학년', '1학년', '2학년', '3학년', '4학년'].map((value) => <option key={value}>{value}</option>)}</select></div>
          <button className="completed-mode-toggle" type="button" aria-pressed={completedMode} aria-controls="course-finder-content" onClick={() => setCompletedMode((active) => !active)}>이수 수업 체크 {completedMode ? '켜짐' : '꺼짐'}</button>
          <div id="course-finder-content">
          <div className="section-head"><h3>{area} 과목 찾기</h3><small>{loading ? '불러오는 중…' : visible.length.toLocaleString() + '개 과목'}</small></div>
          <input className="search" placeholder="과목명 · 학수번호 · 교수명 검색" value={query} onChange={(event) => { setQuery(event.target.value); setShowAll(false) }} />
          {completedMatches.length > 0 && <div className="completed-search-notice" role="status"><span>이수 완료로 선택 목록에서 제외된 과목: {completedMatches.map((course) => course.courseName).join(', ')}</span><button type="button" onClick={() => setCompletedMode(true)}>이수 기록 확인</button></div>}
          <div className="course-tabs" role="tablist" aria-label="과목 영역">{areaTabs.map((value) => <button role="tab" aria-selected={area === value} key={value} className={area === value ? 'selected' : ''} onClick={() => changeArea(value)}>{value}</button>)}</div>
          {area === '전공' && <div className="detail-filters college-filters" aria-label="전공 대학 및 계열"><button className={!selectedCollege ? 'selected' : ''} onClick={() => setSelectedCollege('')}>전체 대학</button>{collegeNames.map((name) => <button key={name} className={selectedCollege === name ? 'selected' : ''} onClick={() => setSelectedCollege(selectedCollege === name ? '' : name)}>{name}</button>)}<button className={selectedCollege === '__unmapped' ? 'selected' : ''} onClick={() => setSelectedCollege(selectedCollege === '__unmapped' ? '' : '__unmapped')}>대학 분류 확인 중</button></div>}{detailOptions.length > 0 && <div className="detail-filters"><button className={!detailFilter ? 'selected' : ''} onClick={() => setDetailFilter('')}>전체 세부영역</button>{detailOptions.map((tag) => <button key={tag} className={detailFilter === tag ? 'selected' : ''} onClick={() => setDetailFilter(detailFilter === tag ? '' : tag)}>{tag === '글로벌언어' ? '글로벌 언어' : tag}</button>)}</div>}
          {error && <div className="notice" role="alert">{error}<button onClick={() => location.reload()}>다시 불러오기</button></div>}
          <div className="course-list">{shown.map((course) => {
            const recorded = academic.entries.find((entry) => entry.code === course.courseId)
            const active = completedMode ? !!recorded : selected.includes(course.courseId)
            return <div className="course-entry" key={course.courseId}><button className={'course-row ' + (active ? 'chosen' : '')} aria-pressed={active} onClick={() => {
              if (!completedMode) { toggle(course.courseId); return }
              academic.update(recorded ? null : { code: course.courseId, name: course.courseName, credits: course.credits, category: course.category, area: course.detailCategories.find((tag) => Object.values(detailCategoriesByArea).flat().includes(tag)) || '', grade: 'A' }, course.courseId)
            }}><span>{active ? '✓' : '＋'}</span><span className="course-copy"><strong>{course.courseName}</strong><small>{course.credits}학점{course.sections.every((section) => section.creditLimitExcluded) ? ' · 한도 제외' : ''} · {areaTabs.find((item) => item !== '전체' && inArea(course, item)) || course.category}{course.detailCategories.filter((tag) => Object.values(detailCategoriesByArea).flat().includes(tag)).map((tag) => ' · ' + tag).join('')} · 분반 {course.sections.length}개</small></span></button>{completedMode && recorded && <div className="course-grade-entry"><label>성적<select aria-label={course.courseName + ' 성적'} value={recorded.grade} onChange={(event) => academic.update({ ...recorded, grade: event.target.value }, course.courseId)}>{['A+', 'A', 'B+', 'B', 'C+', 'C', 'D+', 'D', 'F', 'P', 'N'].map((grade) => <option key={grade}>{grade}</option>)}</select></label></div>}</div>
          })}{!loading && !error && !visible.length && <p className="subtitle">{completedMatches.length ? '검색된 과목은 이미 이수 완료한 과목이에요.' : '조건에 맞는 과목이 없어요. 검색 조건을 확인해 주세요.'}</p>}</div>
          {visible.length > 40 && <button className="text-button" onClick={() => setShowAll(!showAll)}>{showAll ? '목록 접기' : '과목 더 보기 (' + (visible.length - 40) + '개)'}</button>}
          {completedMode && <AcademicPanel view="manual" courses={courses} selected={selected} major={major} entries={academic.entries} update={academic.update} department={academic.department} setDepartment={academic.setDepartment} />}
          </div>
          <div className="selected-box"><strong>선택한 과목 {chosen.length}개 · 총 선택 {totalCredits}학점 · 한도 반영 {totalCredits - excludedCredits}학점 · 한도 제외 {excludedCredits}학점</strong><div className="chips">{chosen.map((course) => <div className="selection-chip" key={course.courseId}><span>{course.courseName} · {course.credits}학점</span><select aria-label={course.courseName + ' 선택 조건'} value={requirements[course.courseId] || 'required'} onChange={(event) => setRequirements((old) => ({ ...old, [course.courseId]: event.target.value as 'required' | 'optional' }))}><option value="required">반드시 포함</option><option value="optional">선택 가능</option></select><button className="chip" aria-label={course.courseName + ' 선택 해제'} onClick={() => toggle(course.courseId)}>×</button></div>)}</div></div>
          <div className="condition-grid"><label>목표 학점<span><input type="number" min="0" placeholder="최소" value={minCredits} onChange={(event) => setMinCredits(event.target.value)} /> ~ <input type="number" min="0" placeholder="최대" value={maxCredits} onChange={(event) => setMaxCredits(event.target.value)} /></span></label></div>
          <div className="time-condition"><h3>비워둘 시간</h3><div className="time-entry"><select aria-label="요일" value={blockedDay} onChange={(event) => setBlockedDay(event.target.value as Day)}>{(Object.keys(weekdayNames) as Day[]).slice(0, 5).map((day) => <option value={day} key={day}>{weekdayNames[day]}</option>)}</select><input aria-label="시작 시각" type="time" value={blockedStart} onChange={(event) => setBlockedStart(event.target.value)} /><span>~</span><input aria-label="종료 시각" type="time" value={blockedEnd} onChange={(event) => setBlockedEnd(event.target.value)} /><button type="button" onClick={addUnavailableTime}>추가</button></div>{unavailableTimes.map((slot, index) => <div className="time-chip" key={slot.day + slot.startTime + index}>{classTime(slot)}<button aria-label="비워둘 시간 제거" onClick={() => setUnavailableTimes((old) => old.filter((_, current) => current !== index))}>×</button></div>)}</div>
          <div className="schedule-limits"><label>수업 사이 최대 공강 시간 (분)<input type="number" min="0" step="1" placeholder="제한 없음" value={maxGapMinutes} onChange={(event) => { setMaxGapMinutes(event.target.value); setResponse(null) }} /></label><label>하루 최대 실제 강의시간 (분)<input type="number" min="0" step="1" placeholder="제한 없음" value={maxDailyMinutes} onChange={(event) => { setMaxDailyMinutes(event.target.value); setResponse(null) }} /></label><small>공강은 첫 수업 전·마지막 수업 후를 제외해요. 강의시간은 수업 시간만 합산해요. 최대학점을 낮추면 초과 과목은 담은 순서에 따라 제외해요.</small></div>
          <button className="primary-button" disabled={loading || chosen.length === 0} onClick={sendSelection}>시간표 엔진에 전달 →</button>
        </aside>
        <section className="results">
          <div className="results-top"><div><h2>엔진 요청 및 시간표 후보</h2><p>선택한 과목의 모든 분반 후보를 엔진으로 전달합니다.</p></div><span className="plan-tag">{loading ? 'CSV 불러오는 중' : courses.length.toLocaleString() + '개 과목'}</span></div>
          {chosen.length === 0 ? <div className="panel empty-selection"><h3>왼쪽 목록에서 과목을 선택하세요</h3><p className="subtitle">학점, 필수 여부, 분반별 요일·시간·강의실을 요청에 담습니다.</p></div> : <div className="selected-course-list">{chosen.map((course) => <article className="plan-card" key={course.courseId}><div className="plan-head"><div><h3>{course.courseName}</h3><span className="plan-tag">{course.credits}학점 · {(requirements[course.courseId] || 'required') === 'required' ? '반드시 포함' : '선택 가능'}</span></div><button onClick={() => toggle(course.courseId)}>선택 해제</button></div><p>{course.category} · 분반 후보 {course.sections.length}개</p><div className="section-list">{[...new Set(course.sections.map((section) => section.professor).filter((professor): professor is string => Boolean(professor)))].length > 1 && <fieldset className="professor-filter"><legend>원하는 교수 선택</legend>{[...new Set(course.sections.map((section) => section.professor).filter((professor): professor is string => Boolean(professor)))].map((professor) => <label key={professor}><input type="checkbox" checked={(professorPreferences[course.courseId] || []).includes(professor)} onChange={() => setProfessorPreferences((old) => { const current = old[course.courseId] || []; const next = current.includes(professor) ? current.filter((name) => name !== professor) : [...current, professor]; return { ...old, [course.courseId]: next } })} />{professor}</label>)}</fieldset>}{(professorPreferences[course.courseId]?.length ? course.sections.filter((section) => professorPreferences[course.courseId].includes(section.professor || '')) : course.sections).slice(0, 8).map((section) => <div className="section-option" key={section.sectionId}><div className="section-identification"><strong>분반 {section.sectionId.split(':')[2] || '미정'}</strong><small>과목코드 {section.sectionId.split(':')[1] || '미확인'}</small></div><span>{section.days.length ? section.days.map(classTime).join(' · ') : section.timeStatus === 'missing' ? '시간 정보 없음' : '시간 형식 확인 필요'}</span><small>{section.classroom || '강의실 정보 없음'} · {section.professor || '담당교수 미정'}</small></div>)}{course.sections.length > 8 && <small>나머지 {course.sections.length - 8}개 분반도 엔진에 전달됩니다.</small>}</div></article>)}</div>}
          <div className="comparison handoff-card"><h3>시간표 생성에 전달되는 조건</h3><p>학기 · 전공 · 학년 · 과목과 분반 · 학점 범위 · 비워둘 시간을 담아 전달합니다.</p><span className="engine-action-label">선택한 조건으로 시간표 후보를 요청합니다</span><p>선택 {chosen.length}개 · 총 {totalCredits}학점 · 비워둘 시간 {unavailableTimes.length}개</p></div>
          {notice && <div className="notice" role="status">{notice}</div>}
          {response && response.candidates.length > 0 && <div className="candidate-list" ref={candidateResultsRef}>
            <div className="walking-filter"><div className="candidate-filter-buttons"><button type="button" aria-pressed={excludeLongConsecutiveWalks} onClick={() => setExcludeLongConsecutiveWalks((enabled) => !enabled)}>연강 이동 5분 이상 제외 {excludeLongConsecutiveWalks ? '켜짐' : '꺼짐'}</button><button type="button" aria-pressed={excludeFirstPeriod} onClick={() => setExcludeFirstPeriod((enabled) => !enabled)}>1교시 수업 제외 {excludeFirstPeriod ? '켜짐' : '꺼짐'}</button></div><p>연강 사이 도보 이동이 5분 이상인 시간표를 제외해요. 이동 시간이 미확인인 구간은 유지해요. 1교시 제외를 켜면 09:00~10:00과 겹치는 수업이 있는 시간표를 제외해요.</p></div>
          {filteredCandidates.length === 0 && <p role="status">필터 조건에 맞는 시간표가 없어요. 필터를 끄면 전체 후보를 볼 수 있어요.</p>}
          <div className="candidate-title-row">
              <h2>가능한 시간표 후보 {filteredCandidates.length}개</h2>
              {filteredCandidates.length > 1 && <div className="candidate-controls">
                <button type="button" aria-label="이전 후보" disabled={candidatePage === 0} onClick={() => setCandidatePage((index) => Math.max(0, index - 1))}>←</button>
                <span>{candidatePage + 1} / {filteredCandidates.length}</span>
                <button type="button" aria-label="다음 후보" disabled={candidatePage >= filteredCandidates.length - 1} onClick={() => setCandidatePage((index) => Math.min(filteredCandidates.length - 1, index + 1))}>→</button>
              </div>}
            </div>
            <div className="candidate-carousel">
              {filteredCandidates.slice(candidatePage, candidatePage + 1).map((candidate) => <article className="candidate-card" key={candidate.candidateId}>
                <div className="plan-head"><h3>후보 {candidate.candidateId.replace('candidate_', '')}</h3><strong>{candidate.totalCredits}학점 · 한도 반영 {candidate.sections.reduce((sum, picked) => { const course = courses.find((item) => item.courseId === picked.courseId); return sum + (course?.sections.find((section) => section.sectionId === picked.sectionId)?.creditLimitExcluded ? 0 : course?.credits || 0) }, 0)}학점 · {candidate.summary.classDays}일 등교</strong></div>
                <div className="weekly-timetable"><div className="weekly-header"><span className="weekly-corner">시간</span>{(['MON', 'TUE', 'WED', 'THU', 'FRI'] as Day[]).map((day) => <span className="weekly-head-day" key={day}>{weekdayNames[day]}</span>)}</div><div className="weekly-body"><div className="weekly-time-column">{Array.from({ length: 15 }, (_, index) => <span key={index}>{String(index + 8).padStart(2, '0')}:00</span>)}</div>{(['MON', 'TUE', 'WED', 'THU', 'FRI'] as Day[]).map((day) => <div className="weekly-day" key={day}>{candidate.sections.flatMap((picked, courseIndex) => { const course = courses.find((item) => item.courseId === picked.courseId); const section = course?.sections.find((item) => item.sectionId === picked.sectionId); return (section?.days || []).filter((slot) => slot.day === day).map((slot, index) => { const startMinutes = Number(slot.startTime.slice(0, 2)) * 60 + Number(slot.startTime.slice(3, 5)); const endMinutes = Number(slot.endTime.slice(0, 2)) * 60 + Number(slot.endTime.slice(3, 5)); return <article className={`timetable-block color-${courseIndex % 6}`} style={{ top: Math.max(0, (startMinutes - 480) * 40 / 60), height: Math.max(32, (endMinutes - startMinutes) * 40 / 60) }} key={picked.courseId + picked.sectionId + day + index}><strong>{course?.courseName || picked.courseId}</strong><span>{slot.startTime}–{slot.endTime}</span><small>{section?.professor || '담당교수 미정'}</small><small>{slot.classroom || section?.classroom || '강의실 미정'}</small></article> })})}</div>)}</div></div>
                <div className="unplaced-courses">{candidate.sections.filter((picked) => { const course = courses.find((item) => item.courseId === picked.courseId); return !course?.sections.find((item) => item.sectionId === picked.sectionId)?.days.length }).map((picked) => <span key={picked.courseId + picked.sectionId}>{courses.find((item) => item.courseId === picked.courseId)?.courseName || picked.courseId}: 시간 정보 없음</span>)}</div>
                {describeWalkingTransfers(candidate, courses, walkingRoutes).map((transfer, index) => <small className="travel-notice" key={index}>{transfer}</small>)}
              </article>)}
            </div>
          </div>}
          {response && filteredCandidates.length === 0 && response.message && <div className="notice" role="status">{response.message}</div>}
        </section>
      </div>
      <footer>{loading ? '강좌 CSV를 불러오고 있어요.' : error || 'CSV에서 ' + courses.length.toLocaleString() + '개 과목을 불러왔어요.'}</footer>
    </main>
  </div>
}
