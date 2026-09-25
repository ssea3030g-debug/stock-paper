# 아침증권신문 — Claude 예약 실행 지시문

이 문서는 매일 06:45 KST 에 새로 시작되는 Claude 클라우드 세션에게 주는 지시문입니다.
현재 아티팩트 URL: https://claude.ai/artifact/Dbf9GBiQyPYRkdqetr9wci
Routine(예약 작업)을 만들 때 아래 "지시문" 블록을 그대로 프롬프트로 넣고,
`{저장소}` 와 `{아티팩트 URL}` 두 곳만 바꿔 넣으세요.

필요한 환경 설정 (Claude 클라우드 환경 → Edit)
- 네트워크 허용 도메인: data-dbg.krx.co.kr, query1.finance.yahoo.com, ecos.bok.or.kr,
  api.stlouisfed.org, openapi.koreainvestment.com, www.yna.co.kr, www.hankyung.com, www.mk.co.kr
- 환경 변수: ECOS_API_KEY, FRED_API_KEY, KRX_API_KEY (, KIS_APP_KEY, KIS_APP_SECRET)
- ANTHROPIC_API_KEY 는 필요 없음 — 요약은 예약 세션의 Claude 가 직접 씀

---

## 지시문

아침증권신문 오늘 호를 발행해 줘. 순서대로 하고, 단계가 실패해도 가능한 데까지 진행해.

1. `git clone {저장소} paper && cd paper`
2. `python main.py --collect-only` 를 실행해. 마지막 줄에 출력되는 프롬프트 파일 경로를 기억해.
3. 그 프롬프트 파일(`output/data/<오늘>.prompt.md`)을 읽고, 파일 안의 규칙을 그대로 지켜서
   요약 JSON 을 `output/data/<오늘>.summary.json` 에 써.
   - 데이터에 없는 사실·숫자·원인·전망은 절대 쓰지 마. 투자 권유 표현 금지.
   - value 가 null 인 항목은 "데이터 없음"이야. 언급하지 않거나 확인되지 않았다고만 써.
   - 뉴스가 하나도 없으면 news 는 빈 배열로 둬.
4. Artifact 도구로 `{아티팩트 URL}` 의 파일 목록(scope: files)을 조회해서 `YYYY-MM-DD.html` 형식 파일들의
   날짜를 쉼표로 이어 붙여. (처음이면 목록이 없을 수 있음)
5. `python main.py --render-only --archive <4번 날짜 목록>` 을 실행해. 로그의 "요약 검증" 경고를 확인하고,
   경고로 버려진 부분이 있으면 3번 요약을 고쳐서 5번을 한 번만 다시 실행해.
6. Artifact 도구로 게시해:
   - url: `{아티팩트 URL}`
   - file_path: `output/artifact/<오늘>.html`
   - files: `{"<오늘>.html": "output/artifact/<오늘>.html"}`  (지난 호 링크용 사본)
7. 마지막에 한 줄로 보고해: 발행일, 호수, 수집 성공/실패 항목, 요약 방식, 경고 수.
