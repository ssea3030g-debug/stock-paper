# 오후판 (월·금 16:55 KST)

common.md 를 먼저 따른다. 오늘 국내 장 마감 수치로 오늘 호를 새로 쓴다(같은 날짜 파일을 덮어씀).
1. 저장소 pull, holdings.json 저장.
2. `cp output/data/<오늘>.json output/data/<오늘>.morning.json` (있으면) 후 `python main.py --collect-only --live`.
   코스피 as_of 가 오늘이 아니면(국내 휴장·데이터 미수신) morning.json 을 되돌리고 게시하지 말고 이유만 보고.
3. summary.json 새로 작성: 머리기사·핵심 3줄은 오늘 국내 장 마감(코스피·코스닥·환율·국고채)과 미국 선물·장중 흐름 중심, news 3개는 오늘 하루 파장이 가장 큰 것. 금요일이면 머리기사에 한 주 흐름을 데이터 범위 안에서 한 문장 덧붙여도 됨.
4. 렌더 → 게시 → 커밋·푸시(morning.json 은 지운다).
5. 보고: 코스피 종가·등락, 요약 경고 수, 의심 수치.
