# Agent System — 핸드오프 노트

> 마지막 업데이트: 2026-04-30

**GitHub**: https://github.com/gom1n/iOSAgentTool.git

---

## 시스템 구조

```
agent-system/
├── launcher/
│   ├── ios-watcher.js     ← iOS 작업 감시 (포트 3002)
│   └── server.js          ← 터미널 에이전트 실행 (포트 3001)
├── projects/
│   ├── web-agent/         ← React + Vite UI (포트 5173)
│   └── ios-agent/         ← iOS 에이전트 작업 디렉토리
└── shared/
    ├── task-queue/{pending,in-progress,completed}/
    ├── screens/            ← 컴포넌트별 가이드 (Settings에서 등록)
    ├── activity-logs.json
    ├── compress_spec.py
    └── guidelines/MASTER.md
```

## 에이전트 역할

| 에이전트 | 트리거 |
|---|---|
| **리더 (나)** | 사용자가 직접 대화 |
| **iOS 에이전트** | platform=iOS 작업 생성 → ios-watcher 자동 감지 |

web-agent/ 코드 수정(vite-plugin-task-sync.js 포함)은 리더가 직접 처리.

## 경로 처리

모든 절대경로 제거됨. `import.meta.url` 기반 ROOT 변수로 동적 계산.  
SSL 인증서: `CERT_PATH` 환경변수 (없으면 생략).  
클라이언트 경로(SCREENS_BASE, GUIDE_FILES): `/api/system-paths` 엔드포인트로 서버에서 받아옴.

## 주요 구조적 특이사항

- **작업 파이프라인**: pending → in-progress → completed (파일 이동 방식)
- **screens/ 탐색**: `find ../../shared/screens -name "{screenId}.md" | head -1 | xargs cat`
- **compress_spec.py**: stdin/stdout 모드, /api/compress-spec 경유
- **Claude 사용량**: Chromium AES-128-CBC 복호화, `~/.claude.json`의 `oauthAccount.organizationUuid` 사용
- **agentReports**: PATCH /api/task-queue/:id 시 agentSummary → agentReports 배열 누적

## 실행

```bash
cd projects/web-agent && npm install && npm run dev
node launcher/ios-watcher.js
```
