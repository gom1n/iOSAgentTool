#!/usr/bin/env python3
"""
compress_spec.py — spec.md 경량화
iOS/Web 에이전트 토큰 소비 최소화: boilerplate 제거 + 섹션 4 한 줄 재조립

사용법:
  python3 compress_spec.py input.md [output.md]   # 파일 모드 (output 생략 시 덮어쓰기)
  echo "..." | python3 compress_spec.py -          # stdin → stdout 모드
"""

import re
import sys


def compress(text: str) -> str:
    lines = text.splitlines()
    out = []
    i = 0
    section = None       # 현재 ## N. 섹션 번호
    in_codeblock = False # ``` 블록 안
    el = None            # 수집 중인 섹션4 요소 {'id', 'name', 'items'}
    after_kd = False     # 기획 정의: 이후 수집 모드

    def flush():
        nonlocal el, after_kd
        if el is None:
            return
        items = [s for s in el['items'] if s.strip()]
        header = f"{el['id']} {el['name']}".strip()
        if items:
            joined = ' / '.join(items)
            if len(header) + len(joined) + 2 <= 160:
                out.append(f"{header}: {joined}")
            else:
                out.append(f"{header}:")
                for item in items:
                    out.append(f"  {item}")
        else:
            out.append(header)
        el = None
        after_kd = False

    while i < len(lines):
        raw = lines[i]
        s = raw.strip()

        # ── ## N. 섹션 헤더 ──────────────────────────────────────
        m = re.match(r'^## (\d+)\.', raw)
        if m:
            if section == 4:
                flush()
            section = int(m.group(1))
            in_codeblock = False

            # 섹션 3: 내용이 비어있으면 섹션 전체 제거
            if section == 3:
                j = i + 1
                lookahead = []
                while j < len(lines) and not re.match(r'^## \d+\.', lines[j]):
                    lookahead.append(lines[j])
                    j += 1
                inner = ''.join(lookahead).replace('`', '').strip()
                if not inner:
                    i = j
                    continue

            # 섹션 5: 상태 전환 (Dynamic Panel) — Axure 내부 메타데이터, 에이전트에 무의미
            if section == 5:
                i += 1  # ## 5. 헤더 줄 건너뜀
                while i < len(lines) and not re.match(r'^## \d+\.', lines[i]):
                    i += 1
                continue

            out.append(raw)
            i += 1
            continue

        # ── 섹션 4: 화면 요소 상세 ──────────────────────────────
        if section == 4:
            # ### 4.X 영역 헤더 제거
            if re.match(r'^### 4\.\d+', raw):
                i += 1
                continue

            # > 주석 줄 제거
            if raw.startswith('>'):
                i += 1
                continue

            # 빈 줄 제거 (섹션4 안에서는 요소 사이 줄바꿈 불필요)
            if not s:
                i += 1
                continue

            # #### [N] name — 새 요소 시작
            m2 = re.match(r'^#### (\[[\w.]+\])\s*(.*)', raw)
            if m2:
                flush()
                el = {'id': m2.group(1).strip(), 'name': m2.group(2).strip(), 'items': []}
                after_kd = False
                i += 1
                continue

            # - *(디자인 시안에서 위치 미확인...) 제거
            if re.match(r'^- \*\(디자인 시안', raw):
                i += 1
                continue

            # - **기획 정의**: 레이블 → 수집 모드 ON
            if re.match(r'^- \*\*기획 정의\*\*:', raw):
                after_kd = True
                i += 1
                continue

            # 기획 정의 하위 항목: "  - content"
            if after_kd and el is not None:
                m3 = re.match(r'^  - (.+)', raw)
                if m3:
                    content = m3.group(1).strip()
                    if content:
                        el['items'].append(content)
                    i += 1
                    continue
                after_kd = False  # 들여쓰기 끝나면 수집 종료

            if s:
                out.append(raw)
            i += 1
            continue

        # ── 섹션 2: 레이아웃 코드블록(ASCII 아트) 제거 ──────────
        if section == 2:
            if s == '```':
                in_codeblock = not in_codeblock
                i += 1
                continue
            if in_codeblock:
                i += 1
                continue
            out.append(raw)
            i += 1
            continue

        # ── 공통: 섹션 2/4 외 ───────────────────────────────────

        # ASCII 박스 아트 줄 제거 (│ 등으로만 구성된 줄)
        if s and all(c in '│┌┐└┘├┤┬┴┼─ ' for c in s):
            i += 1
            continue

        # 좌표 패턴 인라인 제거: "(0,0) 1080x2121"
        raw = re.sub(r'\(\d+,\d+\)\s*\d+x\d+', '', raw)

        # (디자인 시안에서...) 단독 줄 제거
        if re.match(r'^[-\s*]*\(디자인 시안', raw):
            i += 1
            continue

        out.append(raw)
        i += 1

    flush()  # 파일 끝에 마지막 요소 flush

    # 연속 빈줄 3개 이상 → 1개
    result = re.sub(r'\n{3,}', '\n\n', '\n'.join(out))
    return result.strip()


def main():
    if len(sys.argv) >= 2 and sys.argv[1] != '-':
        path_in = sys.argv[1]
        with open(path_in, encoding='utf-8') as f:
            text = f.read()
        compressed = compress(text)
        path_out = sys.argv[2] if len(sys.argv) >= 3 else path_in
        with open(path_out, 'w', encoding='utf-8') as f:
            f.write(compressed)
        orig = len(text.encode('utf-8'))
        comp = len(compressed.encode('utf-8'))
        ratio = (1 - comp / orig) * 100
        print(f"{path_in}: {orig/1024:.1f}KB → {comp/1024:.1f}KB ({ratio:.0f}% 감소)", file=sys.stderr)
    else:
        text = sys.stdin.read()
        sys.stdout.write(compress(text))


if __name__ == '__main__':
    main()
