# 앱 열 때 시세·내 종목 갱신 — mode: refresh

common.md 순서대로. 기사(머리기사·뉴스·찌라시)는 건드리지 않고 지수·지표·내 종목만 최신으로.
- prepare 가 `SKIP:`(60분 안 갱신 + 종목 목록 같음)이면 바로 끝.
- prepare 가 바로 렌더까지 한다. summary.json 은 **새 종목이 출력됐을 때만** 그 종목의 holdings 항목을 추가해 Write.
  (오늘 호가 아직 없다고 나오면 다이제스트 전체로 summary.json 을 간단히 작성.)
- 그다음 finish refresh → 게시. 보고: prepare 의 `갱신됨:` 줄.
