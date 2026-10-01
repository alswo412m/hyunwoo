import { test } from 'node:test';
import assert from 'node:assert/strict';
import { generateTimetables, timesOverlap } from '../src/index.ts';
import type { Course, TimetableRequest, TimeSlot } from '../src/index.ts';
const slot = (startTime: string, endTime: string, weeks?: number[]): TimeSlot => ({ day: 'MON', startTime, endTime, ...(weeks ? { weeks } : {}) });
const course = (id: string, times: TimeSlot[][]): Course => ({ courseId: id, courseName: id, credits: 3, category: '전선', requirement: 'optional', sections: times.map((days, i) => ({ sectionId: `${id}-${i}`, days, classroom: null })) });
const request = (courses: Course[]): TimetableRequest => ({ semester: '2026-2', major: '경찰학과', grade: 2, courses, conditions: { minCredits: null, maxCredits: null, unavailableTimes: [] } });
test('adjacent times allowed; overlapping weeks required', () => {
 assert.equal(timesOverlap(slot('13:30','15:00'),slot('15:00','16:00')),false);
 assert.equal(timesOverlap(slot('13:30','15:00'),slot('14:00','16:00')),true);
 assert.equal(timesOverlap(slot('13:30','15:00',[1,2]),slot('13:30','15:00',[3,4])),false);
});
test('all section combinations, with conflicts removed', () => {
 const r = request([course('a',[[slot('09:00','10:00')],[slot('10:00','11:00')]]),course('b',[[slot('09:30','10:30')],[slot('11:00','12:00')]])]);
 const result = generateTimetables(r);
 assert.equal(result.candidates.length,2);
 assert.ok(result.candidates.every(c => c.sections.length === 2 && c.totalCredits === 6));
});
test('incomplete and missing times treated as online, including known partial slots', () => {
 const a = course('a',[[slot('09:00','10:00')]]);
 a.sections[0].timeStatus = 'partial';
 const r = request([a,course('b',[[slot('09:00','10:00')]]),course('c',[[]])]);
 const result = generateTimetables(r);
 assert.equal(result.candidates.length,1);
 assert.deepEqual(result.candidates[0].summary.assumedOnlineSectionIds,['a-0','c-0']);
});
test('all meetings and unavailable times participate in conflicts', () => {
 const r = request([course('a',[[slot('09:00','10:00'),slot('15:00','16:00')]])]);
 r.conditions.unavailableTimes = [slot('15:30','16:30')];
 assert.equal(generateTimetables(r).candidates.length,0);
});
test('priority ranks alternatives; curriculum required marker does not force inclusion', () => {
 const a = course('a',[[slot('09:00','10:00')]]);
 const b = course('b',[[slot('09:00','10:00')]]);
 a.mustInclude = false; a.priority = 2; a.requirement = 'required';
 b.mustInclude = false; b.priority = 1;
 const result = generateTimetables(request([a,b]));
 assert.equal(result.candidates.length,2);
 assert.equal(result.candidates[0].sections[0].courseId,'b');
 assert.deepEqual(result.candidates[1].summary.requiredCourseIds,['a']);
});
test('credit boundaries and invalid input', () => {
 const r = request([course('a',[[]]),course('b',[[]])]);
 r.conditions.minCredits = 6; r.conditions.maxCredits = 6;
 assert.equal(generateTimetables(r).candidates.length,1);
 r.conditions.maxCredits = 3;
 assert.match(generateTimetables(r).message!,/입력 오류/);
 const bad = request([course('a',[[slot('25:00','26:00')]])]);
 assert.equal(generateTimetables(bad).candidates.length,0);
 assert.equal(generateTimetables(request([course('a',[[]]),course('a',[[]])])).candidates.length,0);
});
test('required inclusion and empty options return no results', () => {
 assert.equal(generateTimetables(request([course('a',[])])).candidates.length,0);
 assert.equal(generateTimetables(request([])).candidates.length,0);
 assert.equal(generateTimetables(request([course('a',[[slot('09:00','10:00')]]),course('b',[[slot('09:30','10:30')]])])).candidates.length,0);
});
