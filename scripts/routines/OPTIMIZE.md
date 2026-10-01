# 토큰 절감 작업 지시서 (새 대화에서 이 파일대로 진행)

배경: 예약 작업(아침 발행·오후판·앱 열기 갱신)이 토큰을 많이 쓴다. 원인은
(1) 예약 세션이 매일 길어짐(아침 세션 첫날 5만→15만 토큰), (2) 한 번 발행에 도구 호출 ~20회,
(3) 후보 데이터를 크게 읽음. 아래 ①~④를 구현하고, 각 단계마다 테스트(`python -m unittest discover -s tests`) 후 main 에 커밋·푸시.
도구 호출 수를 아끼는 것이 목표다 — 여기서도 큰 파일을 통째로 출력하지 말 것.

## 현재 구성 (2026-10-01 기준)
- 저장소: https://github.com/ssea3030g-debug/stock-paper (main) — **공개 저장소**. 보유 수량·평균 단가(qty·avg)는 절대 커밋 금지(main.strip_private, render.PRIVATE 참고).
- 아티팩트: https://claude.ai/artifact/Dbf9GBiQyPYRkdqetr9wci (db 컬렉션 holdings, mcp fire_trigger 로 앱 갱신 요청). capabilities 는 게시 때 넘기지 않는다(유지).
- 예약(Routine) — 모두 persistent_session_id 방식:
  - 아침 발행 trig_01SrQVHSxh8HrRtWhAijdZ6w, `CRON_TZ=Asia/Seoul 45 6 * * *`, 세션 session_019bhYxud3L7NXetkrxoFm1c
  - 오후판 trig_01R2Upyo2JC7r3s21wddcCYm, `CRON_TZ=Asia/Seoul 50 15 * * 1-5`, 세션 session_01GBgJvJzWCjWtquwMwwuT5d (국장 중심)
  - 앱 열기 갱신 trig_01QR6QctLxR9gssc9Nbj71mu (스케줄 없음, 앱이 fire), 세션 session_01TpKfAqeRHfhE7eFSNRPAho. config.yaml `app.refresh_trigger_id` 가 이 id.
- 지침: scripts/routines/common.md, morning.md, evening.md, refresh.md. 예약 프롬프트는 "pull 후 지침대로" 한 줄.
- 예약 프롬프트(지시문)는 그 예약이 들어가는 대화에서만 수정 가능 → 바꾸려면 삭제 후 재생성.
- 옛 개발 세션 session_01QKyCfxaSb6Uxq8R1GMsuTD 는 너무 길어(42만 토큰) 더 쓰지 않는다.

## ① 발행을 스크립트로 묶기 (도구 호출 ~20 → ~6)
- `scripts/publish.py` (또는 main.py 하위 명령) 추가:
  - `prepare <mode>` (mode = morning | evening | refresh): pull → holdings.json 은 이미 있다고 가정 → 수집(morning: `--collect-only`, evening: `--collect-only --live`, refresh: `--only korea_market,us_market,indicators,holdings --live`) → 코스피 날짜 확인·1회 재시도 → **요약용 다이제스트**를 stdout 에 출력.
  - 다이제스트(목표 5천 토큰 이하): 시장 수치 한 줄씩, 의심 급변 자동 표시(같은 묶음 대비 유독 큰 변동, 예: 브렌트 vs WTI), 뉴스 후보 최대 40개 `id | 출처 | 시각 | 제목 | 설명 80자`, 내 종목별 뉴스 후보 8개·새 공시(지난 summary 에 points 없는 것만, 본문 300자)·찌라시 후보, 찌라시 후보(seen_before 아닌 것 우선, 본문 200자). 지난 호 summary 에서 재사용 가능한 filings points 는 스크립트가 자동 병합.
  - `finish <mode>`: summary.json 검증·렌더(`--render-only --archive <output/20*.html 날짜들>`)→ 경고 목록 출력 → git add/commit/push. 게시는 Claude 가 Artifact 도구로 1회.
  - refresh 모드는 다이제스트 없이 prepare 가 바로 렌더까지 하고, 새 종목이 있을 때만 그 종목 후보를 출력.
- 지침 파일(morning/evening/refresh.md)을 "① ArtifactData list → holdings.json 쓰기 ② `python scripts/publish.py prepare X` ③ summary.json 한 번에 Write ④ `finish X` ⑤ Artifact publish 1회 ⑥ 한 줄 보고"로 줄인다.
- prompt.md 는 계속 생성하되 Claude 가 읽지 않게(다이제스트로 대체). 규칙 요약(투자 권유 금지·데이터에 없는 사실 금지·change null 이면 변동 언급 금지·의심 급변은 보고만)은 다이제스트 맨 위 5줄로.

## ② 예약 세션이 쌓이지 않게
- 먼저 시험: `create_trigger` 에 `create_new_session_on_fire: true`(run_once_at 으로 2분 뒤 1회)로 간단한 작업("pull 후 `python -m unittest discover -s tests` 결과 한 줄")을 걸어 새 세션이 저장소 접근·Artifact/ArtifactData 사용이 되는지 확인. (예전엔 'Code from External' 정책으로 막혔음 — 다시 확인.)
- 되면: 세 예약을 모두 fresh-session 방식으로 재생성(프롬프트는 완결된 지시: 저장소 clone/pull, 해당 지침 파일 경로). 옛 예약 삭제, 전용 세션 3개는 archive. 앱 갱신 예약 id 가 바뀌면 config.yaml `app.refresh_trigger_id` 수정 → 오늘 호 다시 렌더·게시.
- 안 되면: 현 방식 유지 + 매주 일요일에 세션 교체(새 세션 만들고 예약 재생성)하는 절차를 common.md 에 적고, 지금 한 번 교체.

## ③ 앱 열기 갱신 줄이기
- templates/app.js `maybeRefresh`: 평일 09:00~15:40 KST 에만, 마지막 갱신 후 60분 지났을 때만 fire (config `app.refresh_after_min: 60`, 장 시간은 config 로). 주말·장외엔 요청 안 함.
- refresh.md: 0단계 "60분 안 갱신 + 종목 목록 동일 → 아무것도 안 하고 끝"을 스크립트가 판정해 출력하게.

## ④ 데이터 줄이기
- config: news.max_collect 60 → 40, summarizer 의 뉴스 description 컷 250 → 120, 내 종목 news_candidates 12 → 8.
- 영문 Finnhub 기사는 description 100자.

## 확인
- 각 모드 prepare 를 실제로 한 번 돌려 다이제스트 크기(문자 수)를 보고 5천 토큰(약 1.5만 자) 이하인지 확인.
- 끝나면 사용자에게: 바뀐 점, 예상 절감, 새 예약 id 를 한국어로 짧게 보고.
