import { generateTimetables, validateTimetableRequest } from './engine.js';
import type { Course, Day, TimetableRequest, TimetableResponse } from './engine.js';
export type CreditCategory = 'general_education' | 'major_required' | 'major_elective' | 'other';
export type CreditKey = CreditCategory | 'total' | 'major_total';
export type Curriculum = {
  curriculum_year: number; admission_year: number; department: string; degree_type: string;
  credit_requirements: Record<Exclude<CreditKey, 'other'>, number | null>;
  courses: Array<{ course_code: string; name: string; credits: number; category: string; required: boolean; recommended_grade: number; recommended_semesters: number[] }>;
  unresolved_requirements: string[];
  metadata?: { single_major_applicability?: string; additional_requirements?: Array<{ description: string; source_pdf_page?: number }> };
};
export type CurriculumIndex = { curriculum_year: number; admission_year: number; departments: Array<{ department_id: string; department: string; college: string | null; file: string }> };
export type RawOffering = {
  course_code: string; offering_id: string; section: string; name: string; credits: number;
  category: string; department: string | null; professor: string | null; cancelled: boolean;
  time_status: 'parsed' | 'missing' | 'partial' | 'failed'; target_grades: number[];
  sessions: Array<{ day: string; start: string; end: string; location: string | null; weeks: number[] }>;
  enrollment_notes?: string;
};
export type OfferingData = { academic_year: number; semester: number; courses: RawOffering[] };
export type CompletedCourse = { courseCode: string; name: string; credits: number; category: CreditCategory };
export type Student = { id: string; admissionYear: number; major: string; grade: number; completed: CompletedCourse[] };
export type CatalogCourse = Course & { completed: boolean; department: string | null; targetGrades: number[]; notes: string[] };
export type CreditProgress = { target: number | null; earned: number; planned: number; projected: number; remaining: number | null; satisfied: boolean | null };
export type CurriculumReport = {
  credits: Record<Exclude<CreditKey, 'other'>, CreditProgress>;
  requiredCourses: Array<{ courseId: string; name: string; status: 'completed' | 'planned' | 'missing' | 'unresolved' }>;
  unresolvedRequirements: string[];
  duplicatePlannedCourseIds: string[];
  creditCriteriaSatisfied: boolean | null;
  singleMajorApplicability: string;
};
const dayMap: Record<string, Day> = { 월:'MON', 화:'TUE', 수:'WED', 목:'THU', 금:'FRI', 토:'SAT', 일:'SUN' };
function categoryFor(code: string, category: string, curriculum: Curriculum): CreditCategory {
  const entry = curriculum.courses.find(c => c.course_code === code);
  const value = entry?.category ?? category;
  if (value === '전필' || value === '전공필수') return entry ? 'major_required' : 'other';
  if (['전선', '전선B', '전공선택'].includes(value)) return entry ? 'major_elective' : 'other';
  if (['기초','소양','심화','교양','기교','지교'].includes(value)) return 'general_education';
  return 'other';
}
export function validateCurriculum(value: unknown): asserts value is Curriculum {
  const c = value as Curriculum;
  if (!c || !Number.isInteger(c.curriculum_year) || !Number.isInteger(c.admission_year) || typeof c.department !== 'string' || !Array.isArray(c.courses) || !c.credit_requirements || !Array.isArray(c.unresolved_requirements)) throw new Error('Invalid curriculum JSON');
  for (const key of ['total','general_education','major_required','major_elective','major_total'] as const) {
    const v = c.credit_requirements[key];
    if (v !== null && (!Number.isFinite(v) || v < 0)) throw new Error(`Invalid credit requirement: ${key}`);
  }
  for (const course of c.courses) if (!course || typeof course.course_code !== 'string' || typeof course.name !== 'string' || typeof course.category !== 'string' || !Number.isFinite(course.credits) || course.credits < 0 || typeof course.required !== 'boolean') throw new Error('Invalid curriculum course');
}
export function validateOfferings(value: unknown): asserts value is OfferingData {
  const d = value as OfferingData;
  if (!d || !Number.isInteger(d.academic_year) || ![1,2].includes(d.semester) || !Array.isArray(d.courses)) throw new Error('Invalid offerings JSON');
  const ids = new Set<string>();
  for (const c of d.courses) {
    if (!c || typeof c.course_code !== 'string' || !c.course_code || typeof c.offering_id !== 'string' || typeof c.section !== 'string' || typeof c.name !== 'string' || typeof c.category !== 'string' || !Number.isFinite(c.credits) || c.credits < 0 || typeof c.cancelled !== 'boolean' || !Array.isArray(c.sessions) || !Array.isArray(c.target_grades) || !['parsed','missing','partial','failed'].includes(c.time_status)) throw new Error('Invalid offering');
    const id = `${c.offering_id}:${c.section}`;
    if (ids.has(id)) throw new Error(`Duplicate offering: ${id}`);
    ids.add(id);
    if (c.time_status === 'parsed') for (const s of c.sessions) if (!s || !dayMap[s.day] || !Array.isArray(s.weeks)) throw new Error(`Invalid session: ${id}`);
  }
}
export async function loadJson<T>(url: string, validate?: (value: unknown) => void): Promise<T> {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`JSON load failed (${response.status}): ${url}`);
  const data: unknown = await response.json(); validate?.(data); return data as T;
}
/** C data -> A catalog, grouped by course code. Only explicit selection creates engine input. */
export function buildCatalog(data: OfferingData, curriculum: Curriculum, student: Student): CatalogCourse[] {
  validateOfferings(data); validateCurriculum(curriculum);
  assertStudent(student, curriculum);
  const groups = new Map<string, CatalogCourse>();
  for (const raw of data.courses.filter(c => !c.cancelled)) {
    let group = groups.get(raw.course_code);
    if (!group) {
      group = { courseId: raw.course_code, courseName: raw.name, credits: raw.credits, category: raw.category,
        requirement: curriculum.courses.some(c => c.course_code === raw.course_code && c.required) ? 'required' : 'optional',
        sections: [], completed: student.completed.some(c => c.courseCode === raw.course_code), department: raw.department, targetGrades: [], notes: [] };
      groups.set(raw.course_code, group);
    }
    if (group.credits !== raw.credits) throw new Error(`Conflicting credits for ${raw.course_code}`);
    group.targetGrades = [...new Set([...group.targetGrades, ...raw.target_grades])];
    if (raw.enrollment_notes) group.notes = [...new Set([...group.notes, raw.enrollment_notes])];
    group.sections.push({ sectionId: `${raw.offering_id}:${raw.section}`, professor: raw.professor, classroom: raw.sessions[0]?.location ?? null, timeStatus: raw.time_status,
      days: raw.time_status !== 'parsed' ? [] : raw.sessions.map(s => ({ day: dayMap[s.day], startTime: s.start, endTime: s.end, weeks: s.weeks, classroom: s.location })) });
  }
  return [...groups.values()];
}
/** Preserve only candidates explicitly selected by user, or all sections when IDs omitted. */
export function createRequest(data: OfferingData, curriculum: Curriculum, student: Student,
  selections: Array<{ courseId: string; sectionIds?: string[]; priority?: number; mustInclude?: boolean }>,
  conditions: TimetableRequest['conditions'] = { minCredits: null, maxCredits: null, unavailableTimes: [] }): TimetableRequest {
  const catalog = buildCatalog(data, curriculum, student);
  const seen = new Set<string>();
  const courses = selections.map(selection => {
    if (seen.has(selection.courseId)) throw new Error('Duplicate course selection'); seen.add(selection.courseId);
    const course = catalog.find(c => c.courseId === selection.courseId);
    if (!course) throw new Error(`Unknown course: ${selection.courseId}`);
    if (selection.sectionIds?.some(id => !course.sections.some(s => s.sectionId === id))) throw new Error('Unknown section');
    return { ...course, sections: selection.sectionIds ? course.sections.filter(s => selection.sectionIds!.includes(s.sectionId)) : course.sections,
      priority: selection.priority, mustInclude: selection.mustInclude ?? true };
  });
  return { semester: `${data.academic_year}-${data.semester}`, major: curriculum.department, grade: student.grade, courses, conditions };
}
function assertStudent(student: Student, curriculum: Curriculum): void {
  if (!student || student.admissionYear !== curriculum.admission_year || student.major !== curriculum.department || !Array.isArray(student.completed)) throw new Error('Student curriculum mismatch');
  for (const c of student.completed) if (!c.courseCode || !Number.isFinite(c.credits) || c.credits < 0 || !['general_education','major_required','major_elective','other'].includes(c.category)) throw new Error('Invalid completed course');
}
export function createDemoStudent(curriculum: Curriculum): Student {
  validateCurriculum(curriculum);
  const seen = new Set<string>();
  const completed: CompletedCourse[] = curriculum.courses.filter(c => c.course_code && c.recommended_grade === 1).filter(c => {
    if (seen.has(c.course_code)) return false; seen.add(c.course_code); return true;
  }).slice(0, 8).map(c => ({ courseCode: c.course_code, name: c.name, credits: c.credits, category: categoryFor(c.course_code,c.category,curriculum) }));
  for (let i = 1; i <= 6; i++) completed.push({ courseCode: `DEMO-GE-${i}`, name: `가상 교양 ${i}`, credits: 3, category: 'general_education' });
  return { id: 'demo_student', admissionYear: curriculum.admission_year, major: curriculum.department, grade: 2, completed };
}
export function checkCurriculum(curriculum: Curriculum, student: Student, planned: Course[] = []): CurriculumReport {
  validateCurriculum(curriculum); assertStudent(student, curriculum);
  const earned = { total:0, general_education:0, major_required:0, major_elective:0, major_total:0 };
  const pending = { ...earned }; const completed = new Set<string>(); const plannedCodes = new Set<string>(); const duplicates: string[] = [];
  function add(bucket: typeof earned, credits: number, category: CreditCategory): void {
    bucket.total += credits;
    if (category !== 'other') bucket[category] += credits;
    if (category === 'major_required' || category === 'major_elective') bucket.major_total += credits;
  }
  for (const c of student.completed) if (!completed.has(c.courseCode)) {
    completed.add(c.courseCode); add(earned,c.credits, curriculum.courses.some(e => e.course_code === c.courseCode) ? categoryFor(c.courseCode,c.category,curriculum) : c.category);
  }
  for (const c of planned) {
    if (!Number.isFinite(c.credits) || c.credits < 0) throw new Error('Invalid planned credits');
    if (completed.has(c.courseId) || plannedCodes.has(c.courseId)) { duplicates.push(c.courseId); continue; }
    plannedCodes.add(c.courseId); add(pending,c.credits,categoryFor(c.courseId,c.category,curriculum));
  }
  const credits = Object.fromEntries(Object.keys(earned).map(k => {
    const key = k as keyof typeof earned; const target = curriculum.credit_requirements[key]; const projected = earned[key]+pending[key];
    return [key,{ target, earned:earned[key], planned:pending[key], projected, remaining: target === null ? null : Math.max(0,target-projected), satisfied: target === null ? null : projected >= target }];
  })) as CurriculumReport['credits'];
  const requiredCourses = [...new Map(curriculum.courses.filter(c => c.required).map(c => [c.course_code || `unresolved:${c.name}`,c])).values()].map(c => ({ courseId:c.course_code || `unresolved:${c.name}`,name:c.name,status: !c.course_code ? 'unresolved' as const : completed.has(c.course_code) ? 'completed' as const : plannedCodes.has(c.course_code) ? 'planned' as const : 'missing' as const }));
  const values = Object.values(credits).map(v => v.satisfied);
  const applicability = curriculum.metadata?.single_major_applicability ?? 'unconfirmed';
  return { credits, requiredCourses, singleMajorApplicability:applicability, duplicatePlannedCourseIds:[...new Set(duplicates)],
    unresolvedRequirements: [...curriculum.unresolved_requirements,...curriculum.courses.filter(c => !c.course_code).map(c => `${c.name}: 학수번호 미확인, 자동 연결 불가`),...(curriculum.metadata?.additional_requirements ?? []).map(r => r.description)],
    creditCriteriaSatisfied: applicability === 'not_single_major' || applicability === 'unconfirmed' ? null : values.includes(false) ? false : values.includes(null) ? null : true };
}
export function resolveCandidate(request: TimetableRequest, candidate: TimetableResponse['candidates'][number]): Course[] {
  const seen = new Set<string>();
  return candidate.sections.map(ref => {
    const c = request.courses.find(c => c.courseId === ref.courseId);
    const s = c?.sections.find(s => s.sectionId === ref.sectionId);
    if (!c || !s || seen.has(ref.courseId)) throw new Error('Invalid candidate reference'); seen.add(ref.courseId);
    return { ...c, sections:[s] };
  });
}
export type StorageLike = { getItem(key: string): string | null; setItem(key: string, value: string): void; removeItem(key: string): void };
export type SavedTimetable = { version: 1; request: TimetableRequest; selected: TimetableResponse['candidates'][number] | null };
export function saveTimetable(storage: StorageLike, key: string, state: SavedTimetable): void {
  const copy = structuredClone(state); validateSaved(copy); storage.setItem(key,JSON.stringify(copy));
}
export function loadTimetable(storage: StorageLike, key: string): SavedTimetable | null {
  const text = storage.getItem(key); if (text === null) return null;
  try { const state = JSON.parse(text) as SavedTimetable; validateSaved(state); return state; }
  catch { return null; }
}
function validateSaved(state: SavedTimetable): void {
  if (!state || state.version !== 1 || !state.request || state.selected === undefined) throw new Error('Invalid saved timetable');
  validateTimetableRequest(state.request);
  if (state.selected) {
    const courses = resolveCandidate(state.request,state.selected);
    if (state.request.courses.some(c => c.mustInclude !== false && !courses.some(p => p.courseId === c.courseId))) throw new Error('Missing required selection');
    const result = generateTimetables({ ...state.request,courses: courses.map(c => ({ ...c,mustInclude:true })) });
    if (!result.candidates.length) throw new Error('Invalid selected timetable');
    state.selected = result.candidates[0];
  }
}
