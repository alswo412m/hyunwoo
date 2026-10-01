import {createApiClient,resolveCandidate,saveTimetable,loadTimetable,timesOverlap} from '../dist/index.js';
const $=id=>document.getElementById(id);
const esc=x=>String(x??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const names={MON:'월',TUE:'화',WED:'수',THU:'목',FRI:'금',SAT:'토',SUN:'일'};
const labels={total:'전체',general_education:'교양',major_required:'전공필수',major_elective:'전공선택',major_total:'전공합계'};
const api=createApiClient(window.TIMETABLE_API_BASE_URL||'');
let reportVersion=0;
let index,curriculum,student,catalog=[],selections=new Map(),blocks=[],request=null,candidates=[],chosen=null,page=0;
const status=text=>{$('status').textContent=text};
const key=()=>`timetable:2026-2:${$('major').value}`;
function invalidate(){request=null;candidates=[];chosen=null;page=0;$('results').textContent='조건을 정하고 결과를 요청하세요.';$('timetable').innerHTML='';renderReport()}
function rebuild(){catalog=catalog.map(c=>({...c,completed:student.completed.some(s=>s.courseCode===c.courseId)}));renderCatalog();renderSelected();renderReport();renderHistory()}
async function changeMajor(){
 const entry=index.departments.find(d=>d.department_id===$('major').value);
 const id=entry.department_id;
 const [loadedCurriculum,loadedStudent,loadedCatalog]=await Promise.all([api.curriculum(id),api.demoStudent(id),api.catalog(id,'2026-2')]);
 if($('major').value!==id)return;curriculum=loadedCurriculum;student=loadedStudent;catalog=loadedCatalog.courses;
 selections=new Map();blocks=[];$('min').value='';$('max').value='';renderBlocks();invalidate();rebuild();status(`${entry.department} 자료 로딩 완료`)
}
function renderCatalog(){
 const term=$('search').value.trim().toLowerCase(),mode=$('filter').value,own=new Set(curriculum.courses.map(c=>c.course_code));
 const list=catalog.filter(c=>($('completed').checked||!c.completed)&&(mode==='all'||(mode==='major'?own.has(c.courseId):['기초','소양','심화','교양','기교','지교'].includes(c.category)))&&`${c.courseName} ${c.courseId} ${c.sections.map(s=>s.professor).join(' ')}`.toLowerCase().includes(term));
 $('catalog').innerHTML=`<p class="muted">${list.length}개 과목</p>`+list.map(c=>`<div class="course"><b>${esc(c.courseName)}</b> ${c.requirement==='required'?'<span class="badge required">필수</span>':''} ${c.completed?'<span class="badge">이수 완료</span>':''}<div class="muted">${esc(c.courseId)} · ${c.credits}학점 · ${esc(c.category)}</div>${c.sections.map(s=>`<div><label><input type="checkbox" data-course="${esc(c.courseId)}" data-section="${esc(s.sectionId)}" ${selections.get(c.courseId)?.sectionIds.includes(s.sectionId)?'checked':''}>${esc(s.professor||'교수 미기재')} · ${esc(s.sectionId)}</label><div class="muted">${s.days.length?s.days.map(d=>`${names[d.day]} ${d.startTime}–${d.endTime} ${esc(d.classroom||'')} (${d.weeks?.join(',')||'전체'}주)`).join('<br>'):'온라인 가정 · 시간 제약 없음'}</div></div>`).join('')}${c.notes.map(n=>`<div class="muted">${esc(n)}</div>`).join('')}</div>`).join('');
 $('catalog').querySelectorAll('[data-course]').forEach(el=>el.onchange=()=>{
  const id=el.dataset.course;const current=selections.get(id)||{courseId:id,sectionIds:[],mustInclude:true};
  current.sectionIds=el.checked?[...current.sectionIds,el.dataset.section]:current.sectionIds.filter(s=>s!==el.dataset.section);
  if(current.sectionIds.length)selections.set(id,current);else selections.delete(id);invalidate();renderSelected();
 });
}
function renderSelected(){
 $('selected').innerHTML=selections.size?[...selections.values()].map(s=>{const c=catalog.find(c=>c.courseId===s.courseId);return `<div class="course"><b>${esc(c.courseName)}</b> ${c.requirement==='required'?'<span class="badge required">필수</span>':''}<div>${c.credits}학점 · 후보 ${s.sectionIds.length}개 ${c.completed?'· 재수강: 학점 중복 제외':''}</div><label><input type="checkbox" data-must="${esc(s.courseId)}" ${s.mustInclude?'checked':''}>반드시 포함</label> <button data-remove="${esc(s.courseId)}">삭제</button></div>`}).join(''):'아직 선택한 과목이 없습니다.';
 $('selected').querySelectorAll('[data-must]').forEach(el=>el.onchange=()=>{selections.get(el.dataset.must).mustInclude=el.checked;invalidate()});
 $('selected').querySelectorAll('[data-remove]').forEach(el=>el.onclick=()=>{selections.delete(el.dataset.remove);invalidate();renderSelected();renderCatalog()})
}
function renderBlocks(){ $('blocks').innerHTML=blocks.map((b,i)=>`<p>${names[b.day]} ${b.startTime}–${b.endTime} <button data-delete-block="${i}">삭제</button></p>`).join('');$('blocks').querySelectorAll('button').forEach(el=>el.onclick=()=>{blocks.splice(Number(el.dataset.deleteBlock),1);invalidate();renderBlocks()}) }
function makeRequest(){return {semester:'2026-2',major:curriculum.department,grade:student.grade,courses:[...selections.values()].map(s=>{const c=catalog.find(c=>c.courseId===s.courseId);if(!c)throw Error('저장된 과목이 현재 자료에 없습니다.');return {...c,sections:c.sections.filter(section=>s.sectionIds.includes(section.sectionId)),mustInclude:s.mustInclude};}),conditions:{minCredits:$('min').value===''?null:Number($('min').value),maxCredits:$('max').value===''?null:Number($('max').value),unavailableTimes:blocks}}}
async function generate(){
 request=makeRequest();
 const sent=request;status('시간표 계산 중…');const response=await api.generate(sent);if(request!==sent)return;candidates=response.candidates;page=0;chosen=null;$('timetable').innerHTML='';renderReport();renderResults(response.message);status(`${candidates.length}개 조합 생성 완료`)
}
function renderResults(message){
 if(!candidates.length){$('results').textContent=message||'조건에 맞는 조합이 없습니다.';return}
 $('results').innerHTML=`<p>전체 ${candidates.length}개 · ${page+1}/${Math.ceil(candidates.length/10)} 페이지</p><div class="toolbar"><button id="prev" ${page===0?'disabled':''}>이전</button><button id="next" ${(page+1)*10>=candidates.length?'disabled':''}>다음</button></div>`+candidates.slice(page*10,page*10+10).map((c,i)=>`<div class="course"><b>${c.candidateId}</b> · ${c.totalCredits}학점 · 주 ${c.summary.classDays}일 · 종료 ${c.summary.lastClassTime||'온라인만'}${timetableMarkup(c,true)}<div class="muted">제외: ${c.summary.omittedCourseIds.map(id=>esc(request.courses.find(c=>c.courseId===id).courseName)).join(', ')||'없음'}</div><button data-choose="${page*10+i}">${chosen?.candidateId===c.candidateId?'선택됨':'이 시간표 선택'}</button></div>`).join('');
 $('prev').onclick=()=>{page--;renderResults()};$('next').onclick=()=>{page++;renderResults()};$('results').querySelectorAll('[data-choose]').forEach(el=>el.onclick=()=>{chosen=candidates[Number(el.dataset.choose)];renderResults();renderTimetable();renderReport()})
}
function timetableMarkup(candidate,compact=false){
 const courses=resolveCandidate(request,candidate),start=8*60,end=22*60;
 const minute=time=>Number(time.slice(0,2))*60+Number(time.slice(3));
 const colors=['#e5edff','#e0f3ea','#fff0dc','#f0e5fc','#fde5eb','#dff3f8'];
 const hours=Array.from({length:15},(_,i)=>`${String(i+8).padStart(2,'0')}:00`);
 const headers='<div class="grid-header">시간</div>'+Object.values(names).map(n=>`<div class="grid-header">${n}</div>`).join('');
 const axis='<div class="time-axis">'+hours.map((h,i)=>`<span style="top:${i/14*100}%">${h}</span>`).join('')+'</div>';
 const columns=Object.keys(names).map(day=>{
  const meetings=courses.flatMap((c,color)=>c.sections[0].days.filter(d=>d.day===day).map(d=>({c,d,color,from:Math.max(start,minute(d.startTime)),to:Math.min(end,minute(d.endTime))}))).filter(m=>m.to>m.from).sort((a,b)=>a.from-b.from);
  const lanes=[];
  for(const m of meetings){let lane=lanes.findIndex(stop=>stop<=m.from);if(lane<0)lane=lanes.length;lanes[lane]=m.to;m.lane=lane;}
  const count=Math.max(1,lanes.length);
  return '<div class="time-column">'+meetings.map(m=>`<div class="class-block" style="top:${(m.from-start)/(end-start)*100}%;height:${(m.to-m.from)/(end-start)*100}%;left:calc(${m.lane/count*100}% + 2px);width:calc(${100/count}% - 4px);background:${colors[m.color%colors.length]}" title="${esc(m.c.courseName)} · ${m.d.startTime}–${m.d.endTime} · ${esc(m.d.classroom||'장소 미기재')} · ${esc(m.d.weeks?.join(',')||'전체')}주"><b>${esc(m.c.courseName)}</b><span>${m.d.startTime}–${m.d.endTime}</span>${compact?'':`<span>${esc(m.c.sections[0].professor||'')}</span><span>${esc(m.d.classroom||'장소 미기재')}</span><span>${esc(m.d.weeks?.join(',')||'전체')}주</span>`}</div>`).join('')+'</div>';
 }).join('');
 const online=courses.filter(c=>!c.sections[0].days.length);
 const outside=courses.flatMap(c=>c.sections[0].days.filter(d=>minute(d.startTime)<start||minute(d.endTime)>end).map(d=>`${c.courseName} · ${names[d.day]} ${d.startTime}–${d.endTime}`));
 return `<div class="grid-scroll"><div class="schedule ${compact?'compact':''}">${headers}${axis}${columns}</div></div>`+(online.length?`<p class="muted">온라인 가정: ${online.map(c=>esc(c.courseName)).join(', ')}</p>`:'')+(outside.length?`<p class="muted">표시 범위 밖 수업 시간: ${outside.map(esc).join(', ')}</p>`:'');
}
function renderTimetable(){if(!chosen)return;$('timetable').innerHTML='<h3>선택한 주간 시간표</h3>'+timetableMarkup(chosen)}

async function renderReport(){if(!curriculum)return;const version=++reportVersion;let report;try{report=await api.check({departmentId:$('major').value,semester:'2026-2',student,plannedSections:chosen?chosen.sections:[]});}catch(e){if(version===reportVersion)status(e.message);return}if(version!==reportVersion)return;$('report').innerHTML=`<table><tr><th>구분</th><th>기준</th><th>취득</th><th>예정</th><th>예상 합계</th><th>부족</th></tr>${Object.entries(report.credits).map(([key,v])=>`<tr><td>${labels[key]}</td><td>${v.target??'확인 필요'}</td><td>${v.earned}</td><td>${v.planned}</td><td>${v.projected}</td><td>${v.remaining??'확인 필요'}</td></tr>`).join('')}</table><h3>필수 과목</h3>${report.requiredCourses.length?report.requiredCourses.map(c=>`<div>${esc(c.name)} · ${esc(c.courseId)} <span class="badge ${c.status==='missing'?'required':''}">${{completed:'이수 완료',planned:'이수 예정',missing:'미이수',unresolved:'학수번호 확인 필요'}[c.status]}</span></div>`).join(''):'요람 목록에 필수 과목 없음'}${report.singleMajorApplicability==='not_single_major'?'<p class="muted">이 과정은 단일전공 졸업 판정 대상이 아닙니다.</p>':report.singleMajorApplicability==='unconfirmed'?'<p class="muted">단일전공 기준 적용 여부 확인이 필요합니다.</p>':''}<h3>추가 확인 조건</h3>${report.unresolvedRequirements.map(r=>`<p class="muted">${esc(r)}</p>`).join('')}<p class="muted">학점 기준 충족: ${report.creditCriteriaSatisfied===null?'판정 보류':report.creditCriteriaSatisfied?'충족 예상':'부족'} · 추가 조건과 필수 과목은 별도로 확인합니다.</p>`}
function renderHistory(){const extras=Array.from({length:6},(_,i)=>({course_code:`DEMO-GE-${i+1}`,name:`가상 교양 ${i+1}`,credits:3,category:'교양'}));const entries=[...new Map([...curriculum.courses.filter(c=>c.course_code),...extras].map(c=>[c.course_code,c])).values()];$('history').innerHTML=entries.map(c=>`<div><label><input type="checkbox" data-history="${esc(c.course_code)}" ${student.completed.some(s=>s.courseCode===c.course_code)?'checked':''}>${esc(c.name)} · ${c.credits}학점</label></div>`).join('');$('history').querySelectorAll('input').forEach(el=>el.onchange=()=>{const c=entries.find(c=>c.course_code===el.dataset.history);if(el.checked){const category=['전필','전공필수'].includes(c.category)?'major_required':['전선','전선B','전공선택'].includes(c.category)?'major_elective':['교양','기초','소양','심화','기교','지교'].includes(c.category)?'general_education':'other';student.completed.push({courseCode:c.course_code,name:c.name,credits:c.credits,category})}else student.completed=student.completed.filter(c=>c.courseCode!==el.dataset.history);invalidate();rebuild()})}
function guard(fn){return async()=>{try{await fn()}catch(e){status(e.message)}}}
$('major').onchange=guard(changeMajor);for(const id of ['search','filter','completed'])$(id).oninput=renderCatalog;
for(const id of ['min','max'])$(id).oninput=invalidate;
$('add-block').onclick=guard(()=>{const b={day:$('block-day').value,startTime:$('block-start').value,endTime:$('block-end').value};timesOverlap(b,b);blocks.push(b);invalidate();renderBlocks()});
$('generate').onclick=guard(generate);
$('save').onclick=guard(()=>{const r=request||makeRequest();saveTimetable(localStorage,key(),{version:1,request:r,selected:chosen});localStorage.setItem(`${key()}:student`,JSON.stringify(student));status('시간표와 가상 이수 내역 저장 완료')});
$('restore').onclick=guard(()=>{const saved=loadTimetable(localStorage,key());if(!saved){status('저장된 자료가 없거나 형식이 올바르지 않습니다.');return}if(saved.request.major!==curriculum.department||saved.request.semester!=='2026-2')throw Error('저장 자료의 학과·학기가 다릅니다.');const history=localStorage.getItem(`${key()}:student`);if(history){const candidate=JSON.parse(history);if(candidate.major!==curriculum.department||candidate.admissionYear!==2025||!Array.isArray(candidate.completed))throw Error('저장된 학생 정보가 올바르지 않습니다.');student=candidate}selections=new Map(saved.request.courses.map(c=>[c.courseId,{courseId:c.courseId,sectionIds:c.sections.map(s=>s.sectionId),mustInclude:c.mustInclude!==false}]));blocks=saved.request.conditions.unavailableTimes;$('min').value=saved.request.conditions.minCredits??'';$('max').value=saved.request.conditions.maxCredits??'';request={...saved.request,courses:saved.request.courses.map(({priority,...course})=>course)};chosen=saved.selected;candidates=chosen?[chosen]:[];page=0;rebuild();renderBlocks();renderResults();renderTimetable();status('저장된 시간표 복원 완료')});
$('reset').onclick=()=>{selections.clear();blocks=[];$('min').value='';$('max').value='';invalidate();rebuild();renderBlocks();localStorage.removeItem(key());status('선택과 저장된 시간표 초기화')};
await guard(async()=>{index=await api.departments();$('major').innerHTML=index.departments.map(d=>`<option value="${esc(d.department_id)}">${esc(d.department)}</option>`).join('');$('major').value='police';await changeMajor()})();
