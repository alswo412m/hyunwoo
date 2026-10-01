# A·C 파트 전달 사항

B 파트 구현: TypeScript 시간표 조합 엔진, C JSON 어댑터, 학과별 요람 체크, 가상 학생 이력, 저장·복원, 통합 데모.

## A 파트에 보낼 메시지

`codex/b-part` 브랜치에 모듈과 실행 가능한 통합 데모를 올렸습니다. 기존 `generateTimetables(request)` 계약을 유지하며 우선순위·집중이수 등을 선택 필드로 확장했습니다. `src/index.ts`에서 모든 API를 가져오면 됩니다. 공식 프런트 화면에는 다음 순서로 연결해 주세요.

1. `loadJson`으로 강좌 파일과 학과 index를 로딩합니다. 학과 선택 시 해당 요람 JSON을 로딩합니다. 강좌에는 `validateOfferings`, 요람에는 `validateCurriculum`을 전달합니다.
2. `createDemoStudent(curriculum)`으로 25학번 가상 이력을 만들거나 이수 과목 편집 결과를 Student.completed에 반영합니다.
3. `buildCatalog(data, curriculum, student)`로 검색 목록을 만듭니다. `requirement`는 필수 배지, `completed`는 이수 배지에 사용합니다. 기본 전공 필터는 학과명 대신 요람 학수번호로 연결합니다. 분반은 사용자 후보 선택값이며 실제 수강 선택은 결과 단계에서 합니다.
4. `createRequest(data, curriculum, student, selections, conditions)`로 입력을 만듭니다. selections는 `{courseId, sectionIds?, priority?, mustInclude?}[]`. sectionIds를 생략하면 해당 과목의 모든 개설 후보가 들어가며, 직접 선택한 후보만 넘기려면 명시합니다. 여러 후보는 한 그룹에서 하나씩 선택됩니다. 과목명만으로 다른 학수번호를 병합하지 않습니다.
5. `generateTimetables(request)`를 호출합니다. 결과를 자르지 않으므로 화면에서 페이지로 나눠 보여주세요. 큰 입력은 Web Worker에서 호출하는 방식을 권장합니다.
6. 사용자가 결과를 고르면 `resolveCandidate(request, candidate)`로 실제 수강 예정 Course[]를 얻습니다.
7. `checkCurriculum(curriculum, student, planned)`로 취득/예정/예상/부족 학점을 표시합니다. requiredCourses의 completed/planned/missing/unresolved를 표시합니다. planned는 취득이 아니며 재수강 학점은 중복 합산되지 않습니다.
8. `saveTimetable(localStorage, key, {version:1, request, selected})`와 `loadTimetable(localStorage, key)`로 저장·복원합니다. 학과·학기별 키를 사용하고, 가상 학생 이력은 별도로 저장하세요. 데이터 갱신 시 복원한 ID가 현재 자료에 존재하는지 재확인합니다.

온라인 가정: days=[] 또는 timeStatus가 missing/partial/failed이면 전체 강좌를 시간 제약 없는 온라인으로 처리합니다. 일부 확인된 시간도 충돌 검사에서 제외합니다. 기본 온라인 시간표와 별도 목록에 표시합니다.

우선순위: 숫자가 작을수록 높음. mustInclude 기본 true. false면 해당 과목이 빠진 조합도 모두 생성하며 높은 우선순위 과목을 포함한 결과부터 정렬합니다. requirement는 요람 필수 표시로, 반드시 포함 옵션과 다릅니다.

추가 필드: Section.professor/timeStatus, TimeSlot.weeks/classroom, Day.SAT/SUN, summary.assumedOnlineSectionIds/requiredCourseIds/omittedCourseIds. A가 작성한 원래 필수 필드는 유지됩니다.

## C 파트에 보낼 메시지

제공한 2026-2 전체 강좌 1,521개와 2025 요람 49개 학과·전공 파일을 로컬 자료로 현재 그대로 연결했습니다. JSON 원본은 저장소에 업로드하지 않으며 각 팀원이 `data/courses_2026_2.json`과 `data/curricula/`에 배치해야 합니다. 이후에도 동일한 JSON 구조와 자료형을 유지해 주세요. 학과별 index의 file은 실제 파일명과 일치해야 합니다.

- 학수번호 course_code는 요람과 개설 강좌 사이의 연결 키입니다. 과목번호 offering_id와 section은 문자열로 유지하며 둘의 조합은 해당 학기 안에서 유일해야 합니다.
- 학점·필수 여부·이수구분은 사실 데이터로 유지합니다. 전선B 등 원문 구분을 바꾸지 마세요. cancelled=true 강좌는 어댑터에서 제외합니다.
- 시간 공란이나 파싱 실패를 C 파일에서 온라인으로 덮어쓰지 마세요. time_status와 원문은 유지하며 B가 데모 정책으로 온라인 가정을 적용합니다.
- sessions의 요일·HH:MM·수업 주차·장소를 유지합니다. 각 일정의 장소가 달라도 처리 가능합니다.
- 요람 학점 기준이 미확인이면 null을 유지합니다. 학수번호가 없는 본문 필수 과목은 원문대로 두며 B가 자동 연결 불가로 표시합니다. 현재 디자인조형자유전공학부의 3개 본문 필수 과목이 이에 해당합니다.
- 추가 졸업 조건은 metadata.additional_requirements의 description과 출처로 보존합니다. 지금은 안내 표시이며 자동 판정 규칙이 아닙니다.
- 교양 세부 영역 자동 체크를 추가하려면 과목별 영역 코드·필수 과목 코드·대체 인정 관계를 구조화한 자료가 필요합니다. 이번 데모는 교양 합계와 구조화된 학과 필수 과목까지 판정합니다.

## 실행 및 확인

`npm install` → `npm test` → `npm run demo`, 이후 http://127.0.0.1:4173/demo/ 에서 확인합니다. Node 24 권장, Python 3 필요. 앱 프런트의 빌드 도구가 있으면 src 모듈을 직접 가져와도 됩니다.

확인 범위: 테스트 13개, 전체 49개 요람 로딩/목록 생성, 실제 경찰학과 조합/학점/저장 복원, 브라우저 과목 선택/조합 선택/새로고침 복원/이력 편집/컴퓨터공학과 전환. 원문 추가 조건은 자동 졸업 가능 판정으로 표시하지 않습니다.

## 화면 변경 사항

현재 데모는 숫자 우선순위를 입력하지 않고 과목별 mustInclude(반드시 포함)만 받습니다. 기존 API의 priority는 호환 목적으로 유지하지만 화면에서는 전달하지 않습니다. 모든 후보 선택 버튼을 제거하고 후보별 체크박스를 사용합니다. 결과별 미리보기와 선택한 시간표는 월~일 가로축, 08:00~22:00 세로축의 1시간 격자입니다. 30분 시작은 실제 분 단위 위치에 표시하며, 온라인 가정 수업은 별도 목록에 표시합니다. 표시 범위를 벗어나는 시간은 별도 안내로 보존합니다.

이 B 모듈은 저장소의 `engine-b/`에 있습니다. 실행 명령은 먼저 `cd engine-b` 후 실행하세요. 프런트엔드에서 가져올 때 경로를 `engine-b/src/index.ts`로 맞춥니다.
