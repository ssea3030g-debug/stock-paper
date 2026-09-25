# 아침증권신문 사본 — 매일/매시간 예약 실행 지시문 (Cloudflare Pages)

원본 예약 작업·원본 아티팩트와는 별개입니다. 이 저장소의 `copy-app` 브랜치 코드로 신문을 만들어
`copy-site` 브랜치에 푸시하고, Cloudflare Pages 가 그 브랜치를 자동 배포합니다.

두 개의 예약 작업이 있습니다.
- **매일 새벽 3시**: 신문 전체를 새로 만듭니다 (원본과 같은 방식).
- **매시간**: Cloudflare 앱에서 방금 추가된 새 종목이 있는지만 확인하고, 있으면 그 자리에서
  전체를 한 번 다시 만듭니다. 없으면 아무것도 하지 않습니다. (claude.ai 밖에서는 종목을 추가한
  '그 순간'을 부를 방법이 없어서, 최대 1시간 지연으로 대신합니다.)

내 종목 목록은 `config.yaml` 의 `site.pages_url` 이 채워져 있으면 Cloudflare KV(`/api/holdings`)에서,
비어 있으면 `data/site_holdings.json` 에서 가져옵니다 — `scripts/site_holdings.py` 가 이 판단을 대신합니다.

---

## 매일 새벽 지시문 (전체 새로 만들기)

아침증권신문 **사본** 오늘 호를 만들어 Cloudflare 배포 브랜치(copy-site)에 올려 줘. 순서대로 하고, 실패하면 이유를 한두 줄로 보고해.
원본 아티팩트(https://claude.ai/artifact/Dbf9GBiQyPYRkdqetr9wci)·원본 예약 작업·main 브랜치는 절대 건드리지 마. Artifact 게시도 하지 마. API 키 값은 출력하지 마.

1. 저장소 추가 도구(add_repo)로 ssea3030g-debug/stock-paper 를 access "push" 로 붙여.
2. `git clone --depth 1 -b copy-app https://github.com/ssea3030g-debug/stock-paper /home/user/stock-paper` 와
   `git clone --depth 1 -b copy-site https://github.com/ssea3030g-debug/stock-paper /home/user/site` 를 실행해.
3. /home/user/stock-paper 에서 `python scripts/site_holdings.py --out output/data/holdings.json` 을 실행해
   내 종목 목록을 받아. 로그에 "cloudflare"/"static" 어느 쪽에서 받았는지 나와.
4. `python main.py --collect-only` 를 실행해. 마지막 줄의 프롬프트 파일 경로를 기억해.
5. `output/data/<오늘>.json` 에서 korea_market, us_market, indicators 의 ok 가 모두 false 이면 여기서 멈추고 원인을 보고해.
6. 프롬프트 파일을 읽고 그 안의 규칙을 그대로 지켜 요약 JSON 을 `output/data/<오늘>.summary.json` 에 써.
   데이터에 없는 사실·숫자·원인·전망 금지, 투자 권유 금지, value 가 null 인 항목은 언급하지 않거나 확인되지 않았다고만, change 가 null 이면 변동을 쓰지 마.
7. /home/user/site 의 `YYYY-MM-DD.html` 파일 날짜들을 쉼표로 이어 붙여
   `python main.py --render-only --archive <날짜 목록>` 을 실행해. 로그의 "요약 검증" 경고로 버려진 부분이 있으면 요약을 고쳐서 한 번만 다시 실행해.
8. `python scripts/build_site.py --site /home/user/site` 를 실행해.
9. /home/user/site 에서 `git add -A && git commit -m "사이트: <오늘> 호" && git push origin copy-site` 를 실행해. copy-site 외의 브랜치에는 푸시하지 마. 푸시가 인증 문제로 실패하면 오류를 그대로 보고해.
10. 마지막에 한 줄로 보고해: 발행일, 호수, 수집 성공/실패 항목, 경고 수, 푸시 결과.

## 매시간 지시문 (새 종목만 확인)

Cloudflare 앱에 새로 추가된 종목이 있으면 그 종목 자료를 한 번 수집해서 사본을 다시 올려 줘. 없으면 아무것도 하지 말고 "새 종목 없음"이라고만 보고해.
원본 아티팩트·원본 예약 작업·main 브랜치는 절대 건드리지 마. Artifact 게시도 하지 마.

1. 저장소 추가 도구(add_repo)로 ssea3030g-debug/stock-paper 를 access "push" 로 붙여.
2. `git clone --depth 1 -b copy-app https://github.com/ssea3030g-debug/stock-paper /home/user/stock-paper` 와
   `git clone --depth 1 -b copy-site https://github.com/ssea3030g-debug/stock-paper /home/user/site` 를 실행해.
3. /home/user/stock-paper 에서:
   `python scripts/site_holdings.py --out output/data/holdings.json`
   `python scripts/new_holdings.py --live output/data/holdings.json --page /home/user/site/index.html --out output/data/new_holdings.json`
4. `output/data/new_holdings.json` 이 빈 배열(`[]`)이면 **여기서 멈추고** "새 종목 없음"이라고만 보고해. 아무것도 커밋·푸시하지 마.
5. 비어 있지 않으면, 위 "매일 새벽 지시문"의 4~10번을 그대로 실행해 (holdings 는 이미 3번에서 받았으니 다시 받지 않아도 됨). 커밋 메시지는 `사이트: <오늘> 호 (새 종목 반영)` 으로 해.
