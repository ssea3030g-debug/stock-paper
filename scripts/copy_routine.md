# 아침증권신문 사본 — 매일 예약 실행 지시문 (Cloudflare Pages)

원본 예약 작업·원본 아티팩트와는 별개입니다. 이 작업은 `copy-app` 브랜치 코드로 신문을 만들어
`copy-site` 브랜치에 푸시하고, Cloudflare Pages 가 그 브랜치를 자동 배포합니다.
내 종목 목록은 `data/site_holdings.json` 을 고쳐서 바꿉니다.

---

## 지시문

아침증권신문 **사본** 오늘 호를 만들어 Cloudflare 배포 브랜치에 올려 줘. 순서대로 하고, 실패하면 이유를 한두 줄로 보고해.
원본 아티팩트(Dbf9GBiQyPYRkdqetr9wci)·원본 예약 작업·main 브랜치는 절대 건드리지 마. Artifact 게시도 하지 마.

1. 저장소 추가 도구(add_repo)로 ssea3030g-debug/stock-paper 를 access "push" 로 붙여.
2. `git clone --depth 1 -b copy-app https://github.com/ssea3030g-debug/stock-paper /home/user/stock-paper`
   `git clone --depth 1 -b copy-site https://github.com/ssea3030g-debug/stock-paper /home/user/site`
3. /home/user/stock-paper 에서 `mkdir -p output/data && cp data/site_holdings.json output/data/holdings.json` 후
   `python main.py --collect-only` 를 실행해. 마지막 줄의 프롬프트 파일 경로를 기억해.
4. `output/data/<오늘>.json` 에서 korea_market, us_market, indicators 의 ok 가 모두 false 이면 여기서 멈추고 원인을 보고해.
5. 프롬프트 파일을 읽고 그 안의 규칙을 그대로 지켜 요약 JSON 을 `output/data/<오늘>.summary.json` 에 써.
   데이터에 없는 사실·숫자·원인·전망 금지, 투자 권유 금지, null 값은 언급하지 않거나 확인되지 않았다고만.
6. /home/user/site 의 `YYYY-MM-DD.html` 파일 날짜들을 쉼표로 이어 붙여
   `python main.py --render-only --archive <날짜 목록>` 을 실행해. "요약 검증" 경고로 버려진 부분이 있으면
   요약을 고쳐서 한 번만 다시 실행해.
7. `python scripts/build_site.py --site /home/user/site` 를 실행해.
8. /home/user/site 에서 `git add -A && git commit -m "사이트: <오늘> 호" && git push origin copy-site`.
   푸시가 인증 문제로 실패하면 그 오류를 그대로 보고해.
9. 마지막에 한 줄로 보고해: 발행일, 호수, 수집 성공/실패 항목, 경고 수, 푸시 결과.
