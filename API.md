# A 프런트엔드 ↔ B API

## 실행

Node 24 권장. 제공받은 C 파일을 `data/courses_2026_2.json`, `data/curricula/index.json`, `data/curricula/curriculum_*.json`에 배치합니다. 이 원본 JSON들은 GitHub에 포함되지 않습니다.

```sh
npm install
npm run build
npm start
```

기본 주소는 `http://127.0.0.1:4173`. `/demo/` 화면도 같은 서버에서 제공합니다. `npm run demo`는 빌드 후 API 서버를 실행합니다. 이전 Python 정적 서버는 사용하지 않습니다.

환경 설정:

- `PORT`: 기본 4173
- `HOST`: 기본 127.0.0.1. 다른 컴퓨터에서 접속할 개발 서버는 `HOST=0.0.0.0`으로 실행하고 컴퓨터의 LAN IP를 A에게 전달합니다. A의 localhost는 A 자신의 컴퓨터이므로 B 서버를 가리키지 않습니다.
- `DATA_DIR`: C JSON 폴더의 절대 경로. 기본 저장소의 data 폴더
- `ALLOWED_ORIGINS`: 쉼표로 구분한 A 프런트 주소. 기본 localhost/127.0.0.1의 5173·3000 포트. 같은 서버의 데모는 그대로 접속 가능합니다.

```sh
HOST=0.0.0.0 PORT=4173 ALLOWED_ORIGINS=http://localhost:5173,http://192.168.0.20:5173 npm start
```

## API 목록

| 메서드·경로 | 입력 | 응답 |
|---|---|---|
| GET /api/health | 없음 | status, semester, departments |
| GET /api/departments | 없음 | CurriculumIndex |
| GET /api/curriculum | departmentId | 해당 학과 Curriculum |
| GET /api/demo-student | departmentId | 가상 Student |
| GET /api/catalog | departmentId, semester | `{semester, courses: CatalogCourse[]}` |
| POST /api/timetables/generate | TimetableRequest | TimetableResponse |
| POST /api/curriculum/check | CurriculumCheckRequest | CurriculumReport |

GET 입력은 query string입니다. 예: `/api/catalog?departmentId=police&semester=2026-2`.
POST는 Content-Type: application/json입니다. 성공은 200이며 후보 없음도 200 + candidates=[] + message입니다.

오류는 HTTP 400(입력), 403(CORS), 404(학과·학기·ID 등 경로), 413(2MB 초과), 415(JSON 필요), 503(계산 지연·사용 중) 등과 함께 다음 JSON으로 반환합니다.

```json
{"error":{"code":"INVALID_INPUT","message":"입력 오류 내용"}}
```

현재 서버는 2026-2 개설 자료와 2025 요람을 제공합니다. 원본 data 폴더는 정적 파일 URL로 노출하지 않습니다. 서버 재시작 시 새 JSON을 읽습니다.

## A 연결 예시

A 프로젝트에 `src/api-client.ts`를 가져오거나 `src/index.ts`에서 import합니다. api-client는 브라우저 fetch만 사용합니다. 타입 참조 engine/helpers도 같이 가져오거나 B 모듈 전체를 사용하세요.

```ts
import { createApiClient } from './b-module/src/api-client';

const api = createApiClient('http://127.0.0.1:4173');
const index = await api.departments();
const departmentId = 'police';
const [curriculum, student, catalog] = await Promise.all([
  api.curriculum(departmentId),
  api.demoStudent(departmentId),
  api.catalog(departmentId, '2026-2'),
]);

// 선택한 과목/후보만 담습니다. 같은 과목의 후보 여러 개는 sections에 넣습니다.
// 반드시 포함 여부만 전달하며 priority는 보내지 않습니다.
const request = {
  semester: '2026-2',
  major: curriculum.department,
  grade: student.grade,
  courses: selectedCourses,
  conditions: { minCredits: null, maxCredits: null, unavailableTimes: [] },
};
const response = await api.generate(request);

// 사용자가 고른 candidate의 courseId/sectionId를 catalog와 연결해 격자를 그립니다.
const candidate = response.candidates[0];
if (candidate) {
  const report = await api.check({
    departmentId,
    semester: '2026-2',
    student,
    plannedSections: candidate.sections,
  });
  // report.credits와 report.requiredCourses를 표시합니다.
}
```

`selectedCourses`는 CatalogCourse 중 사용자가 선택한 과목이고 sections에는 사용자가 선택한 후보만 남깁니다. CatalogCourse의 필수 필드는 기존 Course와 같습니다. mustInclude=false이면 해당 과목이 빠진 조합도 생성합니다. 필수 배지 requirement와 반드시 포함 mustInclude는 별개입니다.

생성 API는 기존 TimetableRequest 필드를 그대로 받습니다. 서버가 courseId/sectionId로 원본의 학점·교수·시간·필수 여부를 조회하므로 요청에 있는 그 값으로 서버 자료를 덮어쓸 수 없습니다. priority는 무시합니다. 원본에 없는 과목/분반은 400으로 반환합니다.

## 요람 체크 요청

```ts
type CurriculumCheckRequest = {
  departmentId: string;
  semester: string;
  student: Student; // 가상 이수 내역 편집 결과를 포함
  plannedSections: Array<{ courseId: string; sectionId: string }>;
};
```

예정 수업의 학점·이수구분은 서버 자료에서 조회합니다. 가상 이수 내역은 데모 목적의 사용자 입력입니다. 이 API는 요람 진행 상황을 계산하며 시간표 조합의 유효성은 generate API가 확인합니다. 기존 이수 과목은 학수번호로 중복 제외하고, 필수 과목은 completed/planned/missing/unresolved를 제공합니다. 교양 세부 영역·본문 추가 조건은 안내이며 전체 졸업 판정은 아닙니다.

## 저장·화면

시간표와 가상 이력은 A의 localStorage에 저장합니다. 서버에 사용자 저장 API나 로그인 기능은 없습니다. 학과·학기별 키로 저장하고, 복원 후 요람 체크 API를 다시 호출합니다. 결과 표시는 요일 × 08:00–22:00 격자이며 이는 A의 렌더링 책임입니다. 데모의 demo/app.js가 실제 API 연결 예시입니다. 데모는 기본 같은 origin을 사용하고, 별도 서버를 사용할 때 스크립트 실행 전에 `window.TIMETABLE_API_BASE_URL`을 설정할 수 있습니다.

계산은 Worker에서 실행하여 다른 API를 막지 않습니다. 최대 2개 요청을 동시 계산하며 30초 초과는 503으로 반환합니다. 성공 시 조합을 임의로 자르지 않고 전체 반환합니다. A는 계산 중 표시, 실패 안내, 페이지 표시를 구현하세요. 배포 서버와 공개 URL은 아직 만들지 않았습니다.
