# 아침 발행 (매일 06:45 KST)

common.md 를 먼저 따른다.
1. 저장소 pull, holdings.json 저장.
2. `python main.py --collect-only`. korea_market·us_market·indicators 가 모두 실패면 게시하지 말고 원인만 짧게 보고.
   코스피 as_of 가 market_status.last_session 보다 오래됐으면(Yahoo 빈 행) 1분 뒤 `python main.py --only korea_market` 로 한 번 다시.
3. summary.json 작성: news 는 시장 파장이 가장 큰 3개, holdings 는 종목마다 news(최대 3, 영문은 한국어로)·filings(각 공시 핵심 2~3줄 points)·rumors(최대 3), rumors 는 해명 공시 본문과 미확인 보도에서 최대 5개(seen_before 는 새 것이 모자랄 때만).
4. 렌더 → Q- 정리 → 게시 → 커밋·푸시.
5. 보고: 발행일, 호수, 수집 성공/실패, 내 종목 수, 요약 경고 수, 의심 수치.
