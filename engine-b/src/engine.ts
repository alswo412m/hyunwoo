import { analyzeWalking } from './walking.js';
import type { WalkingReport } from './walking.js';
export type Day = "MON" | "TUE" | "WED" | "THU" | "FRI" | "SAT" | "SUN";
export type TimeSlot = {
  day: Day;
  startTime: string;
  endTime: string;
  /** Omitted means all semester weeks. */
  weeks?: number[];
  classroom?: string | null;
};
export type Section = {
  creditLimitExcluded?: boolean;
  sectionId: string;
  days: TimeSlot[];
  classroom: string | null;
  professor?: string | null;
  timeStatus?: "parsed" | "missing" | "partial" | "failed";
};
export type Course = {
  courseId: string;
  courseName: string;
  credits: number;
  category: string;
  requirement: "required" | "optional";
  sections: Section[];
  /** Lower numbers rank first. Does not exclude any valid combination. */
  priority?: number;
  /** Default true: include every selected course. Set false to allow omission. */
  mustInclude?: boolean;
};
export type TimetableRequest = {
  semester: string;
  major: string;
  grade: number | null;
  courses: Course[];
  conditions: {
    minCredits: number | null;
    maxCredits: number | null;
    unavailableTimes: TimeSlot[];
  };
};
export type TimetableResponse = {
  candidates: Array<{
    candidateId: string;
    totalCredits: number;
    sections: Array<{ courseId: string; sectionId: string }>;
    summary: {
      classDays: number;
      lastClassTime: string | null;
      travelWarnings: string[];
      walking: WalkingReport;
      assumedOnlineSectionIds: string[];
      requiredCourseIds: string[];
      omittedCourseIds: string[];
    };
  }>;
  message?: string;
};

const DAYS: Day[] = ["MON", "TUE", "WED", "THU", "FRI", "SAT", "SUN"];
function minutes(time: string): number {
  if (typeof time !== "string" || !/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(time)) {
    throw new Error(`Invalid time: ${String(time)} (expected HH:MM)`);
  }
  const [h, m] = time.split(":").map(Number);
  return h * 60 + m;
}
function validateSlot(slot: TimeSlot): void {
  if (!slot || !DAYS.includes(slot.day)) throw new Error("Invalid weekday");
  if (minutes(slot.startTime) >= minutes(slot.endTime)) throw new Error("Start time must precede end time");
  if (slot.weeks !== undefined && (!Array.isArray(slot.weeks) || slot.weeks.length === 0 ||
      slot.weeks.some(w => !Number.isInteger(w) || w < 1))) throw new Error("Weeks must be positive integers in a nonempty array");
}
export function timesOverlap(a: TimeSlot, b: TimeSlot): boolean {
  validateSlot(a); validateSlot(b);
  return a.day === b.day &&
    (a.weeks === undefined || b.weeks === undefined || a.weeks.some(w => b.weeks!.includes(w))) &&
    minutes(a.startTime) < minutes(b.endTime) && minutes(b.startTime) < minutes(a.endTime);
}
function online(section: Section): boolean {
  return section.days.length === 0 || (section.timeStatus !== undefined && section.timeStatus !== "parsed");
}
function slots(section: Section): TimeSlot[] { return online(section) ? [] : section.days; }
export function validateTimetableRequest(request: TimetableRequest): void {
  if (!request || typeof request.semester !== "string" || !/^\d{4}-[12]$/.test(request.semester) ||
      typeof request.major !== "string" || !request.major.trim() ||
      (request.grade !== null && (!Number.isInteger(request.grade) || request.grade < 1)) ||
      !Array.isArray(request.courses) || !request.conditions ||
      !Array.isArray(request.conditions.unavailableTimes)) throw new Error("Invalid request structure");
  const { minCredits, maxCredits } = request.conditions;
  for (const value of [minCredits, maxCredits]) {
    if (value !== null && (!Number.isFinite(value) || value < 0)) throw new Error("Credit limits must be nonnegative or null");
  }
  if (minCredits !== null && maxCredits !== null && minCredits > maxCredits) throw new Error("minCredits exceeds maxCredits");
  request.conditions.unavailableTimes.forEach(validateSlot);
  const ids = new Set<string>();
  for (const course of request.courses) {
    if (!course || typeof course.courseId !== "string" || !course.courseId.trim() || ids.has(course.courseId)) throw new Error("Course IDs must be nonempty and unique");
    ids.add(course.courseId);
    if (typeof course.courseName !== "string" || !course.courseName.trim() || typeof course.category !== "string" ||
        !Number.isFinite(course.credits) || course.credits < 0 ||
        !["required", "optional"].includes(course.requirement) || !Array.isArray(course.sections) ||
        (course.mustInclude !== undefined && typeof course.mustInclude !== "boolean") ||
        (course.priority !== undefined && (!Number.isInteger(course.priority) || course.priority < 1))) throw new Error(`Invalid course: ${course.courseId}`);
    const sectionIds = new Set<string>();
    for (const section of course.sections) {
      if (!section || typeof section.sectionId !== "string" || !section.sectionId.trim() || sectionIds.has(section.sectionId) ||
          !Array.isArray(section.days) || (section.classroom !== null && typeof section.classroom !== "string") ||
          (section.timeStatus !== undefined && !["parsed", "missing", "partial", "failed"].includes(section.timeStatus))) throw new Error(`Invalid section in ${course.courseId}`);
      sectionIds.add(section.sectionId);
      // Incomplete times intentionally impose no timetable constraints.
      if (!online(section)) section.days.forEach(validateSlot);
    }
  }
}

/** Pure synchronous engine. Returns every valid nonempty combination, without truncation. */
export function generateTimetables(request: TimetableRequest): TimetableResponse {
  try { validateTimetableRequest(request); } catch (error) {
    return { candidates: [], message: `입력 오류: ${error instanceof Error ? error.message : String(error)}` };
  }
  const candidates: TimetableResponse["candidates"] = [];
  const ordered = request.courses.map((course, index) => ({ course, index })).sort((a, b) =>
    (a.course.priority ?? Number.MAX_SAFE_INTEGER) - (b.course.priority ?? Number.MAX_SAFE_INTEGER) || a.index - b.index);
  const selected: Array<{ course: Course; section: Section }> = [];
  function visit(index: number, credits: number, limitCredits: number): void {
    const { minCredits, maxCredits, unavailableTimes } = request.conditions;
    if (maxCredits !== null && limitCredits > maxCredits) return;
    if (index === ordered.length) {
      if (selected.length === 0 || (minCredits !== null && credits < minCredits)) return;
      const allSlots = selected.flatMap(x => slots(x.section));
      const last = allSlots.reduce<string | null>((latest, slot) => latest === null || slot.endTime > latest ? slot.endTime : latest, null);
      const walking = analyzeWalking(selected.map(x=>({...x.course,sections:[x.section]})));
      candidates.push({
        candidateId: `candidate_${candidates.length + 1}`,
        totalCredits: credits,
        sections: selected.map(x => ({ courseId: x.course.courseId, sectionId: x.section.sectionId })),
        summary: {
          classDays: new Set(allSlots.map(x => x.day)).size,
          lastClassTime: last,
          walking,
          travelWarnings: [...new Set(walking.days.flatMap(d=>d.transitions.filter(t=>t.insufficientGap||t.seconds===null).map(t=>t.seconds===null ? `${t.fromCourse} → ${t.toCourse}: 이동시간 미확인` : `${t.fromCourse} → ${t.toCourse}: 이동 약 ${(t.seconds!/60).toFixed(1)}분, 수업 사이 ${t.gapMinutes}분`)))],
          assumedOnlineSectionIds: selected.filter(x => online(x.section)).map(x => x.section.sectionId),
          requiredCourseIds: selected.filter(x => x.course.requirement === "required").map(x => x.course.courseId),
          omittedCourseIds: request.courses.filter(c => !selected.some(x => x.course.courseId === c.courseId)).map(c => c.courseId)
        }
      });
      return;
    }
    const { course } = ordered[index];
    for (const section of course.sections) {
      const nextSlots = slots(section);
      if (nextSlots.some((slot, i) => nextSlots.slice(i + 1).some(other => timesOverlap(slot, other)))) continue;
      if (nextSlots.some(slot => unavailableTimes.some(block => timesOverlap(slot, block)) ||
          selected.some(x => slots(x.section).some(other => timesOverlap(slot, other))))) continue;
      selected.push({ course, section });
      visit(index + 1, credits + course.credits, limitCredits + (section.creditLimitExcluded ? 0 : course.credits));
      selected.pop();
    }
    if (course.mustInclude === false) visit(index + 1, credits, limitCredits);
  }
  visit(0, 0, 0);
  // Lexicographic inclusion ranking: higher-priority courses dominate lower ones.
  candidates.sort((a, b) => {
    for (const { course } of ordered) {
      const delta = Number(b.sections.some(x => x.courseId === course.courseId)) - Number(a.sections.some(x => x.courseId === course.courseId));
      if (delta) return delta;
    }
    return b.totalCredits - a.totalCredits;
  });
  candidates.forEach((candidate, i) => { candidate.candidateId = `candidate_${i + 1}`; });
  return candidates.length ? { candidates } : { candidates: [], message: "선택한 강좌의 시간 충돌, 분반 후보 없음 또는 학점·비워둘 시간 조건으로 가능한 시간표가 없습니다." };
}
