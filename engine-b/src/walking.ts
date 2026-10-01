import type { Course, Day, TimeSlot } from './engine.js';
import { walkingData } from './walking-data.js';
export type WalkingData = { buildings: Record<string,string>; routes: Array<{from:string;to:string;seconds:number;meters:number}> };
export type WalkingTransition = {
  fromCourse: string; toCourse: string; fromLocation: string | null; toLocation: string | null;
  seconds: number | null; meters: number | null; gapMinutes: number; consecutive: boolean; insufficientGap: boolean;
};
export type WalkingDay = {day:Day;weeks:number[];knownSeconds:number;totalSeconds:number|null;unknownTransitions:number;transitions:WalkingTransition[]};
export type WalkingReport = {days:WalkingDay[]};
const time = (s:string) => Number(s.slice(0,2))*60+Number(s.slice(3));
const onlineLocation = (s:string|null) => !!s && /온라인|원격|비대면/.test(s);
/** Classroom suffixes are allowed; annexes are not silently mapped to the main building. */
export function identifyBuilding(location:string|null,data:WalkingData=walkingData):string|null {
  if(!location)return null;const text=location.trim();
  for(const [code,name] of Object.entries(data.buildings).sort((a,b)=>b[1].length-a[1].length)) {
    if(text===name)return code;
    if(text.startsWith(name+' ') && /^(?:[A-Za-z]?\d|지하\s*\d|강의실\s*\d)/.test(text.slice(name.length).trim()))return code;
  }
  return null;
}
export function analyzeWalking(courses:Course[],data:WalkingData=walkingData):WalkingReport {
  const routes=new Map(data.routes.map(r=>[`${r.from}:${r.to}`,r]));
  const meetings:Array<{course:Course;slot:TimeSlot;location:string|null}>=[];
  for(const c of courses)for(const s of c.sections) {
    if(s.timeStatus && s.timeStatus!=='parsed')continue;
    for(const slot of s.days){const location=slot.classroom === undefined ? s.classroom : slot.classroom;if(!onlineLocation(location))meetings.push({course:c,slot,location});}
  }
  const weeks=[...new Set([...Array.from({length:16},(_,i)=>i+1),...meetings.flatMap(m=>m.slot.weeks??[])])].sort((a,b)=>a-b);
  const days:WalkingDay[]=[];
  for(const day of ['MON','TUE','WED','THU','FRI','SAT','SUN'] as Day[]) {
    const groups=new Map<string,WalkingDay>();
    for(const week of weeks){
      const active=meetings.filter(m=>m.slot.day===day&&(!m.slot.weeks||m.slot.weeks.includes(week))).sort((a,b)=>time(a.slot.startTime)-time(b.slot.startTime));
      if(!active.length)continue;
      const transitions:WalkingTransition[]=[];
      for(let i=1;i<active.length;i++){
        const a=active[i-1],b=active[i],from=identifyBuilding(a.location,data),to=identifyBuilding(b.location,data);
        const route=from&&to?routes.get(`${from}:${to}`):undefined;
        const seconds=from&&to&&from===to?0:route?.seconds??null;
        const meters=from&&to&&from===to?0:route?.meters??null;
        const gap=time(b.slot.startTime)-time(a.slot.endTime);
        transitions.push({fromCourse:a.course.courseName,toCourse:b.course.courseName,fromLocation:a.location,toLocation:b.location,seconds,meters,gapMinutes:gap,consecutive:gap===0,insufficientGap:seconds!==null&&seconds>gap*60});
      }
      const unknown=transitions.filter(t=>t.seconds===null).length;
      const known=transitions.reduce((sum,t)=>sum+(t.seconds??0),0);
      const key=JSON.stringify(transitions);
      const previous=groups.get(key);
      if(previous)previous.weeks.push(week);else groups.set(key,{day,weeks:[week],knownSeconds:known,totalSeconds:unknown?null:known,unknownTransitions:unknown,transitions});
    }
    days.push(...groups.values());
  }
  return {days};
}
