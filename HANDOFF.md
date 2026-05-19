# Agent System — 핸드오프 노트

> 마지막 업데이트: 2026-05-18

**GitHub**: https://github.com/gom1n/iOSAgentTool.git

---

## 시스템 구조

```
agent-system/
├── launcher/
│   ├── ios-watcher.js     ← iOS 에이전트 감시·실행 (포트 3002)
│   └── server.js          ← 터미널 에이전트 실행 (포트 3001)
├── projects/
│   ├── web-agent/         ← React + Vite UI (포트 5173)
│   └── ios-agent/         ← iOS 에이전트 작업 디렉토리 (모든 에이전트 공유)
└── shared/
    ├── task-queue/{pending,in-progress,completed}/
    ├── projects.json       ← 등록 프로젝트 목록 (Settings ↔ watcher 브릿지)
    ├── agent-sessions.json ← projectKey별 Claude 세션 ID 저장
    ├── screens/
    ├── activity-logs.json
    └── guidelines/MASTER.md
```

## 에이전트 역할

| 에이전트 | 트리거 |
|---|---|
| **리더 (나)** | 사용자가 직접 대화 |
| **iOS 에이전트** | platform=iOS 작업 생성 → ios-watcher 자동 감지 |

- ios-watcher는 `shared/projects.json`을 읽어 **프로젝트별 병렬** 에이전트 실행
- 프로젝트 내 작업은 직렬 처리 (`activeAgents` 맵으로 관리)
- 모든 에이전트는 `projects/ios-agent/` cwd에서 실행, 프로젝트 정보는 프롬프트로 주입
- 세션은 `--resume <sessionId>`로 유지, `shared/agent-sessions.json`에서 로드

## 주요 구조적 특이사항

- **projects.json 브릿지**: Settings에서 프로젝트 저장 시 `/api/projects` POST로 파일 동기화. watcher가 없으면 `loadProjectsFromTasks()` 폴백(pending/in-progress 태스크 파일 스캔)
- **xcodeproj 탐색**: `findXcodeProject()` — 경로 자체 → 직접 자식 → 한 단계 더 안쪽 3단계 탐색
- **빌드 오류 피드백**: TaskDetail에서 `res.ok` 체크 후 `buildError` 상태로 화면에 표시
- **사이드바 로고**: 클릭 → 모니터링 이동+새로고침 / 더블클릭 → 타이틀 인라인 편집 (localStorage `acc_logo_title` 저장)
- **작업 파이프라인**: pending → in-progress → completed (파일 이동 방식)
- **Claude 사용량**: Chromium AES-128-CBC 복호화, `~/.claude.json`의 `oauthAccount.organizationUuid` 사용
- **agentReports**: PATCH /api/task-queue/:id 시 agentSummary → agentReports 배열 누적

## TaskDetail 동작 방식

- **실시간 폴링**: localStorage 경유 없이 `/api/task-queue`를 직접 2초마다 폴링. 변경 시 localStorage도 함께 동기화해 다른 화면과 일관성 유지.
- **실시간 에이전트 출력**: `in-progress` + `projectKey` 있을 때, 파이프라인 아래에 `/api/agent-logs?project=...` 2초 폴링 패널 표시. 에이전트 실행 중이면 LIVE 배지 깜빡임.
- **소요시간 딱지**: 완료 작업에 `⚡ N분` 딱지 하나만 표시 (회색). 인간추정·빠르기 딱지는 데이터는 유지하되 UI에서 제거.

## 경로 처리

모든 절대경로 제거됨. `import.meta.url` 기반 ROOT 변수로 동적 계산.  
클라이언트 경로(SCREENS_BASE 등): `/api/system-paths` 엔드포인트로 서버에서 받아옴.

## 실행

```bash
cd projects/web-agent && npm install && npm run dev
node launcher/ios-watcher.js
```

## Git 인증

`git credential store` 설정 완료. `git push origin main` 바로 사용 가능.
