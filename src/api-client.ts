import type { TimetableRequest, TimetableResponse } from './engine.js';
import type { CatalogCourse, Curriculum, CurriculumIndex, CurriculumReport, Student } from './helpers.js';
export type SectionReference = { courseId: string; sectionId: string };
export type CurriculumCheckRequest = {
  departmentId: string;
  semester: string;
  student: Student;
  plannedSections: SectionReference[];
};
export type ApiErrorResponse = { error: { code: string; message: string } };
/** Same-origin by default; set baseUrl to the B server URL for a separate A frontend. */
export function createApiClient(baseUrl = '') {
  async function call<T>(path: string, body?: unknown): Promise<T> {
    const response = await fetch(`${baseUrl.replace(/\/$/, '')}${path}`, {
      method: body === undefined ? 'GET' : 'POST',
      ...(body === undefined ? {} : { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
    });
    const data = await response.json();
    if (!response.ok) throw new Error((data as ApiErrorResponse).error?.message ?? `API error (${response.status})`);
    return data as T;
  }
  const query = (departmentId: string, semester?: string) => new URLSearchParams({ departmentId, ...(semester ? { semester } : {}) });
  return {
    departments: () => call<CurriculumIndex>('/api/departments'),
    curriculum: (departmentId: string) => call<Curriculum>(`/api/curriculum?${query(departmentId)}`),
    demoStudent: (departmentId: string) => call<Student>(`/api/demo-student?${query(departmentId)}`),
    catalog: (departmentId: string, semester: string) => call<{ semester: string; courses: CatalogCourse[] }>(`/api/catalog?${query(departmentId,semester)}`),
    generate: (request: TimetableRequest) => call<TimetableResponse>('/api/timetables/generate',request),
    check: (request: CurriculumCheckRequest) => call<CurriculumReport>('/api/curriculum/check',request)
  };
}
