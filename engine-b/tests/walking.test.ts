import {test} from 'node:test';
import assert from 'node:assert/strict';
import {analyzeWalking,identifyBuilding,generateTimetables} from '../dist/index.js';
import type {Course} from '../dist/index.js';
function course(id:string,start:string,end:string,location:string|null,weeks?:number[]):Course{return {courseId:id,courseName:id,credits:3,category:'전선',requirement:'optional',sections:[{sectionId:id,days:[{day:'MON',startTime:start,endTime:end,weeks,classroom:location}],classroom:location}]}}
test('consecutive classes report actual walking, never reject otherwise valid schedule',()=>{
 const courses=[course('A','13:30','15:00','학생회관 101'),course('B','15:00','16:00','의학관 202')];
 const r=analyzeWalking(courses);assert.equal(r.days[0].totalSeconds,301);assert.equal(r.days[0].transitions[0].consecutive,true);assert.equal(r.days[0].transitions[0].insufficientGap,true);
 const out=generateTimetables({semester:'2026-2',major:'경찰학과',grade:2,courses,conditions:{minCredits:null,maxCredits:null,unavailableTimes:[]}});assert.equal(out.candidates.length,1);assert.equal(out.candidates[0].summary.walking.days[0].totalSeconds,301);assert.equal(out.candidates[0].summary.travelWarnings.length,1);
});
test('daily total includes all consecutive pairs with breaks and directional routes',()=>{
 const r=analyzeWalking([course('A','09:00','10:00','학생회관 101'),course('B','11:00','12:00','의학관 101'),course('C','15:00','16:00','학생회관 202')]);
 assert.equal(r.days[0].transitions.length,2);assert.ok(r.days[0].totalSeconds!>301);assert.equal(r.days[0].transitions[0].insufficientGap,false);
});
test('unknown location does not become zero; same building excludes indoor movement',()=>{
 assert.equal(identifyBuilding('생명과학관 부속동 101'),null);
 assert.equal(analyzeWalking([course('A','09:00','10:00','없는건물'),course('B','11:00','12:00','학생회관 101')]).days[0].totalSeconds,null);
 assert.equal(analyzeWalking([course('A','09:00','10:00','학생회관 101'),course('B','11:00','12:00','학생회관 202')]).days[0].totalSeconds,0);
});
test('intensive weeks separated and online assumed courses excluded',()=>{
 const r=analyzeWalking([course('A','09:00','10:00','학생회관 101',[1,2]),course('B','10:00','11:00','의학관 101',[3,4])]);assert.ok(r.days.every(d=>d.totalSeconds===0));
 const online=course('online','10:00','11:00','미확인');online.sections[0].timeStatus='partial';
 const report=analyzeWalking([course('A','09:00','10:00','학생회관 101'),online,course('B','12:00','13:00','의학관 101')]);assert.equal(report.days[0].totalSeconds,301);
});
