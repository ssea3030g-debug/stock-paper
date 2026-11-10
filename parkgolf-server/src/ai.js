// AI 코치: 경기 기록 + 날씨 + 골프장 특징 + 지난 기록을 Claude 에게 보내 쉬운 말로 분석을 받는다.
import Anthropic from '@anthropic-ai/sdk';

export const MODEL = 'claude-opus-5-5';

const SYSTEM = `당신은 파크골프를 오래 가르친 다정한 코치입니다. 사용자는 70~80대 어르신이고, 휴대폰 큰 글씨로 읽거나 소리로 듣습니다.

받는 자료:
- 경기 기록(홀별 기준 타수와 친 타수 또는 코스 합계, OB 횟수, 몸 상태, 순위, 메모)
- 그날 날씨(경기 시간대 기온·바람·비)와 골프장 특징(잔디 종류, 경사, 코스 길이, 강가 여부)
- 지난 경기 요약, 그리고 앱이 규칙으로 미리 계산한 분석(참고용)

할 일:
- 숫자에 근거해 이 사람의 플레이 특징을 짚고, 날씨·골프장 특징이 점수에 준 영향을 연결해서 설명하세요. 자료에 없는 사실(그날 홀 배치, 그린 상태 등)은 지어내지 말고, 짐작이면 "~였을 수 있어요"라고 쓰세요.
- 보완할 점은 다음 경기에서 바로 해 볼 수 있는 구체적인 행동으로 쓰세요. 연습 과제는 집 근처나 연습장에서 혼자 할 수 있는 것으로, 횟수나 거리를 넣어 주세요.
- 파크골프 규칙에 맞게 조언하세요(클럽 하나만 사용, 공을 굴리는 경기, 9홀 기준 타수 33).
- 어르신의 몸을 배려하세요: 무리한 연습량이나 과격한 동작은 권하지 말고, 더위·추위·피로에 대한 안전을 챙기세요.

말투: 존댓말, 짧은 문장, 쉬운 우리말. 영어 골프 용어는 버디·보기·OB 정도만 쓰고, 그 밖의 전문용어는 풀어서 쓰세요. 칭찬은 진심이 담기게, 지적은 부드럽게 하세요.
분량: 각 항목의 설명은 두 문장 안팎으로 짧게. 잘한 점·보완할 점은 각각 1~3개, 연습 과제는 2~3개.`;

const ITEM = { type: 'object', properties: { title: { type: 'string' }, detail: { type: 'string' } }, required: ['title', 'detail'], additionalProperties: false };
export const SCHEMA = {
  type: 'object',
  properties: {
    summary: { type: 'string', description: '경기 전체를 두세 문장으로 요약' },
    good: { type: 'array', items: ITEM, description: '잘한 점 1~3개' },
    improve: { type: 'array', items: ITEM, description: '보완할 점 1~3개' },
    practice: { type: 'array', items: ITEM, description: '연습 과제 2~3개. detail 에 방법·횟수' },
    encouragement: { type: 'string', description: '마지막 응원 한마디' }
  },
  required: ['summary', 'good', 'improve', 'practice', 'encouragement'],
  additionalProperties: false
};

/* 앱에서 온 자료를 필요한 것만 골라 크기를 제한 */
export function buildPrompt(body) {
  const mode = body.mode === 'overall' ? 'overall' : 'round';
  const clip = (s, n) => String(s == null ? '' : s).slice(0, n);
  const data = {
    mode,
    round: mode === 'round' && body.round ? {
      date: clip(body.round.date, 10), kind: clip(body.round.kind, 10), title: clip(body.round.title, 60),
      sections: (body.round.sections || []).slice(0, 4).map(s => ({ name: clip(s.name, 10), pars: (s.pars || []).slice(0, 9), strokes: s.strokes ? s.strokes.slice(0, 9) : null, total: s.total })),
      ob: body.round.ob, condition: clip(body.round.condition, 10), rank: clip(body.round.rank, 10), memo: clip(body.round.memo, 300),
      weather: body.round.weather || null
    } : undefined,
    course: body.course ? { name: clip(body.course.name, 60), features: body.course.features || {}, info: body.course.info || {} } : null,
    history: (body.history || []).slice(-30),
    ruleBased: body.ruleBased || null,
    overall: mode === 'overall' ? body.overall || null : undefined
  };
  const ask = mode === 'round'
    ? '이 경기를 분석해 주세요. 지난 기록과 비교해서 달라진 점이 있으면 꼭 짚어 주세요.'
    : '지금까지 기록 전체를 보고 이 분의 플레이 스타일과 앞으로 한두 달 동안 집중할 점을 알려 주세요.';
  return `${ask}\n\n<기록>\n${JSON.stringify(data)}\n</기록>`;
}

export class CoachError extends Error {
  constructor(message, status) { super(message); this.status = status; }
}

export async function coach(body, { apiKey, fetch: fetchImpl } = {}) {
  const client = new Anthropic({ apiKey, ...(fetchImpl ? { fetch: fetchImpl } : {}), maxRetries: 2, timeout: 120000 });
  let res;
  try {
    res = await client.beta.messages.create({
      model: MODEL,
      max_tokens: 16000,
      // 안전 판단으로 거절되면 같은 요청을 다른 모델로 자동으로 다시 시도
      betas: ['server-side-fallback-2026-07-01'],
      fallbacks: 'default',
      output_config: { effort: 'medium', format: { type: 'json_schema', schema: SCHEMA } },
      system: SYSTEM,
      messages: [{ role: 'user', content: buildPrompt(body) }]
    });
  } catch (e) {
    if (e instanceof Anthropic.AuthenticationError) throw new CoachError('서버의 Claude API 키가 올바르지 않아요.', 500);
    if (e instanceof Anthropic.RateLimitError) throw new CoachError('AI 사용량이 많아요. 잠시 뒤 다시 해 주세요.', 429);
    if (e instanceof Anthropic.APIError) throw new CoachError(`AI 서버 오류(${e.status ?? '연결'}). 잠시 뒤 다시 해 주세요.`, 502);
    throw e;
  }
  if (res.stop_reason === 'refusal') throw new CoachError('AI가 이 기록은 분석하지 않았어요. 메모 내용을 바꿔 다시 해 보세요.', 422);
  if (res.stop_reason === 'max_tokens') throw new CoachError('AI 답이 너무 길어 끊겼어요. 다시 해 주세요.', 502);
  const text = res.content.filter(b => b.type === 'text').map(b => b.text).join('');
  let out;
  try { out = JSON.parse(text); } catch { throw new CoachError('AI 답을 읽지 못했어요. 다시 해 주세요.', 502); }
  return { ...out, model: res.model, usage: { input: res.usage.input_tokens, output: res.usage.output_tokens } };
}
