<div align="center">

# 🤖 iOS Agent System

**Claude Code를 활용한 iOS 개발 자동화 — macOS 앱**

작업을 등록하면 Claude 에이전트가 실제 iOS 코드를 자동으로 구현합니다.

[![Node.js](https://img.shields.io/badge/Node.js-18%2B-339933?style=flat-square&logo=node.js&logoColor=white)](https://nodejs.org)
[![Electron](https://img.shields.io/badge/Electron-35-47848F?style=flat-square&logo=electron&logoColor=white)](https://www.electronjs.org)
[![Claude](https://img.shields.io/badge/Powered%20by-Claude%20Code-D97757?style=flat-square)](https://claude.ai/code)
[![Platform](https://img.shields.io/badge/Platform-macOS-000000?style=flat-square&logo=apple&logoColor=white)](https://www.apple.com/macos)

</div>

---

## ✨ 주요 기능

| 기능 | 설명 |
|------|------|
| 🗂 **작업 관리** | iOS 작업 등록 및 상태 추적 (대기 → 진행 → 완료) |
| 🤖 **자동 에이전트 실행** | 작업 등록 시 Claude Code가 자동으로 코드 구현 |
| 📊 **실시간 모니터링** | 에이전트 로그, 작업 이력 차트 |
| 🔀 **프로젝트 병렬 처리** | 여러 iOS 프로젝트의 작업을 동시에 처리 |
| 🗺 **화면 매핑** | 화면 ID → Swift 파일 연결로 에이전트 정확도 향상 |
| 🔧 **빌드 스킴 지원** | 작업별 Xcode 빌드 스킴 지정 및 검증 |

---

## 🔄 동작 방식

```
AgentSystem.app 실행
  ├─ launcher/server.js 자동 시작 (포트 3001)
  └─ launcher/ios-watcher.js 자동 시작 (포트 3002)
       └─ 작업 등록 → shared/task-queue/pending/
            └─ Claude Code 자동 실행
                 └─ 실제 iOS 프로젝트 코드 수정 + 빌드 검증
```

---

## 🛠 사전 요구사항

- **macOS** (Xcode 필요)
- **Node.js** 18+
- **Claude Code CLI** 설치 및 로그인

```bash
# Claude Code 미설치 시
npm install -g @anthropic-ai/claude-code
claude  # 로그인
```

---

## 🚀 설치 및 실행

### 1. 저장소 클론

```bash
git clone https://github.com/gom1n/iOSAgentTool.git
cd iOSAgentTool
```

### 2. 앱 빌드

```bash
cd projects/macos-app
npm install
npm run build:mac
```

빌드가 완료되면 `projects/macos-app/dist/` 안에 `AgentSystem.dmg`가 생성됩니다.

### 3. 설치 및 실행

1. `AgentSystem.dmg`를 열어 `Applications`에 드래그
2. `AgentSystem.app` 실행

앱이 시작되면 서버와 에이전트 감시자가 자동으로 실행됩니다.

---

## 💻 개발 모드

앱 빌드 없이 바로 실행하려면:

```bash
# 터미널 1 — 웹 UI (Vite 개발 서버)
cd projects/web-agent && npm install && npm run dev

# 터미널 2 — Electron 앱
cd projects/macos-app && npm install
NODE_ENV=development npm run dev
```

---

## ⚙️ 초기 설정

1. **설정 → 프로젝트 탭** — iOS 프로젝트 경로와 빌드 스킴 등록
2. **설정 → 화면 매핑 탭** — 화면 ID와 관련 Swift 파일 연결 _(선택)_
3. **작업 관리** — 새 작업 추가 → 에이전트가 자동으로 처리

---

## 📁 프로젝트 구조

```
agent-system/
├── launcher/
│   ├── server.js          # 터미널 에이전트 실행 (포트 3001)
│   └── ios-watcher.js     # 작업 감지 및 에이전트 자동 실행 (포트 3002)
├── projects/
│   ├── macos-app/         # Electron macOS 앱
│   ├── web-agent/         # React + Vite UI
│   └── ios-agent/         # Claude 에이전트 작업 디렉토리
└── shared/
    ├── task-queue/        # pending / in-progress / completed
    ├── screens/           # 화면별 컨텍스트 파일
    ├── projects.json      # 등록된 프로젝트 목록
    └── task-history.json  # 완료 작업 이력
```

---

## 🔐 환경변수 _(선택)_

사내 프록시 환경이라면 프로젝트 루트에 `.env` 파일을 생성합니다.

| 변수 | 설명 |
|------|------|
| `CERT_PATH` | 사내 프록시 SSL 인증서 경로 |

---

<div align="center">

Made with ❤️ and Claude Code

</div>
