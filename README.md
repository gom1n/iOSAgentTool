# Agent System

iOS 앱 개발 작업을 Claude Code 에이전트가 자동으로 처리하는 백오피스 시스템입니다.
웹 UI에서 작업을 생성하면 워처가 감지해 에이전트를 자동 실행합니다.

## 구조

```
agent-system/
├── launcher/
│   ├── ios-watcher.js   ← pending/ 폴더 감시 → iOS 에이전트 자동 실행 (포트 3002)
│   └── server.js        ← 터미널에서 에이전트를 직접 실행하는 런처 (포트 3001)
├── projects/
│   ├── web-agent/       ← 웹 UI (React + Vite, 포트 5173)
│   └── ios-agent/       ← iOS 에이전트 작업 디렉토리 (CLAUDE.md 포함)
└── shared/
    ├── task-queue/      ← pending / in-progress / completed
    ├── screens/         ← 컴포넌트별 가이드 파일 (사용자가 Settings에서 등록)
    ├── guidelines/      ← MASTER.md (에이전트 공통 가이드)
    ├── activity-logs.json
    └── compress_spec.py
```

## 요구사항

- [Node.js](https://nodejs.org) 18+
- [Claude Code CLI](https://claude.ai/code) (`claude` 명령어가 PATH에 있어야 함)
- Python 3 (스펙 경량화 기능 사용 시)

## 설치

```bash
# 1. 저장소 클론
git clone <repo-url>
cd agent-system

# 2. 웹 UI 의존성 설치
cd projects/web-agent && npm install && cd ../..

# 3. 런처 의존성 설치
cd launcher && npm install && cd ..

# 4. 환경변수 설정 (필요한 경우)
cp .env.example .env
# .env 파일을 열어 필요한 값 입력
```

## 실행

```bash
# 웹 UI 서버 시작 (터미널 1)
cd projects/web-agent && npm run dev

# iOS 에이전트 워처 시작 (터미널 2)
node launcher/ios-watcher.js
```

웹 브라우저에서 `http://localhost:5173` 접속

## 처음 설정

1. **Settings > 프로젝트** 탭에서 iOS 프로젝트 경로와 Xcode 스킴 등록
2. **Settings > 컴포넌트 매핑** 탭에서 작업 대상 화면/컴포넌트 등록
3. **작업 관리** 탭에서 새 작업 생성 → 워처가 자동으로 에이전트 실행

## 환경변수 (.env)

| 변수 | 설명 | 필수 |
|---|---|---|
| `CERT_PATH` | 회사 프록시 SSL 인증서 경로 | 선택 |
| `ANTHROPIC_API_KEY` | 화면 자동 요약 기능용 API 키 | 선택 |
