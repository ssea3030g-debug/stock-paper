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

## 매주 일요일: 예약 세션 교체 (세션이 길어져 토큰이 늘지 않게)
예약 세션에는 세션·예약 관리 도구(claude-code-remote)가 없어 스스로 교체할 수 없다. 사용자가 개발 세션에서
"scripts/routines/common.md 의 세션 교체 진행"이라고 하면 그 세션이 한다. (fresh-session 예약은 2026-10-01 시험 결과
저장소가 세션 소스로 붙지 않아 코드 실행이 'Code from External'로 막히고 push 가 403 → 쓸 수 없음.)
1. create_session 3개: source_url https://github.com/ssea3030g-debug/stock-paper, tags ["stock-paper","config:auto-create-pr:off"],
   제목 "증권신문 · 아침 발행 / 오후판 / 앱 열기 갱신", prompt 는 "예약 전용 세션, 지금은 pull·테스트·push --dry-run 한 줄 보고".
2. create_trigger 3개(persistent_session_id = 새 세션): 아침 `CRON_TZ=Asia/Seoul 45 6 * * *`, 오후판 `CRON_TZ=Asia/Seoul 50 15 * * 1-5`,
   앱 갱신은 스케줄 없음. 프롬프트: "[아침 발행] … pull 후 common.md 와 morning.md 지침대로 (mode morning)" 형식.
3. 옛 예약 delete_trigger, 옛 세션 archive_session.
4. config.yaml `app.refresh_trigger_id` 를 새 앱 갱신 예약 id 로 → `python main.py --render-only --archive <날짜들>` → 게시 → 커밋·푸시.
5. 아래 '현재 예약' 을 새 id 로 고친다.

현재 예약 (2026-10-01 교체):
- 아침 trig_01G5rzNpE5NgGjPMNBdwzXak → session_01RWs1AYagE56WTSyKraXkGi
- 오후판 trig_019hr1359q9UCsjcKY52bgD6 → session_01QxJwzHsxyPf4aU4ab2P1yP
- 앱 갱신 trig_0143f8W4n59Fg7tYe6UMbuhg → session_01NTw28G6wEZuzuaTEWWHGzy
