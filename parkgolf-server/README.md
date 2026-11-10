# 파크골프 수첩 서버 (Cloudflare Workers)

[파크골프 수첩](../parkgolf/README.md) 앱과 기상청·Claude 사이에 두는 작은 중계 서버입니다.
키는 이 서버의 **비밀값**에만 저장되고, 할머니 휴대폰이나 앱 코드에는 들어가지 않습니다.

```
할머니 폰 (앱)  ──비밀번호──▶  이 서버  ──키──▶  기상청 단기예보 API
                                       └──키──▶  Claude API (AI 코치)
```

| 주소 | 하는 일 |
|---|---|
| `GET /health` | 연결 확인 (어떤 기능이 켜져 있는지) |
| `GET /weather?lat=..&lon=..` | 기상청 초단기실황 + 단기예보 → 앱이 쓰는 모양으로 변환. 10분 저장 |
| `POST /analyze` | 경기 기록·날씨·골프장 특징·지난 기록을 Claude 에게 보내 쉬운 말 분석을 받음 |

## 비용
- **Cloudflare Workers**: 무료 (하루 10만 번 요청까지)
- **기상청 API**: 무료 (개발계정 하루 10,000번)
- **Claude API**: 쓴 만큼 냅니다. 모델은 Claude Opus 5.5(입력 100만 토큰당 $4, 출력 $20). 분석 한 번에 입력 2~4천, 출력(생각 포함) 2~5천 토큰 정도로 **한 번에 대략 100원 안팎으로 예상**합니다. 실제 값은 콘솔 사용량에서 확인하세요.
- 한 번 받은 분석은 앱에 저장되어 다시 열어도 돈이 들지 않고, ‘다시 받기’를 누를 때만 새로 요청합니다.

## 설치 (가족이 한 번만)

### 1. 기상청 키 받기 (무료)
1. https://www.data.go.kr 가입 → **기상청_단기예보 ((구)_동네예보) 조회서비스** 검색 → **활용신청**
2. 마이페이지 → 개발계정 → 그 서비스의 **일반 인증키 (Decoding)** 를 복사
   - 신청 직후 1~2시간은 "등록되지 않은 키" 오류가 날 수 있어요.

### 2. Claude API 키 받기 (유료)
1. https://console.anthropic.com 가입 → 결제 수단 등록 → **API Keys** 에서 새 키 만들기
2. **콘솔의 지출 한도(Limits)를 꼭 정해 두세요.** (예: 한 달 5달러) — 이 서버에도 하루 횟수 제한이 있지만 대략적인 값이라, 확실한 상한은 콘솔 한도입니다.

### 3. 서버 올리기
Node.js 20 이상이 깔린 컴퓨터에서:
```bash
cd parkgolf-server
npm install
npx wrangler login          # 브라우저가 열리면 Cloudflare 가입·로그인
```
`wrangler.toml` 의 `ALLOWED_ORIGINS` 에 앱 주소를 넣으세요 (예: `"https://아이디.github.io"`). 그다음:
```bash
npx wrangler deploy
npx wrangler secret put KMA_KEY            # 1번의 기상청 키 붙여넣기
npx wrangler secret put ANTHROPIC_API_KEY  # 2번의 Claude 키 붙여넣기
npx wrangler secret put APP_PASSCODE       # 할머니 폰에 넣을 비밀번호 (아무 말이나, 한글 가능)
```
`deploy` 가 알려 주는 주소(`https://parkgolf-server.<이름>.workers.dev`)를 적어 두세요.
키는 채팅·메신저·코드에 붙여 넣지 말고 위 명령에만 넣으세요.

### 4. 앱에 연결
할머니 폰에서 앱 → ⚙️ 설정·백업 → **서버 연결** → 서버 주소와 비밀번호 → **저장하고 확인**.
"기상청 날씨 ✅, AI 코치 ✅" 가 뜨면 끝입니다.

## 안전장치
- **앱 비밀번호**(`APP_PASSCODE`): 날씨·AI 요청마다 확인. 앱 코드에 없고 할머니 폰에만 저장됩니다(백업 파일에도 빠짐).
- **허용 주소**(`ALLOWED_ORIGINS`): 다른 웹사이트에서 이 서버를 부르지 못하게 막음.
- **1분에 5번**(Cloudflare 요청 제한) + **하루 30번**(`AI_DAILY_LIMIT`, 대략적인 값) AI 분석 제한.
- Claude 가 안전 판단으로 거절하면 같은 요청을 다른 모델로 자동 재시도합니다(`fallbacks: "default"`).

## AI 에게 보내는 것
경기 날짜·종류·대회 이름, 홀별 타수, OB·몸 상태·순위·메모(300자까지), 그날 날씨, 골프장 이름과 특징, 지난 경기 요약.
**할머니 이름과 함께 친 분들 이름(내기 기록)은 보내지 않습니다.**

## 시험·개발
```bash
npm test                                  # 가짜 응답으로 시험 (키·인터넷 필요 없음)
npx wrangler deploy --dry-run --outdir dist   # 설정·묶기 확인
cp .dev.vars.example .dev.vars && npm run dev # 내 컴퓨터에서 실행 (진짜 키 필요)
```

## 한계
- 기상청 예보는 **오늘~3일 뒤**입니다. 지난 경기 날짜의 날씨와 미세먼지는 앱이 계속 Open-Meteo 에서 받습니다.
- 골프장 **운영 여부를 알려 주는 공개 API는 없어서**, 서버가 있어도 운영 상황은 날씨·휴장일로 짐작한 "예상"입니다.
