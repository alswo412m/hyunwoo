# 시간표 조합 엔진 (B 파트)

A 파트가 정리한 요청을 받아 가능한 시간표를 모두 반환하는 TypeScript 모듈입니다. 화면이나 CSV 변환은 포함하지 않습니다.

```ts
import { generateTimetables } from './src/index.ts';
import type { TimetableRequest } from './src/index.ts';
const response = generateTimetables(request as TimetableRequest);
```

실제 호출 시 `request`는 A 파트가 구성합니다. 타입은 `src/index.ts`에서 export합니다. 결과의 `courseId`, `sectionId`를 요청 데이터와 연결해 표시합니다. 호출은 동기 함수이며 입력 객체를 수정하지 않습니다.

## A 파트 계약

제안한 TimetableRequest/TimetableResponse의 필수 필드와 함수명을 유지합니다. 한 `courses` 항목은 하나의 과목 선택 그룹이며 `sections`는 그 그룹의 대안입니다. 각 시간표에서 그룹당 하나의 후보를 선택합니다. 같은 과목명·다른 교수의 수업은 사용자가 함께 선택했을 때 A 파트가 한 과목 그룹의 sections로 전달합니다. 엔진은 과목명만으로 독립된 courseId를 자동 병합하지 않습니다. courseId는 요청 안에서 유일해야 하고 sectionId는 과목 안에서 유일해야 합니다. 서로 다른 학수번호를 동일 과목으로 오인하지 않도록 그룹 생성 시 확인하세요.

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
