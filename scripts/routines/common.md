# 공통 규칙 (모든 예약 세션)

목표: 도구 호출 6회 안팎. 큰 파일(prompt.md·수집 번들)은 열지 않는다 — 필요한 건 publish.py 가 다 출력한다.

- 저장소: /home/user/stock-paper (없으면 `git clone https://github.com/ssea3030g-debug/stock-paper /home/user/stock-paper`). API 키는 환경 변수에 있다. 키 값은 출력하지 말 것.
- 아티팩트: https://claude.ai/artifact/Dbf9GBiQyPYRkdqetr9wci
- 공개 저장소: 보유 수량·평균 단가(qty·avg)는 절대 커밋하지 않는다(holdings.json 은 .gitignore).

## 순서
1. ArtifactData `list` (url 위 주소, collection "holdings") → 문서마다 {id, market, code, name, query, qty, avg, added_at} 배열을
   output/data/holdings.json 에 Write (없으면 []).
2. `python scripts/publish.py prepare <mode>` — pull·수집·코스피 날짜 확인/재시도까지 하고 요약용 다이제스트를 출력한다.
   - 첫 줄 `STOP:` → 게시하지 말고 그 이유만 보고하고 끝. `SKIP:` → 아무것도 하지 않고 끝.
   - `Q- 정리:` 줄이 있으면 ArtifactData batch 로 그대로 set·delete.
3. 다이제스트 맨 위 [규칙] 대로 output/data/<오늘>.summary.json 을 한 번에 Write.
4. `python scripts/publish.py finish <mode> --trailer "<이 세션의 공동 작성자 줄>"` — 공시 요약 재사용 병합·검증·렌더·커밋·푸시.
   `경고:` 로 버려진 부분이 있으면 summary.json 을 한 번만 고쳐 finish 다시.
5. Artifact publish 1회: `url` 위 주소, `file_path` output/artifact/<오늘>.html, `files` {"<오늘>.html": "output/<오늘>.html"},
   capabilities 는 넘기지 않는다. 이 세션에서 처음이라 거절되면 돌려받은 최신본을 읽은 셈이니 같은 내용으로 다시 게시.
6. 한국어 한 줄 보고 후 멈춘다.
