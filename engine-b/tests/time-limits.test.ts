import {test} from 'node:test';
import assert from 'node:assert/strict';
import {generateTimetables} from '../dist/index.js';
import type {TimetableRequest, TimeSlot} from '../dist/index.js';
const run = (days:TimeSlot[], limits:Partial<TimetableRequest['conditions']>) => generateTimetables({semester:'2026-2',major:'test',grade:null,courses:[{courseId:'a',courseName:'a',credits:3,category:'전선',requirement:'optional',sections:[{sectionId:'a1',classroom:null,days}]}],conditions:{minCredits:null,maxCredits:null,unavailableTimes:[],...limits}}).candidates.length;
const days:TimeSlot[]=[{day:'MON',startTime:'09:00',endTime:'10:00'},{day:'MON',startTime:'11:00',endTime:'12:00'}];
test('gap limits only apply between classes, with inclusive boundary',()=>{assert.equal(run(days,{maxGapMinutes:60}),1);assert.equal(run(days,{maxGapMinutes:59}),0);assert.equal(run([days[0]],{maxGapMinutes:0}),1)});
test('daily teaching time excludes gaps and checks boundaries',()=>{assert.equal(run(days,{maxDailyMinutes:120}),1);assert.equal(run(days,{maxDailyMinutes:119}),0);assert.equal(run(days,{maxDailyMinutes:0}),0)});
test('separate weeks do not combine daily totals or gaps',()=>{assert.equal(run([{...days[0],weeks:[1]},{...days[1],weeks:[2]}],{maxDailyMinutes:60,maxGapMinutes:0}),1)});
