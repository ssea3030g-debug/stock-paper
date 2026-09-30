# 앱 열 때 시세·내 종목 갱신

common.md 를 먼저 따른다. 기사(머리기사·뉴스·찌라시)는 건드리지 않고 지수·지표 표와 내 종목만 최신으로.
0. 저장소 pull. output/data/<오늘>.json 의 holdings_at 이 30분 안이고 holdings 문서 목록(id 들)이 bundle 의 holdings 와 같으면 "이미 최신" 한 줄만 보고하고 끝.
1. 오늘자 output/data/<오늘>.json 이 없으면(아침 발행 전) 먼저 `python main.py --collect-only` 후 prompt.md 규칙으로 summary.json 을 간단히 작성.
2. holdings.json 저장 → `python main.py --only korea_market,us_market,indicators,holdings --live --archive <날짜들>`.
3. Q- 정리. summary.json 의 holdings 에 없는 종목이 있으면 그 종목의 news·filings(points)·rumors 를 채우고 다시 렌더.
4. 게시 → 커밋·푸시. 보고: 코스피·원달러 최신값 한 줄.
