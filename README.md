<div align="center">

# 🤖 iOS Agent System

**Claude Code를 활용한 iOS 개발 자동화 백오피스**

웹 UI에서 작업을 등록하면 Claude 에이전트가 실제 iOS 코드를 구현합니다.

[![Node.js](https://img.shields.io/badge/Node.js-18%2B-339933?style=flat-square&logo=node.js&logoColor=white)](https://nodejs.org)
[![React](https://img.shields.io/badge/React-19-61DAFB?style=flat-square&logo=react&logoColor=black)](https://react.dev)
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
웹 UI (포트 5173)
  └─ 작업 등록 → shared/task-queue/pending/
       └─ ios-watcher.js 감지
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

### 1. 설치

```bash
git clone https://github.com/gom1n/iOSAgentTool.git
cd iOSAgentTool

cd projects/web-agent && npm install && cd ../..
```

### 2. 실행

터미널을 두 개 열어서 각각 실행합니다.

```bash
# 터미널 1 — 웹 UI
cd projects/web-agent
npm run dev
```

```bash
# 터미널 2 — 에이전트 감시자
node launcher/ios-watcher.js
```

브라우저에서 **http://localhost:5173** 접속

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
│   └── ios-watcher.js     # 작업 감지 및 에이전트 자동 실행
├── projects/
│   ├── web-agent/         # React + Vite 웹 UI
│   └── ios-agent/         # Claude 에이전트 작업 디렉토리
│       └── CLAUDE.md      # 에이전트 행동 지침 (수정 가능)
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
