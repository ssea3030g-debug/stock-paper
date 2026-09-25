# 아침증권신문

매일 아침 7시(KST)에 국내외 증시·주요 지표·뉴스·일정을 모아 **신문 1면 모양의 HTML**로 발행하는 Python 프로그램입니다.
신문에 넣을 내용(종목, 섹션, 분량, 순서)은 코드를 고치지 않고 `config.yaml`만 바꿔서 조정합니다.

- 상승은 빨강 ▲, 하락은 파랑 ▼ (한국식)
- 모든 수치에 **기준 시점**과 **출처 링크**를 함께 표시
- 수집기 하나가 실패해도 나머지는 계속 진행하고, 지면에는 "데이터 없음"으로 표시
- 추석·설날 같은 국내 휴장일을 인식해 "휴장, 최근 거래일 기준"으로 표시
- 아이폰 세로 화면 우선, 라이트·다크 모드 지원, CSS를 포함한 HTML 파일 하나

---

## 1. 설치

Python 3.11 이상이 필요합니다.

```bash
cd stock-paper
python3 -m venv .venv
source .venv/bin/activate            # Windows: .venv\Scripts\activate
pip install -r requirements.txt
cp .env.example .env                 # 그리고 .env 에 API 키 입력
```

필수 패키지는 `requests`, `Jinja2`, `PyYAML` 세 개뿐입니다. `anthropic`, `holidays`, `pytest`는 선택입니다.

## 2. API 키 발급

키가 하나도 없어도 실행됩니다. 키가 없는 항목은 Yahoo Finance로 대신 받거나 "데이터 없음"으로 표시합니다.

| 환경 변수 | 용도 | 비용 | 발급처 |
|---|---|---|---|
| `ECOS_API_KEY` | 원/달러 환율, 국고채 3년 | 무료 | https://ecos.bok.or.kr/api → 회원가입 → 인증키 신청 |
| `FRED_API_KEY` | 유가, 미 국채 10년, 미국 지표 발표 일정 | 무료 | https://fredaccount.stlouisfed.org/apikeys → Request API Key |
| `KRX_API_KEY` | 코스피·코스닥 공식 지수 | 무료 | https://openapi.krx.co.kr → 인증키 신청 후 **서비스별 이용신청**(KOSPI/KOSDAQ 시리즈 일별시세정보) |
| `KIS_APP_KEY`, `KIS_APP_SECRET` | 외국인·기관·개인 순매수 | 무료 | 한국투자증권 계좌 → https://apiportal.koreainvestment.com 에서 KIS Developers 신청 |
| `ANTHROPIC_API_KEY` | Claude API 요약 (`provider: api`일 때) | 유료 | https://console.anthropic.com → API Keys |

- 키는 `.env` 파일에만 넣으세요. `.gitignore`에 들어 있어서 저장소에 올라가지 않습니다.
- KRX는 인증키를 받은 뒤 **사용할 서비스를 따로 이용신청**해야 호출됩니다.
- KIS 순매수 API의 파라미터는 `config.yaml`의 `collectors.korea_market.kis`에 있습니다. KIS 문서와 다르면 코드를 고치지 말고 설정만 바꾸세요.

## 3. 설정 (`config.yaml`)

### 섹션 순서와 표시 여부
목록에 적힌 순서가 곧 지면 순서입니다. `enabled: false`로 두면 숨겨집니다.
```yaml
sections:
  - { id: masthead,     enabled: true }
  - { id: holiday,      enabled: true }
  - { id: headline,     enabled: true }
  - { id: us_market,    enabled: true, title: "미국 증시" }   # 미국을 먼저 보고 싶으면 위로
  - { id: korea_market, enabled: true, title: "국내 증시" }
  - { id: news,         enabled: true, title: "주요 뉴스", max_items: 5 }
  - { id: calendar,     enabled: false }                       # 일정 숨기기
```

### 관심 종목 추가
```yaml
collectors:
  watchlist:
    stocks:
      - { name: "삼성전자", code: "005930", market: KOSPI }
      - { name: "에코프로", code: "086520", market: KOSDAQ }
      - { name: "애플",     code: "AAPL",   market: US }
```

### 뉴스 키워드 거르기
```yaml
  news:
    lookback_hours: 24
    keywords:
      include: ["반도체", "금리", "환율"]   # 비우면 전체
      exclude: ["광고", "협찬"]
    feeds:
      - { name: "연합뉴스 경제", url: "https://www.yna.co.kr/rss/economy.xml" }
```

### 지표 추가
ECOS 통계코드(`통계표/주기/항목`)나 FRED 시리즈 ID, Yahoo 심볼만 알면 됩니다.
```yaml
  indicators:
    items:
      - { id: jpykrw, name: "원/100엔", unit: "원", sources: [ecos], ecos: "731Y001/D/0000002" }
```

### 일정
```yaml
  calendar:
    recurring:
      - { monthday: 1, time: "09:00", title: "월간 수출입동향 발표 (산업통상자원부)" }
    manual_events:
      - { date: 2026-10-28, title: "FOMC 회의 (~29일)", region: US }
```

### 요약 방식 (`summary.provider`)
| 값 | 동작 |
|---|---|
| `session` | Claude 예약 세션이 요약 파일을 써 둠 (API 키 불필요, 아래 5-1) |
| `api` | `ANTHROPIC_API_KEY`로 Claude API 호출 |
| `extractive` | AI 없이 수집한 수치로 문장을 만들고, 기사는 제목과 첫 문장만 사용 |
| `auto` (기본) | 요약 파일 → API 키 → extractive 순으로 사용 |

어떤 방식이든 결과를 한 번 더 검사합니다. 데이터에 없는 숫자, 투자 권유 표현(`summary.banned_phrases`), 없는 기사 id가 나오면 그 부분은 버리고 자동 문장으로 채웁니다.

### 휴장일
`data/krx_holidays.yaml`에 2025~2026년 KRX 휴장일이 들어 있습니다. **매년 12월 KRX가 다음 해 휴장일을 발표하면 이 파일에 추가하세요.** 임시공휴일은 `config.yaml`의 `market_calendar.extra_holidays`에 넣어도 됩니다.

## 4. 실행

```bash
python main.py                          # 오늘 신문: 수집 → 요약 → HTML
python main.py --date 2026-09-25        # 특정 날짜 기준
python main.py --date 2026-09-25 --dry-run   # 파일을 쓰지 않고 결과만 출력
python main.py --sample                 # 네트워크 없이 샘플 데이터로 지면 미리보기 ("견본" 표시)
python main.py --collect-only           # 수집 + 요약용 프롬프트 파일까지만
python main.py --render-only            # 저장된 수집 결과 + 요약 파일로 HTML만
```

결과물
- `output/YYYY-MM-DD.html`: 그날 신문 (브라우저에서 바로 열림)
- `output/index.html`: 지난 신문 목록
- `output/artifact/YYYY-MM-DD.html`: claude.ai 아티팩트 게시용
- `output/data/`: 수집 원자료(JSON), 요약 프롬프트, 요약 결과
- `logs/YYYY-MM-DD.log`: 실행 로그

## 5. 매일 07:00 자동 발행

### 5-1. Claude 클라우드 예약 → 아이폰 아티팩트 (추천)
아이폰에서 claude.ai 아티팩트 링크 하나로 매일 새 신문을 봅니다.
1. 이 폴더를 GitHub 저장소에 올립니다. 예약 세션이 매번 새 컨테이너에서 코드를 받아야 하기 때문입니다.
2. Claude 클라우드 환경 설정에서 **네트워크 허용 도메인**과 **API 키 환경 변수**를 추가합니다. 목록은 `scripts/claude_routine.md`에 있습니다.
3. `scripts/claude_routine.md`의 지시문으로 매일 06:45 KST 예약 작업을 만듭니다. 요약은 예약 세션의 Claude가 직접 쓰므로 Anthropic API 키가 필요 없습니다.
4. 아이폰에서 아티팩트를 열고 Claude 앱 사이드바에 고정합니다. Safari라면 **공유 → 홈 화면에 추가**를 누르세요.

### 5-2. GitHub Actions → GitHub Pages
`.github/workflows/daily.yml`이 매일 22:00 UTC(= 07:00 KST)에 실행됩니다.
1. 저장소 **Settings → Pages → Source**를 "GitHub Actions"로 설정합니다.
2. **Settings → Secrets and variables → Actions**에 `.env.example`의 키를 같은 이름으로 등록합니다.
3. **Actions** 탭에서 "아침증권신문 발행"을 한 번 수동 실행해 확인합니다.
4. 신문 주소는 `https://<아이디>.github.io/<저장소>/`입니다. 지난 호는 저장소에 자동 커밋됩니다.

GitHub의 예약 실행은 부하에 따라 수 분에서 수십 분 늦을 수 있습니다.

### 5-3. 내 컴퓨터 cron
`scripts/crontab.example`을 참고해 `crontab -e`에 한 줄을 추가합니다. 컴퓨터가 켜져 있어야 실행됩니다.

## 6. 테스트

```bash
python -m pytest -q          # 또는: python -m unittest discover -s tests -t .
```
수집기마다 `tests/fixtures/`의 샘플 응답으로 확인하는 항목:
- 파싱, 기준 시점, 출처 URL (API 키 노출 없음)
- 대체 출처로 넘어가기, 실패 처리
- 휴장일, 뉴스 기간·키워드·중복 제거
- 요약 검증(지어낸 숫자, 투자 권유 차단)
- 섹션 순서와 끄기

## 7. 폴더 구조

```
main.py                 실행 진입점
config.yaml             신문 내용 설정
collectors/             출처별 수집기 (공통 인터페이스 BaseCollector.run → SectionResult)
  korea_market.py       KRX Open API → Yahoo / 한국투자증권 순매수
  us_market.py          Yahoo Finance
  indicators.py         ECOS → FRED → Yahoo
  watchlist.py          Yahoo Finance
  news.py               RSS (robots.txt 확인, 표준 라이브러리 파서)
  calendar.py           FRED 발표 일정 + 휴장일 + 설정 일정
paper/
  http.py               타임아웃·재시도(지수 백오프)·호스트별 요청 간격·robots.txt
  market_calendar.py    KRX 휴장일 판단
  summarizer.py         요약 프롬프트·검증·API/세션/자동 문장
  render.py             Jinja2 렌더링, 지난 호 목록
templates/              신문 HTML 템플릿 (CSS 포함)
data/krx_holidays.yaml  KRX 휴장일 표 (매년 갱신)
scripts/                cron 예시, Claude 예약 지시문
tests/                  단위 테스트와 샘플 응답
```

## 8. 수집 원칙과 한계

- 공식 API와 RSS를 우선 사용합니다. RSS 요청 전에는 robots.txt를 확인하고, 허용되지 않거나 확인할 수 없으면 요청하지 않습니다. 막힌 곳은 우회하지 않습니다.
- Yahoo Finance 데이터는 yfinance가 쓰는 공개 차트 API로 받습니다. 개인적·비상업적 용도로만 사용하세요.
- 같은 호스트에는 최소 1초 간격으로 요청하고, 타임아웃 15초, 최대 3회 재시도합니다(`config.yaml`의 `http`).
- 한국투자증권 순매수 API의 응답 필드는 공개 문서를 바탕으로 작성했으며, 실제 키로는 아직 확인하지 않았습니다. 처음 실행할 때 로그를 확인하세요.
- 요약 검증은 숫자와 금지 표현을 기계적으로 확인합니다. 문장의 뜻까지 검증하지는 못하므로, 투자 판단의 근거로 쓰지 마세요.
