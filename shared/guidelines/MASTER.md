# Agent System - 전체 시스템 가이드

## 통신 규약

### Task JSON 형식
```json
{
  "id": "task-001",
  "created_at": "2024-01-15T10:00:00Z",
  "title": "로그인 기능 추가",
  "platform": "iOS",
  "description": "사용자 로그인 페이지 구현",
  "status": "pending",
  "requirements": [
    "이메일/비밀번호 입력",
    "유효성 검사"
  ]
}
```

### Status JSON 형식
```json
{
  "task_id": "task-001",
  "agent": "ios-agent",
  "status": "in-progress",
  "progress": 60,
  "last_updated": "2024-01-15T10:30:00Z"
}
```
