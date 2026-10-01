/** Server-only C data client. Never export this module through the browser index. */
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { validateCurriculum, validateOfferings } from './helpers.js';
import type { Curriculum, CurriculumIndex, OfferingData, RawOffering } from './helpers.js';
export type CampusCredentials = { base_url: string; api_key: string };
export type Dataset = { index: CurriculumIndex; curricula: Map<string,Curriculum>; offerings: OfferingData; source: 'local-json' | 'campus-api'; campus?: CampusDataClient };
export class CampusDataClient {
  private base: string;
  private key: string;
  constructor(credentials: CampusCredentials, private timeoutMs = 20000) {
    const url = new URL(credentials.base_url);
    if (!['http:','https:'].includes(url.protocol) || url.username || url.password || url.search || url.hash || typeof credentials.api_key !== 'string' || !credentials.api_key.trim()) throw new Error('Invalid C API configuration');
    this.base = credentials.base_url.replace(/\/$/,''); this.key = credentials.api_key;
  }
  async get<T>(path: string, query: Record<string,string | number | boolean> = {}): Promise<T> {
    const url = new URL(this.base+path);
    for (const [key,value] of Object.entries(query)) url.searchParams.set(key,String(value));
    let response: Response;
    try { response = await fetch(url,{ headers:{'X-API-Key':this.key},signal:AbortSignal.timeout(this.timeoutMs),redirect:'error' }); }
    catch { throw new Error('C API connection failed or timed out. Check address, server and network.'); }
    if (!response.ok) throw new Error(`C API HTTP ${response.status}${response.status === 401 ? ': ask C to verify or replace the B key' : ''}`);
    try { return await response.json() as T; } catch { throw new Error('C API returned invalid JSON'); }
  }
  async allCourses(): Promise<RawOffering[]> {
    const items: RawOffering[] = [];let total: number | undefined;
    while (total === undefined || items.length < total) {
      const page = await this.get<{total:number;items:RawOffering[]}>('/v1/courses',{academic_year:2026,semester:2,include_cancelled:true,limit:2000,offset:items.length});
      if (!Number.isInteger(page.total) || page.total < 0 || !Array.isArray(page.items) || (total !== undefined && total !== page.total) || items.length + page.items.length > page.total) throw new Error('Invalid or changing C API pagination; retry loading the dataset');
      total = page.total;
      if (page.items.length === 0 && items.length < total) throw new Error('C API returned an empty incomplete page');
      items.push(...page.items);
    }
    return items;
  }
}
export async function loadDataset(options: { dataDir: string; campusConfigFile?: string; campusCredentials?: CampusCredentials }): Promise<Dataset> {
  const json = async (path: string) => JSON.parse(await readFile(path,'utf8'));
  let campus: CampusDataClient | undefined;
  if (options.campusCredentials || options.campusConfigFile) {
    const credentials = options.campusCredentials ?? await json(options.campusConfigFile!);
    campus = new CampusDataClient(credentials);
  }
  const raw = campus ? await campus.get<{items:CurriculumIndex['departments']}>('/v1/departments') : await json(resolve(options.dataDir,'curricula/index.json'));
  const index: CurriculumIndex = campus ? {curriculum_year:2025,admission_year:2025,departments:raw.items?.map((entry: {department_id:string;department?:string;name?:string;college?:string|null;file?:string})=>({department_id:entry.department_id,department:entry.department??entry.name,college:entry.college??null,file:entry.file??`curriculum_${entry.department_id}_2025.json`}))} : raw;
  if (!Array.isArray(index.departments)) throw new Error('Invalid department index');
  const curricula = new Map<string,Curriculum>();
  // Small batches avoid sending 49 requests at once to C's development server.
  for (let i=0;i<index.departments.length;i+=4) {
    const batch=await Promise.all(index.departments.slice(i,i+4).map(async entry=>{
      if (!entry || typeof entry.department_id !== 'string' || !/^[a-z0-9_]+$/.test(entry.department_id) || typeof entry.department !== 'string') throw new Error('Invalid department entry');
      if (!campus && !/^curriculum_[a-z0-9_]+\.json$/.test(entry.file)) throw new Error('Invalid curriculum filename');
      const c = campus ? await campus.get<Curriculum>(`/v1/curricula/${entry.department_id}`,{curriculum_year:2025}) : await json(resolve(options.dataDir,'curricula',entry.file));
      validateCurriculum(c);
      if (c.department!==entry.department) throw new Error('Curriculum department does not match index');
      return {id:entry.department_id,c};
    }));
    for(const {id,c} of batch){if(curricula.has(id))throw new Error('Duplicate department ID');curricula.set(id,c);}
  }
  const offerings: OfferingData = campus ? {academic_year:2026,semester:2,courses:await campus.allCourses()} : await json(resolve(options.dataDir,'courses_2026_2.json'));
  validateOfferings(offerings);
  return {index,curricula,offerings,source:campus?'campus-api':'local-json',campus};
}
