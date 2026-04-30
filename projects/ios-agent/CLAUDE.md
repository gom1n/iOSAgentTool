# iOS 에이전트 가이드

## ⚡ 세션 시작 즉시 실행
이 CLAUDE.md를 읽는 즉시 아래 순서를 따른다. 사용자의 추가 지시를 기다리지 않는다.

1. `shared/task-queue/pending/` 폴더를 확인한다
2. `.json` 파일이 있으면 읽고 작업을 시작한다
3. 파일이 없으면 "대기 중 — 새 작업이 없습니다" 라고 알린다

---

## 역할
웹 백오피스에서 생성된 iOS 작업을 받아 `projectPath` 안의 실제 iOS 앱 코드를 구현한다.

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
  -d '{...task JSON..., "status": "completed", "agentSummary": "..."}'
```

`agentSummary` 규칙: 마크다운 사용, 원인분석 → 수정내용 → 결과 순, 3~10줄.

---

## 주의사항
- `web-agent/` 폴더 접근 금지
- `shared/` 폴더만으로 웹 에이전트와 통신
- 웹 UI가 `localhost:5173`에서 실행 중이어야 API 호출 가능
