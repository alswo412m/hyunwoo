import {test} from 'node:test';
import assert from 'node:assert/strict';
import {existsSync} from 'node:fs';
import {createApiServer} from '../dist/server.js';
const realTest=existsSync('data/curricula/index.json')?test:test.skip;
realTest('HTTP API: data, canonical generation, check, errors, CORS and private files',async()=>{
 const server=await createApiServer();await new Promise<void>(r=>server.listen(0,'127.0.0.1',r));
 const address=server.address();if(!address||typeof address==='string')throw Error('Missing port');
 const base=`http://127.0.0.1:${address.port}`;
 const get=async(path:string)=>{const r=await fetch(base+path);assert.equal(r.status,200);return r.json()};
 const post=(path:string,body:unknown)=>fetch(base+path,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
 try{
  assert.equal((await get('/api/departments')).departments.length,49);
  const student=await get('/api/demo-student?departmentId=police');
  const {courses}=await get('/api/catalog?departmentId=police&semester=2026-2');
  const course=courses[0];const req={semester:'2026-2',major:'경찰학과',grade:2,courses:[{...course,credits:999,sections:[course.sections[0]]}],conditions:{minCredits:null,maxCredits:null,unavailableTimes:[]}};
  const generated=await post('/api/timetables/generate',req);assert.equal(generated.status,200);const result=await generated.json();assert.equal(result.candidates[0].totalCredits,course.credits);
  const check=await post('/api/curriculum/check',{departmentId:'police',semester:'2026-2',student,plannedSections:result.candidates[0].sections});assert.equal(check.status,200);assert.ok((await check.json()).credits.total);
  const empty={...req,courses:[]};assert.deepEqual((await (await post('/api/timetables/generate',empty)).json()).candidates,[]);
  req.courses[0].sections[0].sectionId='nonexistent';assert.equal((await post('/api/timetables/generate',req)).status,400);
  assert.equal((await post('/api/curriculum/check',{})).status,400);
  assert.equal((await fetch(base+'/api/catalog?departmentId=police&semester=2027-1')).status,404);
  assert.equal((await fetch(base+'/api/curriculum?departmentId=unknown')).status,404);
  const malformed=await fetch(base+'/api/timetables/generate',{method:'POST',headers:{'Content-Type':'application/json'},body:'{'});assert.equal(malformed.status,400);assert.equal((await malformed.json()).error.code,'INVALID_JSON');
  const preflight=await fetch(base+'/api/timetables/generate',{method:'OPTIONS',headers:{Origin:'http://localhost:5173'}});assert.equal(preflight.status,204);assert.equal(preflight.headers.get('access-control-allow-origin'),'http://localhost:5173');
  assert.equal((await fetch(base+'/api/departments',{headers:{Origin:'https://unknown.example'}})).status,403);
  assert.equal((await fetch(base+'/data/courses_2026_2.json')).status,404);
  assert.equal((await fetch(base+'/demo/')).status,200);
 }finally{await new Promise<void>((r,j)=>server.close(e=>e?j(e):r()));}
});
