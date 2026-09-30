# 공통 규칙 (모든 예약 세션)

- 저장소: /home/user/stock-paper (없으면 `git clone https://github.com/ssea3030g-debug/stock-paper /home/user/stock-paper`, 있으면 `git -C /home/user/stock-paper pull -q origin main`). API 키는 환경 변수에 있다(.env 없음). 키 값은 출력하지 말 것.
- 아티팩트: https://claude.ai/artifact/Dbf9GBiQyPYRkdqetr9wci
  - 이 세션에서 처음 게시할 때는 먼저 Artifact `action: read` 로 한 번 읽는다(다른 대화가 만든 아티팩트라 읽어야 게시 가능).
  - 게시: Artifact publish, `url` 위 주소, `file_path` output/artifact/<오늘>.html, `files` {"<오늘>.html": "output/<오늘>.html"}, capabilities 는 넘기지 않는다.
  - 지난 호 날짜: `ls output/20*.html` 의 날짜들을 쉼표로 이어 `--archive` 에 넘긴다.
- 내 종목: ArtifactData `list` (url 위 주소, collection "holdings") → 문서마다 {id, market, code, name, query, qty, avg} 배열을 output/data/holdings.json 에 저장 (없으면 []). 이 파일은 깃에 올리지 않는다(.gitignore).
- Q- 로 시작하는 holdings 문서: 수집 결과(holdings items 의 db_id → key·market·code·name)를 보고 holdings/<key> 에 {market, code, name, qty, avg, added_at} 을 set, Q- 문서는 delete.
- 요약(summary.json) 규칙은 output/data/<오늘>.prompt.md 에 있다. 데이터에 없는 사실·숫자 금지, change 가 null 이면 변동 언급 금지, 투자 권유 금지. 선물 월물 교체 등으로 의심스러운 급변(한 지표만 유독 큰 폭)은 머리기사·핵심 3줄에 쓰지 말고 보고에만.
  - prompt.md 는 크다(60KB). 통째로 cat 하지 말고 python 으로 필요한 부분만 뽑아 본다. 지난 호 summary.json 에서 그대로 쓸 수 있는 것(공시 points 등)은 재사용한다.
- 렌더: `python main.py --render-only --archive <날짜들>`. 요약 검증 경고로 버려진 부분은 한 번만 고쳐 다시 렌더.
- 커밋·푸시: `git add -A && git commit -m "<요약>" && git push origin main` (output/data 의 번들·summary 도 올라간다 — 다른 예약 세션이 이어 쓰는 상태 파일). 커밋 메시지 끝에 이 세션의 공동 작성자 줄을 붙인다.
- Yahoo 가 HTTP 429 로 막히면 1분 뒤 한 번만 다시. 그래도 안 되면 이전 값 유지된 채로 진행하고 보고.
- 보고는 한국어 한두 줄. 작업이 끝나면 더 할 일 없이 멈춘다.
