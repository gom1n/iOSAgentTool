---
name: commit-push
description: 변경사항을 분석해 커밋 메시지를 자동 작성하고, 브랜치를 선택해 커밋 + 푸시한다.
disable-model-invocation: true
argument-hint: [branch]
allowed-tools: Bash
---

변경사항을 커밋하고 푸시한다.

## 절차

1. `git status`와 `git diff`로 변경사항 파악
2. 변경 내용을 바탕으로 커밋 메시지 초안 작성
   - 형식:
     ```
     제목: 영어 한 줄 요약 (50자 이내, "type: short description" 스타일)
     
     한국어 본문: 무엇을, 왜 변경했는지 2~4줄
     
     Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>
     ```
   - 제목은 영어, 본문은 한국어로 작성
3. 브랜치 선택
   - 인자로 브랜치명이 주어졌으면 그대로 사용
   - 없으면 `git branch -a`로 목록을 보여주고 사용자에게 어느 브랜치에 푸시할지 물어본다
4. 커밋 메시지를 사용자에게 보여주고 확인받는다 (수정 요청 가능)
5. 확인되면 `git add -A` → `git commit` → `git push origin <branch>` 실행
6. 결과 출력

## 주의사항

- 스테이징되지 않은 파일도 포함해서 전체 변경사항 기준으로 메시지 작성
- 푸시 전 반드시 사용자 확인을 받는다
- 커밋 메시지는 사용자가 수정할 수 있도록 보여준 뒤 진행
