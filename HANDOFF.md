# Agent System — 핸드오프 노트

> 이 파일은 리더 에이전트(Claude Code)가 세션을 재시작할 때 즉시 컨텍스트를 복구하기 위한 문서입니다.
> 마지막 업데이트: 2026-04-30

---

## 시스템 구조 요약

```
agent-system/
├── launcher/
│   ├── ios-watcher.js     ← iOS 작업 감시 (포트 3002)
│   └── server.js          ← 터미널 에이전트 실행 서버 (포트 3001)
├── projects/
│   ├── web-agent/         ← React + Vite SPA (포트 5173) — 리더 에이전트가 담당
│   └── ios-agent/         ← iOS 에이전트 작업 디렉토리
└── shared/
    ├── task-queue/
    │   ├── pending/        ← 대기 작업 JSON
    │   ├── in-progress/    ← 진행 중
    │   └── completed/      ← 완료
    ├── screens/            ← 화면별 폴더 (각 폴더 안에 {ID}.md + {ID}_spec.md)
    ├── activity-logs.json  ← iOS 에이전트 활동 로그
    ├── compress_spec.py    ← 스펙 MD 경량화 스크립트 (stdin/stdout)
    └── guidelines/MASTER.md
```

---

## 에이전트 역할 분담

| 에이전트 | 역할 | 트리거 |
|---|---|---|
| **리더 (나)** | 시스템 설계, 구조 변경, 에이전트 조율 | 사용자가 직접 대화 |
| **iOS 에이전트** | iOS 앱 코드 구현 | platform=iOS 작업 생성 → ios-watcher 자동 감지 |

**web-agent/ 자체(Vite 서버, vite-plugin-task-sync.js 등) 수정은 리더가 직접 처리.**

---

## 웹 UI 현황 (platform=iOS 전용)

- **작업 생성**: 플랫폼 선택 없음 (iOS 고정), 프로젝트 선택 항상 표시
- **모니터링**: iOS 에이전트 카드만 표시
- **설정 > 컴포넌트 매핑**: iOS 전용, 플랫폼 탭 없음, 프로젝트 필터 탭 표시
- **설정 > 가이드**: MASTER.md + iOS CLAUDE.md

---

## 워처 실행 옵션

```js
// ios-watcher.js
'--output-format', 'stream-json',
'--verbose',
'--max-turns', '20',
'-p', '...',
'--dangerously-skip-permissions'
```

- stream-json + verbose: 토큰 사용량 캡처 후 completed/ 파일에 기록
- max-turns 20: 루프 방지
- tool_use 출력 제거됨 (▶ Read/Edit 같은 노이즈 없음)

---

## 주요 기능 현황

- **작업 상태 파이프라인**: pending → in-progress → completed (파일 이동 방식)
- **에이전트 리포트**: agentReports 배열로 누적 (실행 횟수별 접기/펼치기, 토큰 사용량)
- **Xcode 빌드 패널**: iOS 완료 작업 상세에서 스킴 선택 + 빌드 실행 + 로그 실시간 폴링
- **프로젝트/스킴 관리**: Settings > 프로젝트 탭 (acc_projects localStorage)
- **스펙 파일 경량화**: Settings > 컴포넌트 매핑에서 .md 업로드 시 compress_spec.py로 자동 압축
- **Claude 사용량 위젯**: Sidebar에서 5시간/7일 사용량 표시 (Chromium 쿠키 복호화)
- **활동 로그**: shared/activity-logs.json (iOS 워처 fs.watch 기록)

---

## 구조적 특이사항

- **screens/ 경로 탐색**: CLAUDE.md에서 `find ../../shared/screens -name "{screenId}.md" | head -1 | xargs cat` 방식
- **compress_spec.py**: stdin/stdout 모드 (`python3 compress_spec.py -`), /api/compress-spec 엔드포인트 경유
- **Claude 사용량 복호화**: Chromium AES-128-CBC, `~/.claude.json`의 `oauthAccount.organizationUuid` 사용
- **agentReports 구조**: `[{ summary, completedAt, tokenUsage: { input_tokens, output_tokens, cache_read_input_tokens, total_cost_usd } }]`
- **vite-plugin-task-sync.js**: PATCH /api/task-queue/:id 에서 agentSummary → agentReports 배열에 누적
- **경로 처리**: 모든 절대경로는 `import.meta.url` 기반으로 동적 계산 (ROOT 변수)

---

## 실행 방법

```bash
# 1. 의존성 설치
cd projects/web-agent && npm install
cd ../../launcher && npm install

# 2. Vite 개발 서버 (웹 UI)
cd projects/web-agent && npm run dev

# 3. iOS 에이전트 워처
node launcher/ios-watcher.js
```

---

## 향후 계획 (논의 중)

- iOS 프로젝트별 agent 분리: `projects/ios-agents/{projectKey}/CLAUDE.md`
