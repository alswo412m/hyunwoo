# 시간표 조합 엔진 (B 파트)

A 파트가 정리한 요청을 받아 가능한 시간표를 모두 반환하는 TypeScript 모듈입니다. C 파트 JSON을 연결하는 어댑터, 요람 체크, 저장·복원과 통합 확인용 데모 화면을 포함합니다. CSV 원문 변환은 C 파트가 담당합니다.

```ts
import { generateTimetables } from './dist/index.js';
import type { TimetableRequest } from './dist/index.js';
const response = generateTimetables(request as TimetableRequest);
```

실제 호출 시 `request`는 A 파트가 구성합니다. 타입은 `src/index.ts`에서 export합니다. 결과의 `courseId`, `sectionId`를 요청 데이터와 연결해 표시합니다. 호출은 동기 함수이며 입력 객체를 수정하지 않습니다.

## A 파트 계약

제안한 TimetableRequest/TimetableResponse의 필수 필드와 함수명을 유지합니다. 한 `courses` 항목은 하나의 과목 선택 그룹이며 `sections`는 그 그룹의 대안입니다. 각 시간표에서 그룹당 하나의 후보를 선택합니다. 같은 과목의 다른 교수 수업은 사용자가 함께 선택했을 때 A 파트가 한 과목 그룹의 sections로 전달합니다. 같은 과목명이라도 학수번호가 다르면 독립적으로 유지합니다. 엔진은 과목명만으로 독립된 courseId를 자동 병합하지 않습니다. courseId는 요청 안에서 유일해야 하고 sectionId는 과목 안에서 유일해야 합니다. 서로 다른 학수번호를 동일 과목으로 오인하지 않도록 그룹 생성 시 확인하세요.

추가 선택 필드:

- `Course.priority`: 양의 정수, 작을수록 우선. 생략 시 입력 순서로 후순위 정렬.
- `Course.mustInclude`: 기본 true. false인 과목은 제외하는 조합도 생성. 요람의 requirement와 별개.
- `Section.professor`: 교수 표시용.
- `Section.timeStatus`: parsed/missing/partial/failed. parsed 외 상태 또는 days=[]는 시간 제약 없는 온라인으로 가정. 일부 확인된 시간도 충돌 계산에서 제외.
- `TimeSlot.weeks`: 수업 주차의 양의 정수 배열. 생략 시 모든 주차. 불가 시간에도 적용 가능.
- `TimeSlot.classroom`: 수업 일정마다 강의실이 다를 때 사용. 기존 Section.classroom도 유지.
- `Day`: 기존 MON–FRI에 SAT/SUN 추가.

`requirement: required`는 요람상 필수 표시를 위한 정보입니다. 반드시 포함하려면 mustInclude=true를 사용합니다. priority만 지정하고 모든 과목을 반드시 포함하면 결과는 같은 과목을 포함하므로 우선순위가 구성에 영향을 주지 않습니다. 과목 제외를 허용할 때 높은 우선순위 과목을 포함한 결과가 먼저 나옵니다. 유효한 부분 조합도 전부 반환하며 자동으로 제거하지 않습니다.

응답 summary의 추가 필드: assumedOnlineSectionIds(선택된 온라인 가정 후보), requiredCourseIds(선택된 요람 필수 과목), omittedCourseIds(제외된 그룹). sectionId는 courseId와 함께 식별하며 온라인 여부도 해당 후보의 sections와 연결합니다. classDays와 lastClassTime은 온라인 가정 수업을 제외한 주간 일정 요약입니다. 이동 계산은 하지 않아 travelWarnings=[]입니다.

후보가 없거나 입력 검증 실패 시 candidates=[]와 message를 반환합니다. candidateId는 요청 안에서만 유효합니다. 결과가 많아도 자르지 않으므로 A 파트가 페이지 표시를 하고, 큰 입력은 Web Worker 등으로 호출하는 것이 좋습니다. 조합 수는 분반 수의 곱으로 증가합니다.

## C 파트 연결

기존 JSON을 A 파트 또는 데이터 어댑터에서 변환합니다:

| C 필드 | 요청 필드 |
|---|---|
| academic_year, semester | semester (`2026-2`) |
| course_code | courseId (일반적으로 학수번호) |
| name, credits, category | courseName, credits, category |
| offering_id + section | sectionId (충돌 없는 조합 식별자) |
| professor | sections[].professor |
| sessions[].day | days[].day (월→MON 등) |
| sessions[].start/end | days[].startTime/endTime |
| sessions[].weeks/location | days[].weeks/classroom |
| time_status | sections[].timeStatus |
| 요람 required | requirement (required/optional) |

폐강 후보는 요청 전에 제외합니다. 시간 공란 후보는 days=[]로 보냅니다. 같은 그룹 후보는 학점이 같아야 합니다(요청 계약이 그룹 단위 credits이기 때문). 최종 선택 결과의 sections를 원래 데이터와 연결해 수강 예정 내역으로 요람 체크 파트에 전달합니다.

## 검증

Node.js 22.6 이상(권장 24)에서 `npm install`, `npm test`, `npm run typecheck`를 실행합니다. 엔진 런타임 외부 의존성은 없습니다.

## 요람 체크와 실제 데이터 연결

`src/helpers.ts`에 `loadJson`, `validateOfferings`, `validateCurriculum`, `buildCatalog`, `createDemoStudent`, `createRequest`, `resolveCandidate`, `checkCurriculum`, `saveTimetable`, `loadTimetable`을 제공합니다. 제공받은 전체 49개 요람과 1,521개 강좌를 로컬 `data/`에 배치해 검증했습니다. 원본 데이터는 GitHub에 포함하지 않습니다. 실행 전에 `data/courses_2026_2.json`, `data/curricula/index.json` 및 index에 등록된 요람 JSON을 배치하세요. 학생 이수 내역은 가상이며 1학년 요람 과목 최대 8개와 가상 교양 18학점으로 시작합니다. 데모에서 체크로 수정할 수 있습니다.

학과별 요람 과목에 해당하는 전필/전선만 해당 학생의 전공 학점으로 인정합니다. 다른 학과 전공은 전체 학점에만 포함합니다. 교양은 현재 기초/소양/심화/교양/기교/지교 분류를 합산하며 세부 영역과 대체 인정은 판정하지 않습니다. 동일 학수번호 이수·예정 과목은 중복 합산하지 않습니다. requiredCourses는 필수 과목의 이수/예정/미이수/학수번호 미확인 상태를 제공합니다. creditCriteriaSatisfied는 학점 기준에 한정하며 졸업 가능 여부가 아닙니다. null 기준은 확인 필요로 유지합니다. 본문 추가 조건은 원문 안내로 표시합니다.

## 통합 데모

`npm run demo` 후 [데모 화면](http://127.0.0.1:4173/demo/)을 엽니다. 학과 선택, 검색, 후보 선택, 반드시 포함 여부, 불가 시간, 학점 조건, 전체 조합 페이지, 08:00–22:00 주간 시간표 격자, 결과 선택, 학과별 저장·복원, 가상 이수 편집, 예상 요람 체크까지 연결되어 있습니다. A 파트의 공식 화면에 붙이는 방법과 C 파트 데이터 계약은 [TEAM_HANDOFF.md](TEAM_HANDOFF.md)에 있습니다.

## HTTP API

`npm run build && npm start`로 API와 demo를 함께 실행합니다. `src/server.ts`는 학과/강좌/가상 학생/시간표 생성/요람 체크 API를 제공하고, `src/api-client.ts`는 A 화면의 타입 지정 fetch 호출을 제공합니다. demo는 이제 이 API를 사용합니다. 실행 환경, CORS, 오류와 A 연결 예시는 [API.md](API.md)에 있습니다. `npm test`는 HTTP 통합 검증을 포함합니다. 원본 C JSON이 없는 환경에서는 실제 자료 통합 테스트를 건너뜁니다.
