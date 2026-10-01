import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {readFileSync,existsSync} from 'node:fs';
import {CampusDataClient,loadDataset} from '../dist/campus-data.js';
import {createApiServer} from '../dist/server.js';
const realTest=existsSync('data/curricula/index.json')?test:test.skip;
realTest('C API auth, department normalization, all pages, B proxy and safe error',async()=>{
 const index=JSON.parse(readFileSync('data/curricula/index.json','utf8'));
 const courses=JSON.parse(readFileSync('data/courses_2026_2.json','utf8')).courses;
 const offsets:number[]=[];let calls=0;
 const upstream=createServer((req,res)=>{
  assert.equal(req.headers.origin,undefined);calls++;
  if(req.headers['x-api-key']!=='test-only-credential'){res.writeHead(401);res.end('unauthorized');return}
  const url=new URL(req.url!,'http://localhost');let body:unknown;
  if(url.pathname==='/v1/departments')body={items:index.departments.map((d:any)=>({department_id:d.department_id,name:d.department}))};
  else if(url.pathname.startsWith('/v1/curricula/')){const id=url.pathname.split('/').pop();const d=index.departments.find((d:any)=>d.department_id===id);body=JSON.parse(readFileSync(`data/curricula/${d.file}`,'utf8'))}
  else if(url.pathname==='/v1/courses'){const offset=Number(url.searchParams.get('offset'));offsets.push(offset);assert.equal(url.searchParams.get('include_cancelled'),'true');body={total:courses.length,items:courses.slice(offset,offset+500)}}
  else if(url.pathname==='/v1/general-education/areas')body={items:[]};
  else if(url.pathname==='/v1/tables/travel_routes')body={total:0,items:[]};
  else {res.writeHead(404);res.end();return}
  res.setHeader('Content-Type','application/json');res.end(JSON.stringify(body));
 });
 await new Promise<void>(r=>upstream.listen(0,'127.0.0.1',r));const address=upstream.address();if(!address||typeof address==='string')throw Error('No port');
 const credentials={base_url:`http://127.0.0.1:${address.port}`,api_key:'test-only-credential'};
 let b:Awaited<ReturnType<typeof createApiServer>>|undefined;
 try{
  const dataset=await loadDataset({dataDir:'/unused',campusCredentials:credentials});
  assert.equal(dataset.source,'campus-api');assert.equal(dataset.offerings.courses.length,1521);assert.equal(dataset.index.departments.find(d=>d.department_id==='police')?.department,'경찰학과');assert.deepEqual(offsets,[0,500,1000,1500]);
  await assert.rejects(new CampusDataClient({...credentials,api_key:'wrong-test-credential'}).get('/v1/departments'),/HTTP 401/);
  b=await createApiServer({campusCredentials:credentials});await new Promise<void>(r=>b!.listen(0,'127.0.0.1',r));const a=b.address();if(!a||typeof a==='string')throw Error('No B port');const base=`http://127.0.0.1:${a.port}`;
  assert.equal((await (await fetch(base+'/api/health')).json()).dataSource,'campus-api');
  assert.deepEqual((await (await fetch(base+'/api/general-education/areas')).json()).items,[]);
  assert.deepEqual((await (await fetch(base+'/api/locations/travel-routes')).json()).items,[]);
  assert.equal((await fetch(base+'/config.json')).status,404);
  assert.ok(calls>49);
 }finally{if(b)await new Promise<void>(r=>b!.close(()=>r()));await new Promise<void>(r=>upstream.close(()=>r()))}
});
