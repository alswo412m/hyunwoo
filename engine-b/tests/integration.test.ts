import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { buildCatalog, createRequest, createDemoStudent, checkCurriculum, generateTimetables, resolveCandidate, saveTimetable, loadTimetable, validateCurriculum, validateOfferings } from '../dist/index.js';
const read = (file:string)=>JSON.parse(readFileSync(file,'utf8'));
const hasData = ['data/courses_2026_2.json','data/curricula/index.json','data/curricula/curriculum_police_2025.json'].every(existsSync);
const realTest = hasData ? test : test.skip;
const data=hasData ? read('data/courses_2026_2.json') : null;
const index=hasData ? read('data/curricula/index.json') : null;
const police=hasData ? read('data/curricula/curriculum_police_2025.json') : null;
realTest('all provided curricula and offerings validate and build catalogs',()=>{
 validateOfferings(data);
 assert.equal(data.courses.length,1521);
 for(const entry of index.departments){const c=read(`data/curricula/${entry.file}`);validateCurriculum(c);const cat=buildCatalog(data,c,createDemoStudent(c));assert.ok(cat.length>0);assert.ok(cat.every(course=>course.sections.length>0))}
});
realTest('actual police data -> combinations -> curriculum projections -> storage',()=>{
 const student=createDemoStudent(police);
 const own=new Set(police.courses.map(c=>c.course_code));
 const cat=buildCatalog(data,police,student).filter(c=>own.has(c.courseId)&&!c.completed);
 assert.ok(cat.length>2);
 const req=createRequest(data,police,student,cat.slice(0,3).map(c=>({courseId:c.courseId,mustInclude:false,priority:1})));
 const result=generateTimetables(req);assert.ok(result.candidates.length);
 const selected=result.candidates[0];
 const planned=resolveCandidate(req,selected);
 const report=checkCurriculum(police,student,planned);
 assert.equal(report.credits.total.projected,report.credits.total.earned+report.credits.total.planned);
 assert.equal(report.credits.major_total.planned,report.credits.major_elective.planned+report.credits.major_required.planned);
 const map=new Map<string,string>();const storage={getItem:(k:string)=>map.get(k)??null,setItem:(k:string,v:string)=>map.set(k,v),removeItem:(k:string)=>{map.delete(k)}};
 saveTimetable(storage,'demo',{version:1,request:req,selected});
 const restored=loadTimetable(storage,'demo');assert.ok(restored);assert.deepEqual(restored.selected?.sections,selected.sections);
 map.set('demo','{"version":99}');assert.equal(loadTimetable(storage,'demo'),null);
});
realTest('duplicate courses do not add credits, required and null criteria remain distinct',()=>{
 const curriculum=structuredClone(police);curriculum.credit_requirements.total=null;
 const required=curriculum.courses[0];required.required=true;
 const student=createDemoStudent(curriculum);
 const completed=student.completed.find(c=>c.courseCode===required.course_code)!;
 const duplicate={courseId:completed.courseCode,courseName:completed.name,credits:completed.credits,category:'전선',requirement:'required' as const,sections:[]};
 const report=checkCurriculum(curriculum,student,[duplicate,duplicate]);
 assert.equal(report.credits.total.planned,0);assert.equal(report.credits.total.remaining,null);
 assert.equal(report.requiredCourses[0].status,'completed');assert.deepEqual(report.duplicatePlannedCourseIds,[completed.courseCode]);
});
realTest('selection only includes chosen sections and rejects nonexistent references',()=>{
 const student=createDemoStudent(police);const cat=buildCatalog(data,police,student);const c=cat.find(c=>c.sections.length>1)!;
 const req=createRequest(data,police,student,[{courseId:c.courseId,sectionIds:[c.sections[0].sectionId]}]);assert.equal(req.courses[0].sections.length,1);
 assert.throws(()=>createRequest(data,police,student,[{courseId:c.courseId,sectionIds:['missing']}]),/Unknown section/);
});
realTest('unidentified required courses are preserved separately and cannot be marked completed',()=>{
 const c=read('data/curricula/curriculum_design_liberal_major_2025.json');
 const report=checkCurriculum(c,createDemoStudent(c));
 const unresolved=report.requiredCourses.filter(c=>c.status==='unresolved');
 assert.equal(unresolved.length,3);assert.equal(new Set(unresolved.map(c=>c.courseId)).size,3);
});
realTest('saving preserves original objects and rejects invalid later section data',()=>{
 const student=createDemoStudent(police);const cat=buildCatalog(data,police,student);
 const req=createRequest(data,police,student,[{courseId:cat[0].courseId}]);
 const selected=generateTimetables(req).candidates[0];
 const map=new Map<string,string>();const storage={getItem:(k:string)=>map.get(k)??null,setItem:(k:string,v:string)=>map.set(k,v),removeItem:(k:string)=>{map.delete(k)}};
 const state={version:1 as const,request:req,selected};const before=JSON.stringify(state);saveTimetable(storage,'x',state);assert.equal(JSON.stringify(state),before);
 req.courses[0].sections.push({sectionId:'bad',days:[{day:'MON',startTime:'bad',endTime:'10:00'}],classroom:null});
 assert.throws(()=>saveTimetable(storage,'x',{version:1,request:req,selected:null}),/Invalid time/);
});
