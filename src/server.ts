import { existsSync } from 'node:fs';
import { loadDataset } from './campus-data.js';
import type { CampusCredentials } from './campus-data.js';
import { createServer } from 'node:http';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { readFile } from 'node:fs/promises';
import { resolve, dirname, extname, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Worker } from 'node:worker_threads';
import { validateTimetableRequest } from './engine.js';
import type { TimetableRequest, TimetableResponse, Course } from './engine.js';
import { validateCurriculum, validateOfferings, buildCatalog, createDemoStudent, checkCurriculum } from './helpers.js';
import type { Curriculum, CurriculumIndex, OfferingData, Student } from './helpers.js';
import type { CurriculumCheckRequest } from './api-client.js';
export class ApiError extends Error {
  constructor(public status: number, public code: string, message: string) { super(message); }
}
export type ServerOptions = { dataDir?: string; rootDir?: string; allowedOrigins?: string[]; generationTimeoutMs?: number; campusConfigFile?: string; campusCredentials?: CampusCredentials };
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const requiredString = (value: unknown, name: string): string => {
  if (typeof value !== 'string' || !value.trim()) throw new ApiError(400,'INVALID_INPUT',`${name} is required`);
  return value;
};
async function body(req: IncomingMessage): Promise<unknown> {
  if (req.headers['content-type']?.split(';')[0].trim().toLowerCase() !== 'application/json') throw new ApiError(415,'JSON_REQUIRED','Content-Type must be application/json');
  let length = 0; const chunks: Buffer[] = [];
  for await (const chunk of req) {
    length += chunk.length;
    if (length > 2 * 1024 * 1024) throw new ApiError(413,'BODY_TOO_LARGE','Request body exceeds 2 MB');
    chunks.push(chunk);
  }
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8')); }
  catch { throw new ApiError(400,'INVALID_JSON','Invalid JSON body'); }
}
export async function createApiServer(options: ServerOptions = {}) {
  const rootDir = options.rootDir ?? root; const dataDir = options.dataDir ?? resolve(rootDir,'data');
  const {index,curricula,offerings:data,source,campus} = await loadDataset({dataDir,campusConfigFile:options.campusConfigFile,campusCredentials:options.campusCredentials});
  const majors = new Map([...curricula].map(([id,c])=>[c.department,id]));
  const semester = `${data.academic_year}-${data.semester}`;
  const getCurriculum = (id: unknown) => {
    const c = curricula.get(requiredString(id,'departmentId'));
    if (!c) throw new ApiError(404,'DEPARTMENT_NOT_FOUND','Unknown department'); return c;
  };
  const checkSemester = (value: unknown) => { if (value !== semester) throw new ApiError(404,'SEMESTER_NOT_FOUND',`Available semester: ${semester}`); };
  const catalogFor = (curriculum: Curriculum) => buildCatalog(data,curriculum,createDemoStudent(curriculum));
  let active = 0;
  async function generate(request: TimetableRequest): Promise<TimetableResponse> {
    if (active >= 2) throw new ApiError(503,'ENGINE_BUSY','시간표 엔진이 사용 중입니다. 잠시 후 다시 요청하세요.');
    active++;
    try {
      return await new Promise<TimetableResponse>((resolveResult,reject) => {
        const worker = new Worker(new URL('./generation-worker.js',import.meta.url),{ workerData:request });
        const timer = setTimeout(() => { void worker.terminate(); reject(new ApiError(503,'GENERATION_TIMEOUT','조합 계산 시간이 초과되었습니다. 후보를 줄여 다시 요청하세요.')); }, options.generationTimeoutMs ?? 30000);
        worker.once('message',result => { clearTimeout(timer); resolveResult(result); void worker.terminate(); });
        worker.once('error',error => { clearTimeout(timer); reject(error); });
        worker.once('exit',code => { clearTimeout(timer); if (code !== 0) reject(new ApiError(503,'ENGINE_STOPPED','시간표 계산이 중단되었습니다.')); });
      });
    } finally { active--; }
  }
  const origins = new Set(options.allowedOrigins ?? ['http://localhost:5173','http://127.0.0.1:5173','http://localhost:3000','http://127.0.0.1:3000']);
  function send(res: ServerResponse,status: number,value: unknown) {
    res.writeHead(status,{ 'Content-Type':'application/json; charset=utf-8', 'Cache-Control':'no-store' });res.end(JSON.stringify(value));
  }
  return createServer(async (req,res) => {
    try {
      const url = new URL(req.url ?? '/', 'http://localhost');
      if (url.pathname.startsWith('/api/')) {
        const origin = req.headers.origin;
        const ownOrigin = `http://${req.headers.host}`;
        if (origin && origin !== ownOrigin && !origins.has(origin)) throw new ApiError(403,'ORIGIN_NOT_ALLOWED','Frontend origin is not allowed');
        if (origin) { res.setHeader('Access-Control-Allow-Origin',origin); res.setHeader('Vary','Origin'); }
        res.setHeader('Access-Control-Allow-Methods','GET, POST, OPTIONS');res.setHeader('Access-Control-Allow-Headers','Content-Type');
        if (req.method === 'OPTIONS') { res.writeHead(204);res.end();return; }
        if (req.method === 'GET') {
          if (url.pathname === '/api/health') { send(res,200,{ status:'ok',semester,departments:index.departments.length,dataSource:source });return; }
          if (url.pathname === '/api/departments') { send(res,200,index);return; }
          const extraRoutes: Record<string,string> = {
            '/api/general-education':'/v1/general-education',
            '/api/general-education/areas':'/v1/general-education/areas',
            '/api/locations/buildings':'/v1/tables/buildings',
            '/api/locations/rooms':'/v1/tables/rooms',
            '/api/locations/entrances':'/v1/tables/entrances',
            '/api/locations/travel-routes':'/v1/tables/travel_routes'
          };
          if (extraRoutes[url.pathname]) {
            if (!campus) throw new ApiError(503,'C_API_NOT_CONFIGURED','C API connection is required for this resource');
            const allowed = url.pathname.startsWith('/api/general-education') ? ['category','area'] : ['limit','offset','building_id'];
            const query: Record<string,string> = {};
            for(const [key,value] of url.searchParams) { if(!allowed.includes(key))throw new ApiError(400,'INVALID_INPUT',`Unsupported query: ${key}`);query[key]=value; }
            try { send(res,200,await campus.get(extraRoutes[url.pathname],query)); }
            catch { throw new ApiError(502,'C_API_UNAVAILABLE','C API 자료를 가져오지 못했습니다. C 서버 연결과 인증을 확인하세요.'); }
            return;
          }
          const known = ['/api/curriculum','/api/demo-student','/api/catalog'];
          if (!known.includes(url.pathname)) throw new ApiError(404,'NOT_FOUND','Unknown API endpoint');
          const c = getCurriculum(url.searchParams.get('departmentId'));
          if (url.pathname === '/api/curriculum') { send(res,200,c);return; }
          if (url.pathname === '/api/demo-student') { send(res,200,createDemoStudent(c));return; }
          checkSemester(url.searchParams.get('semester'));send(res,200,{ semester,courses:catalogFor(c) });return;
        }
        if (req.method === 'POST' && url.pathname === '/api/timetables/generate') {
          const input = await body(req) as TimetableRequest;
          try { validateTimetableRequest(input); } catch(error) { throw new ApiError(400,'INVALID_INPUT',String(error instanceof Error ? error.message : error)); }
          checkSemester(input.semester);
          const id = majors.get(input.major);if (!id) throw new ApiError(404,'DEPARTMENT_NOT_FOUND','Unknown major');
          const catalog = catalogFor(getCurriculum(id));
          // IDs and inclusion settings are client choices; credits/times/required flags come from C data.
          const courses = input.courses.map(choice => {
            const course = catalog.find(c => c.courseId === choice.courseId);
            if (!course) throw new ApiError(400,'UNKNOWN_COURSE',`Unknown course: ${choice.courseId}`);
            const sections = choice.sections.map(ref => {
              const section = course.sections.find(s => s.sectionId === ref.sectionId);
              if (!section) throw new ApiError(400,'UNKNOWN_SECTION',`Unknown section: ${ref.sectionId}`);return section;
            });
            return { ...course,sections,mustInclude:choice.mustInclude ?? true };
          });
          send(res,200,await generate({ ...input,courses }));return;
        }
        if (req.method === 'POST' && url.pathname === '/api/curriculum/check') {
          const input = await body(req) as CurriculumCheckRequest;
          if (!input || !Array.isArray(input.plannedSections)) throw new ApiError(400,'INVALID_INPUT','plannedSections must be an array');
          checkSemester(input.semester); const c = getCurriculum(input.departmentId);
          const catalog = catalogFor(c); const ids = new Set<string>();
          const planned: Course[] = input.plannedSections.map(ref => {
            if (!ref || typeof ref.courseId !== 'string' || typeof ref.sectionId !== 'string' || ids.has(ref.courseId)) throw new ApiError(400,'INVALID_INPUT','Invalid or duplicate planned course');
            ids.add(ref.courseId);
            const course = catalog.find(c => c.courseId === ref.courseId);const section = course?.sections.find(s => s.sectionId === ref.sectionId);
            if (!course || !section) throw new ApiError(400,'UNKNOWN_SECTION','Unknown planned course/section');
            return { ...course,sections:[section] };
          });
          let report;
          try { report = checkCurriculum(c,input.student as Student,planned); }
          catch(error) { throw new ApiError(400,'INVALID_INPUT',String(error instanceof Error ? error.message : error)); }
          send(res,200,report);return;
        }
        throw new ApiError(405,'METHOD_NOT_ALLOWED','Unsupported API method or endpoint');
      }
      if (req.method !== 'GET' && req.method !== 'HEAD') throw new ApiError(405,'METHOD_NOT_ALLOWED','GET required');
      // Only the demo and compiled browser modules are public. C source data stays server-side.
      let path = decodeURIComponent(url.pathname);if (path === '/') path = '/demo/';if (path.endsWith('/')) path += 'index.html';
      if (!/^\/(demo|dist)\//.test(path) || !['.html','.js','.css','.map'].includes(extname(path))) throw new ApiError(404,'NOT_FOUND','File not found');
      const file = resolve(rootDir,`.${path}`);
      const area = resolve(rootDir,path.startsWith('/demo/') ? 'demo' : 'dist')+sep;
      if (!file.startsWith(area)) throw new ApiError(404,'NOT_FOUND','File not found');
      const contents = await readFile(file);
      const mime: Record<string,string> = { '.html':'text/html','.js':'text/javascript','.css':'text/css','.map':'application/json' };
      res.writeHead(200,{ 'Content-Type':`${mime[extname(file)]}; charset=utf-8`,'Cache-Control':'no-cache' });res.end(req.method === 'HEAD' ? undefined : contents);
    } catch(error) {
      if (res.headersSent) { res.end();return; }
      const failure = error instanceof ApiError ? error : (error as NodeJS.ErrnoException)?.code === 'ENOENT' ? new ApiError(404,'NOT_FOUND','File not found') : new ApiError(500,'INTERNAL_ERROR','Server error');
      if (failure.status === 500) console.error(error);
      send(res,failure.status,{ error:{code:failure.code,message:failure.message} });
    }
  });
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const port = Number(process.env.PORT ?? 4173); const host = process.env.HOST ?? '127.0.0.1';
    const configPath = resolve(root,'config.json');
    const config = existsSync(configPath) ? JSON.parse(await readFile(configPath,'utf8')) : {};
    const campusConfigFile = process.env.CAMPUS_API_CONFIG ?? config.campus_api_config;
    const envCredentials = process.env.CAMPUS_API_URL && process.env.CAMPUS_API_KEY ? {base_url:process.env.CAMPUS_API_URL,api_key:process.env.CAMPUS_API_KEY} : undefined;
    if ((process.env.CAMPUS_API_URL || process.env.CAMPUS_API_KEY) && !envCredentials) throw new Error('Both CAMPUS_API_URL and CAMPUS_API_KEY are required');
    if (config.data_source === 'campus-api' && !campusConfigFile && !envCredentials) throw new Error('C API configuration is required for campus-api mode');
    const useRemote = config.data_source !== 'local-json' || Boolean(process.env.CAMPUS_API_CONFIG || envCredentials);
    const server = await createApiServer({ dataDir:process.env.DATA_DIR,allowedOrigins:process.env.ALLOWED_ORIGINS?.split(',').map(s=>s.trim()),
      campusConfigFile:useRemote?campusConfigFile:undefined,campusCredentials:envCredentials });
    server.listen(port,host,() => console.log(`API + demo: http://${host}:${port}/demo/`));
    server.on('error',error => {console.error(error.message);process.exitCode=1;});
  } catch(error) { console.error(`API startup failed: ${error instanceof Error ? error.message : String(error)}. Check private config.json/CAMPUS_API_CONFIG for C API mode, or data/ for local JSON mode.`);process.exitCode=1; }
}
