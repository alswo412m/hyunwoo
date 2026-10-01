import { useEffect, useMemo, useState } from 'react';
import './App.css';
type Section = { id: string; number: string; credits: number; category: string; year: string; instructor: string; timeRoom: string };
type Course = { id: string; name: string; code: string; credits: number; category: string; departments: string[]; sections: Section[] };
type Row = Record<string, string>;
const csvUrl = 'https://raw.githubusercontent.com/alswo412m/hyunwoo/main/timetable_data/%EA%B1%B4%EA%B5%AD%EB%8C%80_GLOCAL_%EC%A0%84%EC%B2%B4%EA%B0%95%EC%A2%8C_%EC%9D%B4%EC%88%98%EA%B5%AC%EB%B6%84_2026_2.csv';
function parseCsv(text: string): Row[] {
  const rows: string[][] = []; let row: string[] = []; let field = ''; let quoted = false;
  for (let i = 0; i < text.length; i++) { const ch = text[i];
    if (ch === '"') { if (quoted && text[i + 1] === '"') { field += '"'; i++; } else quoted = !quoted; }
    else if (ch === ',' && !quoted) { row.push(field); field = ''; }
    else if ((ch === '\n' || ch === '\r') && !quoted) { if (ch === '\r' && text[i + 1] === '\n') i++; row.push(field); rows.push(row); row = []; field = ''; }
    else field += ch;
  }
  if (field || row.length) { row.push(field); rows.push(row); }
  const headers = (rows.shift() || []).map((v) => v.replace(/^\uFEFF/, '').trim());
  return rows.filter((r) => r.some((v) => v.trim())).map((r) => Object.fromEntries(headers.map((h, i) => [h, (r[i] || '').trim()])));
}
function groupCourses(rows: Row[]): Course[] {
  const map = new Map<string, Course>();
  rows.filter((r) => !r['폐강여부'] || r['폐강여부'].includes('정상')).forEach((r, i) => {
    const code = r['학수번호'] || r['과목번호'] || 'unknown-' + i; const name = r['교과목명'] || '과목명 없음';
    const category = r['이수구분'] || r['대분류'] || '구분 없음'; const credits = Number(r['학점']) || 0;
    const course = map.get(code) || { id: code, name, code, credits, category, departments: [], sections: [] };
    const deptText = [r['개설학과'], r['수강대상학과_원문']].filter(Boolean).join(',');
    const deptNames = deptText.split(',').map((v) => v.trim()).filter((v) => v && !v.includes('전체(') && !course.departments.includes(v));
    course.departments.push(...deptNames);
    const number = r['분반'] || r['과목번호'] || '미정'; const id = [code, r['과목번호'], number, r['담당교수']].join('-');
    if (!course.sections.some((s) => s.id === id)) course.sections.push({ id, number, credits, category, year: r['대상학년'] || '', instructor: r['담당교수'] || '', timeRoom: r['강의시간_강의실'] || '시간·강의실 정보 없음' });
    map.set(code, course);
  });
  return [...map.values()].sort((a, b) => a.name.localeCompare(b.name, 'ko'));
}
const isLiberal = (course: Course) => course.category.includes('교양') || course.category === 'KU소양';
const isMajor = (course: Course) => course.category.includes('전공');
export default function App() {
  const [courses, setCourses] = useState<Course[]>([]); const [selected, setSelected] = useState<string[]>([]);
  const [query, setQuery] = useState(''); const [majorQuery, setMajorQuery] = useState(''); const [major, setMajor] = useState('');
  const [area, setArea] = useState('전공'); const [category, setCategory] = useState('전체'); const [grade, setGrade] = useState('전체 학년');
  const [loading, setLoading] = useState(true); const [error, setError] = useState(''); const [notice, setNotice] = useState(''); const [showAll, setShowAll] = useState(false);
  useEffect(() => { let cancelled = false; fetch(csvUrl).then((res) => { if (!res.ok) throw new Error('CSV fetch failed'); return res.text(); }).then((text) => { if (!cancelled) setCourses(groupCourses(parseCsv(text))); }).catch(() => { if (!cancelled) setError('CSV를 불러오지 못했어요. GitHub 파일 경로와 인터넷 연결을 확인해 주세요.'); }).finally(() => { if (!cancelled) setLoading(false); }); return () => { cancelled = true; }; }, []);
  const majors = useMemo(() => [...new Set(courses.flatMap((c) => c.departments))].sort((a, b) => a.localeCompare(b, 'ko')), [courses]);
  const areaCourses = courses.filter((c) => area === '전공' ? isMajor(c) : area === '교양' ? isLiberal(c) : !isMajor(c) && !isLiberal(c));
  const categories = useMemo(() => ['전체', ...new Set(areaCourses.map((c) => c.category))], [courses, area]);
  const visible = useMemo(() => areaCourses.filter((c) => (category === '전체' || c.category === category) && (grade === '전체 학년' || c.sections.some((s) => !s.year || s.year.includes(grade[0]))) && (!major || c.departments.includes(major)) && (!majorQuery || c.departments.some((d) => d.toLowerCase().includes(majorQuery.trim().toLowerCase()))) && (c.name + ' ' + c.code + ' ' + c.category + ' ' + c.departments.join(' ')).toLowerCase().includes(query.trim().toLowerCase())), [courses, area, category, grade, major, majorQuery, query]);
  const chosen = courses.filter((c) => selected.includes(c.id)); const totalCredits = chosen.reduce((sum, c) => sum + c.credits, 0);
  const payload = chosen.map((c) => ({ courseId: c.id, courseCode: c.code, courseName: c.name, credits: c.credits, sections: c.sections }));
  useEffect(() => { const detail = { courses: payload, totalCredits }; window.dispatchEvent(new CustomEvent('timetable:selection-change', { detail })); try { localStorage.setItem('timetable:selected-courses', JSON.stringify(detail)); } catch { /* optional */ } }, [selected, courses]);
  const toggle = (id: string) => setSelected((old) => old.includes(id) ? old.filter((x) => x !== id) : [...old, id]);
  const shown = showAll ? visible : visible.slice(0, 40);
  const sendSelection = () => { window.dispatchEvent(new CustomEvent('timetable:selection-ready', { detail: { courses: payload, totalCredits } })); setNotice(chosen.length + '개 과목 · ' + totalCredits + '학점을 시간표 조합 입력으로 준비했어요.'); };
  const changeArea = (next: string) => { setArea(next); setCategory('전체'); setMajor(''); setMajorQuery(''); setQuery(''); setShowAll(false); };
  return <div className="app-shell"><header className="topbar"><a className="brand"><b className="brand-mark">틈</b> 틈표</a><span className="semester">2026학년도 2학기 · 건국대 GLOCAL</span></header><main className="page"><div className="eyebrow">YOUR SEMESTER, YOUR WAY</div>
    <div className="intro-row"><div><h1>듣고 싶은 과목을 골라보세요</h1><p className="subtitle">전공이나 교양 과목을 찾아 학점과 분반 후보를 확인하고 선택하세요.</p></div><div className="steps">① 조건 입력　›　<strong>② 과목 선택</strong>　›　③ 시간표 조합</div></div>
    <div className="workspace"><aside className="panel settings"><div className="panel-title"><h2>과목 선택</h2><span>{chosen.length}개 선택</span></div>
      <div className="course-tabs" role="tablist" aria-label="과목 영역">{['전공','교양','기타'].map((x) => <button role="tab" aria-selected={area === x} key={x} className={area === x ? 'selected' : ''} onClick={() => changeArea(x)}>{x} 과목</button>)}</div>
      {area === '전공' && <div className="major-picker"><label htmlFor="major-search">전공 검색 및 선택</label><input id="major-search" list="major-options" placeholder="전공명 검색 (예: 컴퓨터공학과)" value={majorQuery} onChange={(e) => { setMajorQuery(e.target.value); setMajor(majors.includes(e.target.value) ? e.target.value : ''); }} onBlur={() => { if (!majors.includes(majorQuery)) setMajor(''); }} /><datalist id="major-options">{majors.map((x) => <option value={x} key={x} />)}</datalist><small>CSV에 있는 학과명으로 전공 강좌를 걸러요.</small></div>}
      <div className="filter-row"><label htmlFor="grade-filter">대상 학년</label><select id="grade-filter" value={grade} onChange={(e) => setGrade(e.target.value)}>{['전체 학년','1학년','2학년','3학년','4학년'].map((x) => <option key={x}>{x}</option>)}</select></div>
      <div className="section-head"><h3>{area} 과목 찾기</h3><small>{loading ? '불러오는 중…' : visible.length.toLocaleString() + '개 과목'}</small></div><input className="search" placeholder="과목명 또는 학수번호 검색" value={query} onChange={(e) => { setQuery(e.target.value); setShowAll(false); }} />
      <div className="category-filter"><label htmlFor="category-filter">이수구분</label><select id="category-filter" value={category} onChange={(e) => setCategory(e.target.value)}>{categories.map((x) => <option key={x}>{x}</option>)}</select></div>
      {error && <div className="notice" role="alert">{error}<button onClick={() => location.reload()}>다시 불러오기</button></div>}
      <div className="course-list">{shown.map((c) => <button key={c.id} className={'course-row ' + (selected.includes(c.id) ? 'chosen' : '')} aria-pressed={selected.includes(c.id)} onClick={() => toggle(c.id)}><span>{selected.includes(c.id) ? '✓' : '＋'}</span><span className="course-copy"><strong>{c.name}</strong><small>{c.code} · {c.credits}학점 · {c.category} · 분반 {c.sections.length}개</small></span></button>)}{!loading && !error && !visible.length && <p className="subtitle">조건에 맞는 과목이 없어요. 전공 선택이나 검색 조건을 확인해 주세요.</p>}</div>
      {visible.length > 40 && <button className="text-button" onClick={() => setShowAll(!showAll)}>{showAll ? '목록 접기' : '과목 더 보기 (' + (visible.length - 40) + '개)'}</button>}
      <div className="selected-box"><strong>선택한 과목 {chosen.length}개 · {totalCredits}학점</strong><div className="chips">{chosen.map((c) => <button className="chip" key={c.id} onClick={() => toggle(c.id)}>{c.name} · {c.credits}학점 ×</button>)}</div></div><button className="primary-button" disabled={loading || chosen.length === 0} onClick={sendSelection}>선택 과목을 시간표 조합에 전달 →</button>
    </aside><section className="results"><div className="results-top"><div><h2>선택 과목과 분반 후보</h2><p>선택한 과목의 모든 분반 정보가 함께 전달됩니다.</p></div><span className="plan-tag">{loading ? 'CSV 불러오는 중' : courses.length.toLocaleString() + '개 과목'}</span></div>
      {chosen.length === 0 ? <div className="panel empty-selection"><h3>왼쪽 목록에서 과목을 선택하세요</h3><p className="subtitle">과목명, 학점과 각 분반의 강의시간·강의실을 확인할 수 있습니다.</p></div> : <div className="selected-course-list">{chosen.map((c) => <article className="plan-card" key={c.id}><div className="plan-head"><div><h3>{c.name}</h3><span className="plan-tag">{c.code} · {c.credits}학점</span></div><button onClick={() => toggle(c.id)}>선택 해제</button></div><p>{c.category} · 분반 후보 {c.sections.length}개</p><div className="course-list">{c.sections.slice(0, 8).map((s) => <div className="course-row" key={s.id}><span>{s.number}</span><span className="course-copy"><strong>{s.timeRoom}</strong><small>{s.credits}학점 · {s.year || '학년 정보 없음'} · {s.instructor || '담당교수 미정'}</small></span></div>)}{c.sections.length > 8 && <small>나머지 {c.sections.length - 8}개 분반도 함께 전달됩니다.</small>}</div></article>)}</div>}
      <div className="comparison handoff-card"><h3>시간표 조합 연결</h3><p>선택 과목과 분반 후보를 조합 기능 입력으로 보냅니다.</p><code>timetable:selection-change</code><p>선택 {chosen.length}개 · 총 {totalCredits}학점</p></div>{notice && <div className="notice" role="status">{notice}<button onClick={() => setNotice('')}>닫기</button></div>}
    </section></div><footer>{loading ? '강좌 CSV를 불러오고 있어요.' : error || ('GitHub CSV에서 ' + courses.length.toLocaleString() + '개 과목을 불러왔어요.')}</footer></main></div>;
}
