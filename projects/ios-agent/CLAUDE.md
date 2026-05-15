# iOS 에이전트 가이드

## ⚡ 세션 시작 즉시 실행
이 CLAUDE.md를 읽는 즉시 아래 순서를 따른다. 사용자의 추가 지시를 기다리지 않는다.

1. `shared/task-queue/pending/` 폴더를 확인한다
2. `.json` 파일이 있으면 읽고 작업을 시작한다
3. 파일이 없으면 "대기 중 — 새 작업이 없습니다" 라고 알린다

---

## 역할
웹 백오피스에서 생성된 iOS 작업을 받아 `projectPath` 안의 실제 iOS 앱 코드를 구현한다.

작업 JSON에 `scheme` 필드가 있으면 해당 스킴을 기준으로 작업한다. 빌드·확인·테스트 시 반드시 해당 스킴을 사용하며(`xcodebuild -scheme {scheme}` 등), 스킴이 없을 경우 프로젝트의 기본 스킴을 사용한다. `agentSummary` 작성 시 어떤 스킴으로 작업했는지 반드시 명시한다.

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
# 화면 요약
find ../../shared/screens -name "{screenId}.md" | head -1 | xargs cat

# 기획 스펙 (파일이 있을 때만)
find ../../shared/screens -name "{screenId}_spec.md" | head -1 | xargs -I{} cat {}
```

### 3. 작업 완료 — completed로 이동
```bash
curl -s -X PATCH http://localhost:5173/api/task-queue/{task.id} \
  -H "Content-Type: application/json" \
  -d '{...task JSON..., "status": "completed", "agentSummary": "...", "agentSuccess": true, "agentBuildSuccess": true, "humanEstimateMinutes": 숫자}'
```

`agentSummary` 규칙: 마크다운 사용, 원인분석 → 수정내용 → 결과 순, 3~10줄.

`agentSuccess` 규칙: 작업을 성공적으로 완료했으면 `true`, 오류/실패/불완전하면 `false`.

`agentBuildSuccess` 규칙: xcodebuild가 성공(exit 0)이면 `true`, 빌드 에러 발생이면 `false`, 빌드를 실행하지 않았으면 필드 자체를 생략.

`humanEstimateMinutes` 규칙: 경력 3년차 개발자가 이 작업을 처음부터 혼자 처리한다면 몇 분 걸릴지 정수로 추정. 기획·디자인 시간 제외, 순수 개발 및 코드리뷰 기준. (예: 간단한 UI 수정 30~60, 기능 추가 60~240, 복잡한 신규 화면 240~480)

---

## 주의사항
- `web-agent/` 폴더 접근 금지
- `shared/` 폴더만으로 웹 에이전트와 통신
- 웹 UI가 `localhost:5173`에서 실행 중이어야 API 호출 가능
- 이미 완료한 작업이 다시 pending으로 들어올 수 있다. 왜 다시 들어왔는지 원인을 파고들지 말고, 간단히 확인 후 바로 수행하라. 원인 조사에 여러 턴을 낭비하지 않는다.
