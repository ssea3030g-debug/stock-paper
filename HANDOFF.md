# 인수인계 (HANDOFF)

아침증권신문(stock-paper) — 국내외 증시·지표·뉴스·내 종목을 모아 신문 1면 모양 HTML로 발행하는 Python 프로그램.
사용법·설정 상세는 `README.md`, 예약 세션 운영은 `scripts/routines/*.md` 참고. 이 문서는 "지금 상태와 주의점" 요약이다.
(작성 기준: 2026-10-04, 마지막 발행 호 2026-10-02)

## 한눈에 보기
- 저장소: https://github.com/ssea3030g-debug/stock-paper (main, **공개 저장소**)
- 아티팩트(아이폰에서 보는 신문): https://claude.ai/artifact/Dbf9GBiQyPYRkdqetr9wci
  - db 컬렉션 `holdings` = 앱 '내 종목' 탭. capabilities 는 게시할 때 넘기지 않는다(유지).
- 발행물: `output/YYYY-MM-DD.html`, `output/index.html`(지난 호), `output/artifact/`(게시용, gitignore), `output/data/`(수집 원자료·요약 JSON)
- 창간 2026-09-25, 시간대 Asia/Seoul. Python 3.11+, 필수 패키지는 requests·Jinja2·PyYAML.

## 구조
| 경로 | 역할 |
|---|---|
| `main.py` | 진입점: 수집 → 요약 → 렌더 (`--collect-only`, `--render-only`, `--live`, `--only`, `--archive`, `--sample`, `--dry-run`) |
| `config.yaml` | 섹션 순서, 수집기, 뉴스 피드, 지표, 일정, 요약 정책(`app.refresh_trigger_id` 포함) |
| `collectors/` | korea_market, us_market, indicators, news, calendar, disclosures(DART), holdings, rumors (watchlist 는 구형·비활성) |
| `paper/` | http(재시도·robots), summarizer(프롬프트·검증), render, market_calendar, yahoo, fmt |
| `templates/` | `newspaper.html.j2`, `index.html.j2`, `app.js`(앱 열기 시 갱신 요청) |
| `scripts/publish.py` | 예약 세션용 묶음: `prepare <mode>`(수집·확인·다이제스트) / `finish <mode>`(요약 병합·검증·렌더·커밋·푸시) |
| `scripts/routines/` | 예약 세션 지침: `common.md`, `morning.md`, `evening.md`, `refresh.md`, `OPTIMIZE.md`(토큰 절감 작업 기록, 완료) |
| `data/krx_holidays.yaml` | KRX 휴장일 (2025~2026) |
| `tests/` | 단위 테스트 40개 (`python -m unittest discover -s tests -t .` → 현재 전부 통과) |

## 자동 발행 흐름
Claude 클라우드 예약(Routine)이 **전용 세션**에 들어가 지침대로 실행한다. 예약 프롬프트는 "pull 후 지침대로" 한 줄.
1. ArtifactData 로 `holdings` 읽어 `output/data/holdings.json` 작성(gitignore)
2. `python scripts/publish.py prepare <mode>` → 다이제스트 출력 (`STOP:`면 중단·보고, `SKIP:`면 아무것도 안 함)
3. Claude 가 다이제스트 맨 위 규칙대로 `summary.json` 작성
4. `python scripts/publish.py finish <mode>` → 검증·렌더·커밋·푸시
5. Artifact 게시 1회 → 한 줄 보고

| 모드 | 시각(KST) | 비고 |
|---|---|---|
| morning | 매일 06:45 | 전체 지면 |
| evening | 평일 15:50 | 국장 중심 오후판 |
| refresh | 앱을 열 때 | 평일 장 시간(09:00~15:40)·마지막 갱신 후 60분 경과 시에만 앱이 fire. 시세·내 종목만 갱신 |

요약은 항상 기계 검증(없는 숫자·투자 권유 표현·없는 기사 id는 버리고 자동 문장으로 대체).

## 현재 예약 (2026-10-01 교체 기준)
- 아침 `trig_01G5rzNpE5NgGjPMNBdwzXak` → `session_01RWs1AYagE56WTSyKraXkGi`
- 오후판 `trig_019hr1359q9UCsjcKY52bgD6` → `session_01QxJwzHsxyPf4aU4ab2P1yP`
- 앱 갱신 `trig_0143f8W4n59Fg7tYe6UMbuhg` → `session_01NTw28G6wEZuzuaTEWWHGzy` (`config.yaml app.refresh_trigger_id` 와 일치해야 함)

> 위 id 는 문서 작성 시점 값이다. 최신 값은 `scripts/routines/common.md` 하단과 `git log`(예: "예약 세션 교체")로 확인. 교체 후 문서가 안 맞으면 common.md 를 기준으로 삼을 것.

## 꼭 지킬 것
- **보유 수량·평균 단가(`qty`·`avg`)는 절대 커밋 금지.** `holdings.json`·`*.prompt.md`·`*.reuse.json`은 `.gitignore`. 공개 저장소이므로 `main.strip_private`, `render.PRIVATE` 로직을 건드릴 때 특히 주의.
- API 키는 `.env`(로컬)·클라우드 환경 변수에만. 로그·출력에 키 값을 내지 않는다.
- 투자 권유·목표가·데이터에 없는 사실 금지, 변동값(change)이 없으면 변동 언급 금지, ⚠의심 수치는 본문에 쓰지 않고 보고만.
- 예약 프롬프트는 해당 예약이 들어가는 대화에서만 수정 가능 → 바꾸려면 삭제 후 재생성.
- 커밋 메시지 관례: 한국어 한 줄 (`10/2 아침판 발행` 등). 발행 커밋은 `finish` 가 만든다.

## 알려진 한계·함정
- **fresh-session 예약 불가**(2026-10-01 시험): 저장소가 소스로 안 붙어 코드 실행이 막히고 push 가 403. 그래서 영속 세션 방식 + **주 1회(일요일) 세션 교체**(절차는 `common.md`)로 세션이 길어져 토큰이 늘어나는 걸 막는다. 예약 세션에는 세션·예약 관리 도구가 없어 스스로 교체 못 한다 → 개발 세션에서 "common.md 의 세션 교체 진행"이라고 지시.
- 옛 개발 세션 `session_01QKyCfxaSb6Uxq8R1GMsuTD`(42만 토큰)는 쓰지 않는다.
- KIS 순매수 API 응답 필드는 공개 문서 기반이며 실키로 미검증 — 로그 확인 필요.
- Yahoo 데이터는 비공식 공개 차트 API(개인·비상업 용도). 유가·미 국채는 FRED 가 1~2일 늦어 Yahoo 우선.
- RSS 는 robots.txt 확인 후에만 요청, 같은 호스트 최소 1초 간격.
- 코스피 기준일이 어긋나면 `prepare` 가 1회 재시도하고 그래도 안 맞으면 `STOP:`.

## 정기 할 일
- **매년 12월**: `data/krx_holidays.yaml` 에 다음 해 KRX 휴장일 추가 (현재 2026까지 — 2027 미입력). 임시공휴일은 `config.yaml market_calendar.extra_holidays`.
- **FOMC 등** 수동 일정은 `config.yaml calendar.manual_events` (현재 비어 있음).
- **매주 일요일**: 예약 세션 교체, 교체 후 `app.refresh_trigger_id` 갱신 → `python main.py --render-only --archive <날짜들>` → 게시 → 커밋·푸시.
- 키 목록: `ECOS_API_KEY`, `FRED_API_KEY`, `KRX_API_KEY`, `KIS_APP_KEY/SECRET`, `DART_API_KEY`, (Finnhub), 선택 `ANTHROPIC_API_KEY`. 없으면 해당 항목은 대체 출처 또는 "데이터 없음".

## 자주 쓰는 명령
```bash
python -m unittest discover -s tests -t .         # 테스트
python main.py --sample                            # 네트워크 없이 미리보기
python main.py --render-only --archive 2026-10-01 2026-10-02   # 저장된 데이터로 다시 렌더
python scripts/publish.py prepare morning          # 수집 + 다이제스트
python scripts/publish.py finish morning --trailer "<공동 작성자 줄>"
```

## 최근 이력 (요약)
- 9/25 창간 → 내 종목·찌라시·공시 섹션 추가, 휴장·기준일 처리 보강
- 10/1 토큰 절감: `publish.py` 묶음, 다이제스트, 수집 데이터 축소, 앱 자동 갱신을 평일 장 시간·60분 간격으로 제한 (`OPTIMIZE.md` 완료)
- 10/1 예약 세션 교체, 10/2 아침판·시세 갱신까지 발행 확인
