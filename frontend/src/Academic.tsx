import { useEffect, useMemo, useState } from 'react'
import curriculumData from './curricula-2025.json'
import './Academic.css'

type Offering = { courseId: string; courseName: string; credits: number; category: string; detailCategories: string[]; departments?: string[] }
type Entry = { code: string; name: string; credits: number; category: string; area: string; grade: string; department?: string }
type Curriculum = { department: string; courses: { course_code: string; name: string; credits: number; category: string; required: boolean }[]; credit_requirements: Record<string, number | null>; unresolved_requirements: string[]; metadata?: { additional_requirements?: { description: string; source_pdf_page?: number }[] } }
const curricula = curriculumData as Curriculum[]
const gradePoints: Record<string, number> = { 'A+': 4.5, A: 4, 'B+': 3.5, B: 3, 'C+': 2.5, C: 2, 'D+': 1.5, D: 1, F: 0 }
const grades = [...Object.keys(gradePoints), 'P', 'N']
const passed = (entry: Entry) => entry.grade !== 'F' && entry.grade !== 'N'
const isRequired = (category: string) => ['전필', '전공필수'].includes(category)
const isElective = (category: string) => ['전선', '전선B', '전공선택'].includes(category)
const isMajor = (category: string) => isRequired(category) || isElective(category)
const isGeneral = (category: string) => /교양|기초|소양|심화|기교|지교/.test(category)
export function categoryForDepartment(entry: Entry, curriculum: Curriculum, courses: Offering[] = []): string {
  const match = curriculum.courses.find((course) => course.course_code ? course.course_code === entry.code : entry.code.startsWith(`curriculum:${curriculum.department}:`) && course.name === entry.name)
  if (match) return match.category
  if (!isMajor(entry.category)) return entry.category
  const offering = courses.find((course) => course.courseId === entry.code)
  const belongs = entry.department === curriculum.department || offering?.departments?.includes(curriculum.department)
  return belongs ? entry.category : '타전공'
}

export function academicStats(entries: Entry[]) {
  const sum = (filter: (entry: Entry) => boolean) => entries.filter((entry) => passed(entry) && filter(entry)).reduce((total, entry) => total + entry.credits, 0)
  const average = (filter: (entry: Entry) => boolean) => {
    const graded = entries.filter((entry) => filter(entry) && gradePoints[entry.grade] !== undefined)
    const credits = graded.reduce((total, entry) => total + entry.credits, 0)
    return credits ? (graded.reduce((total, entry) => total + entry.credits * gradePoints[entry.grade], 0) / credits).toFixed(2) : '—'
  }
  return { total: sum(() => true), major_required: sum((entry) => isRequired(entry.category)), major_elective: sum((entry) => isElective(entry.category)), major_total: sum((entry) => isMajor(entry.category)), general_education: sum((entry) => isGeneral(entry.category)), gpa: average(() => true), majorGpa: average((entry) => isMajor(entry.category)) }
}
export function useAcademic(courses: Offering[] = []) {
  const [department, setDepartment] = useState(() => { try { return localStorage.getItem('timetable:curriculum:2025') || curricula[0].department } catch { return curricula[0].department } })
  const currentCurriculum = curricula.find((item) => item.department === department) || curricula[0]

  const [entries, setEntries] = useState<Entry[]>(() => {
    try { const saved = JSON.parse(localStorage.getItem('timetable:academic:2025') || '[]'); return Array.isArray(saved) ? saved.filter((entry) => typeof entry.code === 'string' && typeof entry.name === 'string' && typeof entry.category === 'string' && typeof entry.area === 'string' && Number.isFinite(entry.credits) && entry.credits >= 0 && grades.includes(entry.grade)) : [] } catch { return [] }
  })
  useEffect(() => { try { localStorage.setItem('timetable:academic:2025', JSON.stringify(entries)) } catch { /* Storage can be unavailable. */ } }, [entries])
  const completedIds = useMemo(() => new Set(entries.filter(passed).map((entry) => entry.code)), [entries])
  const update = (entry: Entry | null, code: string) => setEntries((old) => entry ? [...old.filter((item) => item.code !== code), entry] : old.filter((item) => item.code !== code))
  const classifiedEntries = entries.map((entry) => ({ ...entry, category: categoryForDepartment(entry, currentCurriculum, courses) }))
  return { entries, completedIds, update, department, setDepartment, classifiedEntries }
}
export function AcademicSummary({ entries }: { entries: Entry[] }) {
  const stats = academicStats(entries)
  return <section className="academic-summary" aria-label="이수 및 평점 현황"><h3>이수 · 성적 현황</h3><div className="academic-gpa"><span>전체 평점 <b>{stats.gpa}</b></span><span>전공 평점 <b>{stats.majorGpa}</b></span></div><p>4.5 만점 · 학점 가중평균</p><dl>{[['전공필수', stats.major_required], ['전공선택', stats.major_elective], ['전공 전체', stats.major_total], ['전체 취득', stats.total]].map(([name, credit]) => <div key={name}><dt>{name}</dt><dd>{credit}학점</dd></div>)}</dl><small>F는 평점에 포함하며 취득학점에서는 제외해요. P는 취득학점에 포함하고, P/N은 평점에서 제외해요.</small></section>
}
export function AcademicPanel({ courses, selected, major, entries, update, department, setDepartment, view = 'overview' }: { courses: Offering[]; selected: string[]; major: string; entries: Entry[]; update: (entry: Entry | null, code: string) => void; department: string; setDepartment: (department: string) => void; view?: 'overview' | 'records' | 'manual' }) {

  const [search, setSearch] = useState('')
  const [manualName, setManualName] = useState('')
  const [manualCode, setManualCode] = useState('')
  const [manualCredits, setManualCredits] = useState('3')
  const [manualCategory, setManualCategory] = useState('전공선택')
  const [manualArea, setManualArea] = useState('')
  const [manualGrade, setManualGrade] = useState('A')
  const [manualError, setManualError] = useState('')
  const [confirmedConditions, setConfirmedConditions] = useState<Record<string, boolean>>(() => { try { return JSON.parse(localStorage.getItem('timetable:curriculum-confirmed:2025') || '{}') } catch { return {} } })
  useEffect(() => { try { localStorage.setItem('timetable:curriculum-confirmed:2025', JSON.stringify(confirmedConditions)) } catch { /* Storage can be unavailable. */ } }, [confirmedConditions])
  useEffect(() => { if (major && curricula.some((item) => item.department === major)) setDepartment(major) }, [major])
  useEffect(() => { try { localStorage.setItem('timetable:curriculum:2025', department) } catch { /* Storage can be unavailable. */ } }, [department])
  const curriculum = curricula.find((item) => item.department === department) || curricula[0]
  const classified = entries.map((entry) => ({ ...entry, category: categoryForDepartment(entry, curriculum, courses) }))
  const stats = academicStats(classified)
  const planned = courses.filter((course) => selected.includes(course.courseId) && !entries.some((entry) => entry.code === course.courseId && passed(entry)))
  const required = curriculum.courses.filter((course) => course.required)
  const catalog = new Map<string, Entry>()
  for (const course of courses) catalog.set(course.courseId, { code: course.courseId, name: course.courseName, credits: course.credits, category: course.category, area: course.detailCategories.find((area) => ['글쓰기', '발표와토론', '외국어기초', '인문기초', '과학기초', 'AI/데이터', '글로벌언어', '인간과문화', '인간과사회', '과학과기술', '예술과체육', '융복합', '인성', '실무', '실기', '신문과미디어'].includes(area)) || '', grade: 'A' })
  for (const [index, course] of curriculum.courses.entries()) { const code = course.course_code || `curriculum:${department}:${index}`; catalog.set(code, { code, name: course.name, credits: course.credits, category: course.category, area: catalog.get(code)?.area || '', grade: 'A' }) }
  for (const entry of entries) if (!catalog.has(entry.code)) catalog.set(entry.code, entry)
  const matches = [...catalog.values()].filter((entry) => (entry.name + entry.code + entry.category).toLowerCase().includes(search.toLowerCase()))
  const labels: Record<string, string> = { total: '졸업 최소학점', major_required: '전공필수', major_elective: '전공선택', major_total: '전공 전체', general_education: '교양' }
  const addManual = () => {
    const credits = Number(manualCredits)
    if (!manualName.trim() || !manualCredits.trim() || !Number.isFinite(credits) || credits < 0 || credits > 30) { setManualError('과목명과 0~30 사이의 학점을 입력해 주세요.'); return }
    const code = manualCode.trim() || `manual:${crypto.randomUUID()}`
    if (entries.some((entry) => entry.code === code)) { setManualError('이미 입력한 학수번호예요. 목록에서 성적을 수정해 주세요.'); return }
    update({ code, name: manualName.trim(), credits, category: manualCategory, area: manualArea, grade: manualGrade, department }, code); setManualName(''); setManualCode(''); setManualError('')
  }
  return <section className={view !== 'overview' ? 'academic-panel academic-records' + (view === 'manual' ? ' academic-manual-only' : '') : 'academic-panel academic-overview'} id={view === 'overview' ? 'academic-panel' : 'completed-course-panel'}>{view === 'overview' && <div className="academic-title"><div><span className="eyebrow">YOUR ACADEMIC RECORD</span><h2>요람 · 이수 · 성적 관리</h2><p>2025학번 기준 {curricula.length}개 학과 · 변경 사항은 시간표 선택에 바로 반영됩니다.</p></div><label>요람 학과<select value={department} onChange={(event) => setDepartment(event.target.value)}>{curricula.map((item) => <option key={item.department}>{item.department}</option>)}</select></label></div>}<div className="academic-columns">{view === 'overview' && <div><h3>학점 진행 상황</h3>{Object.entries(labels).map(([key, label]) => { const earned = stats[key as keyof typeof stats] as number; const target = curriculum.credit_requirements[key]; const plannedCredits = planned.reduce((sum, course) => { const category = categoryForDepartment({ code: course.courseId, name: course.courseName, credits: course.credits, category: course.category, area: '', grade: 'A' }, curriculum, courses); const counts = key === 'total' || (key === 'major_required' && isRequired(category)) || (key === 'major_elective' && isElective(category)) || (key === 'major_total' && isMajor(category)) || (key === 'general_education' && isGeneral(category)); return sum + (counts ? course.credits : 0) }, 0); return <div className="academic-progress" key={key}><strong>{label}</strong><span>취득 {earned} / {target ?? '기준 미확인'}{target !== null ? '학점' : ''} · 이번 선택 {plannedCredits}학점</span>{typeof target === 'number' && target > 0 ? <progress max={target} value={Math.min(earned, target)} /> : <div className="academic-progress-unavailable" role="img" aria-label={label + (target === 0 ? ': 최소학점 조건 없음' : ': 기준 미확인으로 달성률 계산 불가')} />} </div> })}<h3>전공필수 체크리스트</h3>{required.length ? required.map((course, index) => { const code = course.course_code || `curriculum:${department}:${curriculum.courses.indexOf(course)}`; const done = classified.some((entry) => entry.code === code && passed(entry)); return <p key={course.course_code + index}>{done ? '✓ 이수' : selected.includes(course.course_code) ? '◷ 이번 선택' : '○ 미이수'} · {course.name} ({course.credits}학점)</p> }) : <p>자료에 지정된 전공필수가 없어요.</p>}<h3>교양 영역별 취득학점</h3>{[...new Set([...Object.values({ a: '글쓰기', b: '발표와토론', c: '외국어기초', d: '인문기초', e: '과학기초', f: 'AI/데이터', g: '글로벌언어', h: '인간과문화', i: '인간과사회', j: '과학과기술', k: '예술과체육', l: '융복합', m: '인성', n: '실무', o: '실기' }), ...classified.map((entry) => entry.area).filter(Boolean)])].map((area) => <span className="academic-area" key={area}>{area} {classified.filter((entry) => entry.area === area && passed(entry) && isGeneral(entry.category)).reduce((sum, entry) => sum + entry.credits, 0)}학점</span>)}<details><summary>교양 영역 조건 · 추가 조건 · 자료 확인 사항</summary>{curriculum.metadata?.additional_requirements?.map((item, index) => <div className="academic-source" key={index}><label><input type="checkbox" checked={!!confirmedConditions[department + index]} onChange={(event) => setConfirmedConditions((old) => ({ ...old, [department + index]: event.target.checked }))} />조건 확인 완료</label><p>{item.description}{item.source_pdf_page && <small>요람 {item.source_pdf_page}쪽</small>}</p></div>)}{curriculum.unresolved_requirements.map((text, index) => <p className="academic-source" key={index}>{text}</p>)}</details></div>}{view !== 'overview' && <div><h3>이수 수업 체크</h3><label>강좌 찾기<input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="과목명 · 학수번호" /></label><p>이수 체크와 성적 입력 후 일반 수업 목록에 바로 반영돼요.</p><div className="academic-course-list">{matches.filter((entry) => view === 'records' || curriculum.courses.some((course) => course.course_code ? course.course_code === entry.code : course.name === entry.name)).map((entry) => { const saved = entries.find((item) => item.code === entry.code); const offered = courses.some((course) => course.courseId === entry.code); return <article className="academic-course" key={entry.code}><label><input type="checkbox" checked={!!saved} onChange={(event) => update(event.target.checked ? entry : null, entry.code)} /><strong>{entry.name}</strong></label><small>{entry.category} · {entry.credits}학점 · {offered ? '이번 학기 개설' : '이번 학기 미개설 / 직접 입력'}{entry.code.startsWith('curriculum:') ? ' · 학수번호 미확인' : ''}</small>{saved && <div><label>성적<select value={saved.grade} onChange={(event) => update({ ...saved, grade: event.target.value }, entry.code)}>{grades.map((grade) => <option key={grade}>{grade}</option>)}</select></label><label>교양 영역<input value={saved.area} onChange={(event) => update({ ...saved, area: event.target.value }, entry.code)} placeholder="자료의 영역명" /></label></div>}</article> })}</div><details><summary>목록에 없는 과목 직접 입력</summary><div className="academic-manual"><label>과목명<input value={manualName} onChange={(event) => setManualName(event.target.value)} /></label><label>학수번호 (선택)<input value={manualCode} onChange={(event) => setManualCode(event.target.value)} /></label><label>학점<input type="number" min="0" max="30" step="0.5" value={manualCredits} onChange={(event) => setManualCredits(event.target.value)} /></label><label>구분<select value={manualCategory} onChange={(event) => setManualCategory(event.target.value)}>{['전공필수', '전공선택', '교양', '기타'].map((category) => <option key={category}>{category}</option>)}</select></label><label>교양 영역<input value={manualArea} onChange={(event) => setManualArea(event.target.value)} /></label><label>성적<select value={manualGrade} onChange={(event) => setManualGrade(event.target.value)}>{grades.map((grade) => <option key={grade}>{grade}</option>)}</select></label><button onClick={addManual}>이수 과목 추가</button>{manualError && <p role="alert">{manualError}</p>}</div></details></div>}</div></section>
}
