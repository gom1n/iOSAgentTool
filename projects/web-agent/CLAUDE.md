# Web Agent - Claude Code 가이드

## ⚡ 세션 시작 즉시 실행
이 CLAUDE.md를 읽는 즉시 아래 순서를 따른다. 사용자의 추가 지시를 기다리지 않는다.

1. `shared/task-queue/pending/` 폴더를 확인한다
2. `platform`이 `"Web"`인 `.json` 파일이 있으면 읽고 작업을 시작한다
3. 파일이 없으면 "대기 중 — 새 Web 작업이 없습니다" 라고 알린다

---

## 역할
`projects/web-agent/` (React + Vite, 포트 5173) 백오피스 UI를 개발한다.

---

## 프로젝트 핵심 경로

```
projects/web-agent/src/
├── App.jsx                        ← 라우팅
├── components/Sidebar.jsx/css     ← 네비게이션
└── pages/
    ├── Monitoring.jsx/css
    ├── TaskManagement.jsx/css
    ├── TaskDetail.jsx/css
    └── Settings.jsx/css
projects/web-agent/vite-plugin-task-sync.js  ← 백엔드 API
```

---

## 화면ID → 파일 매핑

| screenId | 수정 대상 파일 |
|----------|--------------|
| `MONITORING` | `src/pages/Monitoring.jsx` |
| `TASK_MANAGEMENT` | `src/pages/TaskManagement.jsx` |
| `TASK_DETAIL` | `src/pages/TaskDetail.jsx` |
| `SETTINGS` | `src/pages/Settings.jsx` |
| `SIDEBAR` | `src/components/Sidebar.jsx` |

---

## 작업 흐름

### 1. 작업 시작 — in-progress로 이동
```bash
curl -s -X PATCH http://localhost:5173/api/task-queue/{task.id} \
  -H "Content-Type: application/json" \
  -d '{...task JSON..., "status": "in-progress"}'
```

### 2. screenId가 있으면 화면 가이드 읽기
```bash
find ../../shared/screens -name "{screenId}.md" | head -1 | xargs cat
```

### 3. 작업 완료 — completed로 이동
```bash
curl -s -X PATCH http://localhost:5173/api/task-queue/{task.id} \
  -H "Content-Type: application/json" \
  -d '{...task JSON..., "status": "completed", "agentSummary": "...", "agentSuccess": true, "humanEstimateMinutes": 숫자}'
```

`agentSummary` 규칙: 마크다운 사용, 구현내용 → 변경파일 → 특이사항 순, 3~10줄.

`agentSuccess` 규칙: 작업을 성공적으로 완료했으면 `true`, 오류/실패/불완전하면 `false`.

`humanEstimateMinutes` 규칙: 경력 3년차 개발자가 이 작업을 처음부터 혼자 처리한다면 몇 분 걸릴지 정수로 추정. 기획·디자인 시간 제외, 순수 개발 및 코드리뷰 기준. (예: 간단한 UI 수정 30~60, 기능 추가 60~240, 복잡한 신규 화면 240~480)

---

## 코딩 규칙

- CSS: 컴포넌트별 `.css` 파일 분리, CSS 변수 사용 (`var(--text-primary)` 등)
- 상태 관리: `useState` / `useEffect` / `useRef` — 외부 라이브러리 없음
- 아이콘: `react-icons/md`
- `ios-agent/` 폴더 접근 금지
- 새로운 npm 패키지 설치 금지
