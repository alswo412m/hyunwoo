import { useEffect, useMemo, useState } from 'react'
import collegeByDepartment from './department-colleges.json'
import './App.css'

type Day = 'MON' | 'TUE' | 'WED' | 'THU' | 'FRI' | 'SAT' | 'SUN'
type TimeSlot = { day: Day; startTime: string; endTime: string; classroom?: string | null }
type Section = { sectionId: string; days: TimeSlot[]; classroom: string | null; professor?: string | null; timeStatus?: 'parsed' | 'missing' | 'partial' | 'failed' }
type Course = { courseId: string; courseName: string; credits: number; category: string; requirement: 'required' | 'optional'; sections: Section[]; departments: string[]; targetGrades: string[]; detailCategories: string[]; isElearning: boolean; offeringDepartments: string[] }
type TimetableRequest = { semester: string; major: string; grade: number | null; courses: Array<Omit<Course, 'departments' | 'targetGrades' | 'detailCategories' | 'isElearning' | 'offeringDepartments'>>; conditions: { minCredits: number | null; maxCredits: number | null; unavailableTimes: TimeSlot[] } }
type TimetableResponse = { candidates: Array<{ candidateId: string; totalCredits: number; sections: Array<{ courseId: string; sectionId: string }>; summary: { classDays: number; lastClassTime: string | null; travelWarnings: string[] } }>; message?: string }
type CsvRow = Record<string, string>
type Area = '전체' | '전공' | '교양(기초)' | '교양(소양)' | '교양(심화)' | '이러닝' | '자선' | '교직' | '기타'
const areaTabs: Area[] = ['전체', '전공', '교양(기초)', '교양(소양)', '교양(심화)', '이러닝', '자선', '교직', '기타']
const detailCategoriesByArea: Record<string, string[]> = { '교양(기초)': ['발표와토론', '외국어기초', '글쓰기', '인문기초', '과학기초'], '교양(소양)': ['실무', '실기', '인성'], '교양(심화)': ['글로벌언어', '인간과문화', '인간과사회', '과학과기술', '예술과체육', '신문과미디어', '융복합', 'AI/데이터'] }

const csvUrl = 'https://raw.githubusercontent.com/alswo412m/hyunwoo/main/timetable_data/건국대_GLOCAL_전체강좌_이수구분_2026_2.csv'
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
    byId.set(courseId, course)
  })
  return [...byId.values()].sort((a, b) => a.courseName.localeCompare(b.courseName, 'ko'))
}

function isMajor(course: Course) { return course.category.includes('전공') } function isBasic(course: Course) { return course.category.includes('기초') } function isSoft(course: Course) { return course.category.includes('소양') || course.category === 'KU소양' } function isAdvanced(course: Course) { return course.category.includes('심화') } function isSelfElective(course: Course) { return course.category.includes('자선') } function isTeaching(course: Course) { return course.category.includes('교직') } function inArea(course: Course, area: Area) { if (area === '전체') return true; if (area === '전공') return isMajor(course); if (area === '교양(기초)') return isBasic(course); if (area === '교양(소양)') return isSoft(course); if (area === '교양(심화)') return isAdvanced(course); if (area === '이러닝') return course.isElearning; if (area === '자선') return isSelfElective(course); if (area === '교직') return isTeaching(course); return !isMajor(course) && !isBasic(course) && !isSoft(course) && !isAdvanced(course) && !isSelfElective(course) && !isTeaching(course) }

// The engine branch can expose this adapter when it is merged into the app bundle.
async function generateTimetables(request: TimetableRequest): Promise<TimetableResponse> {
  const engineWindow = window as Window & { timetableEngine?: { generateTimetables?: (value: TimetableRequest) => TimetableResponse | Promise<TimetableResponse> } }
  const engine = engineWindow.timetableEngine?.generateTimetables
  if (engine) return await engine(request)
  window.dispatchEvent(new CustomEvent('timetable:generate-request', { detail: request }))
  return { candidates: [], message: '요청은 timetable:generate-request 이벤트로 전달했어요. 엔진의 generateTimetables(request) 연결을 기다리고 있어요.' }
}

export default function App() {
  const [courses, setCourses] = useState<Course[]>([])
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
  const [blockedDay, setBlockedDay] = useState<Day>('MON')
  const [blockedStart, setBlockedStart] = useState('09:00')
  const [blockedEnd, setBlockedEnd] = useState('10:00')
  const [unavailableTimes, setUnavailableTimes] = useState<TimeSlot[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [response, setResponse] = useState<TimetableResponse | null>(null)
  const [showAll, setShowAll] = useState(false)

  useEffect(() => {
    let cancelled = false
    fetch(csvUrl)
      .then((result) => { if (!result.ok) throw new Error('CSV fetch failed'); return result.text() })
      .then((text) => { if (!cancelled) setCourses(groupCourses(parseCsv(text))) })
      .catch(() => { if (!cancelled) setError('CSV를 불러오지 못했어요. GitHub CSV 경로와 인터넷 연결을 확인해 주세요.') })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [])

  const departmentNames = useMemo(() => [...new Set(courses.flatMap((course) => course.departments))].sort((a, b) => a.localeCompare(b, 'ko')), [courses])
  const areaCourses = useMemo(() => courses.filter((course) => inArea(course, area)), [courses, area])
  const collegeNames = useMemo(() => [...new Set(Object.values(collegeByDepartment as Record<string, string>))].sort((a, b) => a.localeCompare(b, 'ko')), [])
  const detailOptions = useMemo(() => (detailCategoriesByArea[area] || []).filter((tag) => areaCourses.some((course) => course.detailCategories.includes(tag))), [areaCourses, area])
  const visible = useMemo(() => areaCourses.filter((course) =>
    (!detailFilter || course.detailCategories.includes(detailFilter)) &&
    (area !== '전공' || !selectedCollege || (selectedCollege === '__unmapped' ? course.offeringDepartments.length === 0 || course.offeringDepartments.some((department) => !(collegeByDepartment as Record<string, string>)[department]) : course.offeringDepartments.some((department) => (collegeByDepartment as Record<string, string>)[department] === selectedCollege))) &&
    (grade === '전체 학년' || course.targetGrades.length === 0 || course.targetGrades.includes(grade[0])) &&
    (!major || course.departments.includes(major)) &&
    (!majorQuery || course.departments.some((department) => department.toLowerCase().includes(majorQuery.trim().toLowerCase()))) &&
    (course.courseName + ' ' + course.courseId + ' ' + course.category + ' ' + course.departments.join(' ')).toLowerCase().includes(query.trim().toLowerCase())
  ), [courses, area, selectedCollege, detailFilter, grade, major, majorQuery, query])
  const chosen = courses.filter((course) => selected.includes(course.courseId))
  const totalCredits = chosen.reduce((sum, course) => sum + course.credits, 0)
  const shown = showAll ? visible : visible.slice(0, 40)

  const toggle = (courseId: string) => {
    setSelected((old) => old.includes(courseId) ? old.filter((id) => id !== courseId) : [...old, courseId])
    setResponse(null)
  }
  const buildRequest = (): TimetableRequest => ({
    semester: '2026-2',
    major: major || majorQuery.trim() || '건국대 GLOCAL',
    grade: grade === '전체 학년' ? null : Number(grade[0]),
    courses: chosen.map((course) => ({ courseId: course.courseId, courseName: course.courseName, credits: course.credits, category: course.category, requirement: (requirements[course.courseId] || 'optional') as 'required' | 'optional', sections: course.sections })),
    conditions: {
      minCredits: minCredits.trim() ? Number(minCredits) : null,
      maxCredits: maxCredits.trim() ? Number(maxCredits) : null,
      unavailableTimes
    }
  })
  const sendSelection = async () => {
    if (!chosen.length) { setNotice('먼저 과목을 선택해 주세요.'); return }
    if ((minCredits && !Number.isFinite(Number(minCredits))) || (maxCredits && !Number.isFinite(Number(maxCredits)))) { setNotice('목표 학점을 숫자로 입력해 주세요.'); return }
    if (minCredits && maxCredits && Number(minCredits) > Number(maxCredits)) { setNotice('최소 학점은 최대 학점보다 클 수 없어요.'); return }
    const request = buildRequest()
    try { localStorage.setItem('timetable:selected-courses', JSON.stringify(request)) } catch { /* local storage is optional */ }
    window.dispatchEvent(new CustomEvent('timetable:selection-change', { detail: request }))
    setNotice('시간표 엔진에 선택 과목과 조건을 전달하고 있어요.')
    const result = await generateTimetables(request)
    setResponse(result)
    setNotice(result.candidates.length ? result.candidates.length + '개의 시간표 후보를 받았어요.' : result.message || '조건에 맞는 후보가 없어요.')
  }
  const addUnavailableTime = () => {
    if (blockedStart >= blockedEnd) { setNotice('비워둘 시간의 종료 시각은 시작 시각보다 늦어야 해요.'); return }
    setUnavailableTimes((old) => [...old, { day: blockedDay, startTime: blockedStart, endTime: blockedEnd }])
  }
  const changeArea = (next: Area) => { setArea(next); setSelectedCollege(''); setDetailFilter(''); setMajor(''); setMajorQuery(''); setQuery(''); setShowAll(false) }
  const classTime = (slot: TimeSlot) => weekdayNames[slot.day] + ' ' + slot.startTime + '-' + slot.endTime

  return <div className="app-shell">
    <header className="topbar"><a className="brand"><b className="brand-mark">틈</b> 틈표</a><span className="semester">2026학년도 2학기 · 건국대 GLOCAL</span></header>
    <main className="page">
      <div className="eyebrow">YOUR SEMESTER, YOUR WAY</div>
      <div className="intro-row"><div><h1>듣고 싶은 과목을 골라보세요</h1><p className="subtitle">전공·학년과 학점 조건을 설정하고, 시간표 엔진에 보낼 과목과 분반 후보를 선택하세요.</p></div><div className="steps">① 조건 입력　›　<strong>② 과목 선택</strong>　›　③ 시간표 조합</div></div>
      <div className="workspace">
        <aside className="panel settings">
          <div className="panel-title"><h2>선택 조건</h2><span>* 필수 입력</span></div>{area === '전공' && <div className="college-filter"><label htmlFor="college-filter">전공 대학</label><select id="college-filter" value={selectedCollege} onChange={(event) => setSelectedCollege(event.target.value)}><option value="">전체 대학</option>{collegeNames.map((name) => <option key={name}>{name}</option>)}<option value="__unmapped">대학 분류 확인 중</option></select></div>}
          {area === '전공' && <div className="major-picker"><label htmlFor="major-search">학과 검색 및 선택</label><input id="major-search" list="major-options" placeholder="전공명 검색 (예: 컴퓨터공학과)" value={majorQuery} onChange={(event) => { setMajorQuery(event.target.value); setMajor(departmentNames.includes(event.target.value) ? event.target.value : '') }} /><datalist id="major-options">{departmentNames.map((name) => <option value={name} key={name} />)}</datalist><small>전공 강좌 필터와 엔진 입력에 사용돼요.</small></div>}
          <div className="filter-row"><label htmlFor="grade-filter">대상 학년</label><select id="grade-filter" value={grade} onChange={(event) => setGrade(event.target.value)}>{['전체 학년', '1학년', '2학년', '3학년', '4학년'].map((value) => <option key={value}>{value}</option>)}</select></div>
          <div className="section-head"><h3>{area} 과목 찾기</h3><small>{loading ? '불러오는 중…' : visible.length.toLocaleString() + '개 과목'}</small></div>
          <input className="search" placeholder="과목명 또는 학수번호 검색" value={query} onChange={(event) => { setQuery(event.target.value); setShowAll(false) }} />
          <div className="course-tabs" role="tablist" aria-label="과목 영역">{areaTabs.map((value) => <button role="tab" aria-selected={area === value} key={value} className={area === value ? 'selected' : ''} onClick={() => changeArea(value)}>{value}</button>)}</div>
          {area === '전공' && <p className="filter-caption">커리큘럼 자료의 학과-대학 대응표로 전공 대학을 분류합니다.</p>}{detailOptions.length > 0 && <div className="detail-filters"><button className={!detailFilter ? 'selected' : ''} onClick={() => setDetailFilter('')}>전체 세부영역</button>{detailOptions.map((tag) => <button key={tag} className={detailFilter === tag ? 'selected' : ''} onClick={() => setDetailFilter(detailFilter === tag ? '' : tag)}>{tag === '글로벌언어' ? '글로벌 언어' : tag}</button>)}</div>}
          {error && <div className="notice" role="alert">{error}<button onClick={() => location.reload()}>다시 불러오기</button></div>}
          <div className="course-list">{shown.map((course) => <button key={course.courseId} className={'course-row ' + (selected.includes(course.courseId) ? 'chosen' : '')} aria-pressed={selected.includes(course.courseId)} onClick={() => toggle(course.courseId)}><span>{selected.includes(course.courseId) ? '✓' : '＋'}</span><span className="course-copy"><strong>{course.courseName}</strong><small>{course.courseId} · {course.credits}학점 · {course.category} · 분반 {course.sections.length}개</small></span></button>)}{!loading && !error && !visible.length && <p className="subtitle">조건에 맞는 과목이 없어요. 검색 조건을 확인해 주세요.</p>}</div>
          {visible.length > 40 && <button className="text-button" onClick={() => setShowAll(!showAll)}>{showAll ? '목록 접기' : '과목 더 보기 (' + (visible.length - 40) + '개)'}</button>}
          <div className="selected-box"><strong>선택한 과목 {chosen.length}개 · {totalCredits}학점</strong><div className="chips">{chosen.map((course) => <div className="selection-chip" key={course.courseId}><span>{course.courseName} · {course.credits}학점</span><select aria-label={course.courseName + ' 선택 조건'} value={requirements[course.courseId] || 'optional'} onChange={(event) => setRequirements((old) => ({ ...old, [course.courseId]: event.target.value as 'required' | 'optional' }))}><option value="required">필수</option><option value="optional">선택</option></select><button className="chip" aria-label={course.courseName + ' 선택 해제'} onClick={() => toggle(course.courseId)}>×</button></div>)}</div></div>
          <div className="condition-grid"><label>목표 학점<span><input type="number" min="0" placeholder="최소" value={minCredits} onChange={(event) => setMinCredits(event.target.value)} /> ~ <input type="number" min="0" placeholder="최대" value={maxCredits} onChange={(event) => setMaxCredits(event.target.value)} /></span></label></div>
          <div className="time-condition"><h3>비워둘 시간</h3><div className="time-entry"><select aria-label="요일" value={blockedDay} onChange={(event) => setBlockedDay(event.target.value as Day)}>{(Object.keys(weekdayNames) as Day[]).slice(0, 5).map((day) => <option value={day} key={day}>{weekdayNames[day]}</option>)}</select><input aria-label="시작 시각" type="time" value={blockedStart} onChange={(event) => setBlockedStart(event.target.value)} /><span>~</span><input aria-label="종료 시각" type="time" value={blockedEnd} onChange={(event) => setBlockedEnd(event.target.value)} /><button type="button" onClick={addUnavailableTime}>추가</button></div>{unavailableTimes.map((slot, index) => <div className="time-chip" key={slot.day + slot.startTime + index}>{classTime(slot)}<button aria-label="비워둘 시간 제거" onClick={() => setUnavailableTimes((old) => old.filter((_, current) => current !== index))}>×</button></div>)}</div>
          <button className="primary-button" disabled={loading || chosen.length === 0} onClick={sendSelection}>시간표 엔진에 전달 →</button>
        </aside>
        <section className="results">
          <div className="results-top"><div><h2>엔진 요청 및 시간표 후보</h2><p>선택한 과목의 모든 분반 후보를 엔진으로 전달합니다.</p></div><span className="plan-tag">{loading ? 'CSV 불러오는 중' : courses.length.toLocaleString() + '개 과목'}</span></div>
          {chosen.length === 0 ? <div className="panel empty-selection"><h3>왼쪽 목록에서 과목을 선택하세요</h3><p className="subtitle">학점, 필수 여부, 분반별 요일·시간·강의실을 요청에 담습니다.</p></div> : <div className="selected-course-list">{chosen.map((course) => <article className="plan-card" key={course.courseId}><div className="plan-head"><div><h3>{course.courseName}</h3><span className="plan-tag">{course.courseId} · {course.credits}학점 · {requirements[course.courseId] === 'required' ? '필수' : '선택'}</span></div><button onClick={() => toggle(course.courseId)}>선택 해제</button></div><p>{course.category} · 분반 후보 {course.sections.length}개</p><div className="section-list">{course.sections.slice(0, 8).map((section) => <div className="section-option" key={section.sectionId}><strong>분반 {section.sectionId.split(':').slice(-2, -1)[0] || section.sectionId}</strong><span>{section.days.length ? section.days.map(classTime).join(' · ') : section.timeStatus === 'missing' ? '시간 정보 없음' : '시간 형식 확인 필요'}</span><small>{section.classroom || '강의실 정보 없음'} · {section.professor || '담당교수 미정'}</small></div>)}{course.sections.length > 8 && <small>나머지 {course.sections.length - 8}개 분반도 엔진에 전달됩니다.</small>}</div></article>)}</div>}
          <div className="comparison handoff-card"><h3>엔진 요청 형식</h3><p>semester · major · grade · courses/sections · 학점 범위 · 비워둘 시간을 담아 전달합니다.</p><code>generateTimetables(request)</code><p>선택 {chosen.length}개 · 총 {totalCredits}학점 · 비워둘 시간 {unavailableTimes.length}개</p></div>
          {notice && <div className="notice" role="status">{notice}</div>}
          {response && response.candidates.length > 0 && <div className="candidate-list"><h2>가능한 시간표 후보 {response.candidates.length}개</h2>{response.candidates.map((candidate) => <article className="candidate-card" key={candidate.candidateId}><div className="plan-head"><h3>후보 {candidate.candidateId.replace('candidate_', '')}</h3><strong>{candidate.totalCredits}학점 · {candidate.summary.classDays}일 등교</strong></div>{candidate.sections.map((picked) => { const course = courses.find((item) => item.courseId === picked.courseId); const section = course?.sections.find((item) => item.sectionId === picked.sectionId); return <p key={picked.courseId + picked.sectionId}>{course?.courseName || picked.courseId} · {section?.days.map(classTime).join(' · ') || '시간 미정'} · {section?.classroom || '강의실 미정'}</p> })}{candidate.summary.travelWarnings.map((warning, index) => <small key={index}>{warning}</small>)}</article>)}</div>}
          {response && response.candidates.length === 0 && response.message && <div className="notice" role="status">{response.message}</div>}
        </section>
      </div>
      <footer>{loading ? '강좌 CSV를 불러오고 있어요.' : error || 'CSV에서 ' + courses.length.toLocaleString() + '개 과목을 불러왔어요.'}</footer>
    </main>
  </div>
}
