import { test } from 'node:test';
import assert from 'node:assert/strict';
import { generateTimetables } from '../dist/index.js';
import type { Course, TimetableRequest } from '../dist/index.js';
const exempt: Course = { courseId:'exempt', courseName:'K-Project', credits:1, category:'전선', requirement:'optional', sections:[{ sectionId:'e', days:[], classroom:null, creditLimitExcluded:true }] };
const regular: Course = { ...exempt, courseId:'regular', credits:3, sections:[{ sectionId:'r', days:[], classroom:null }] };
const request = (courses:Course[], maxCredits:number|null):TimetableRequest => ({semester:'2026-2',major:'컴퓨터공학과',grade:null,courses,conditions:{minCredits:null,maxCredits,unavailableTimes:[]}});
test('exempt credits remain earned credits at zero or missing maximum',()=>{
 for (const maximum of [0,null]) { const result=generateTimetables(request([exempt],maximum)); assert.equal(result.candidates.length,1); assert.equal(result.candidates[0].totalCredits,1); }
});
test('maximum counts regular credits while keeping exempt credits in total',()=>{
 assert.equal(generateTimetables(request([regular,exempt],3)).candidates[0].totalCredits,4);
 assert.equal(generateTimetables(request([regular,exempt],2)).candidates.length,0);
});
test('exemption follows the selected section',()=>{
 const mixed={...regular,sections:[...regular.sections,...exempt.sections]};
 const result=generateTimetables(request([mixed],0)); assert.equal(result.candidates.length,1); assert.equal(result.candidates[0].sections[0].sectionId,'e');
});
