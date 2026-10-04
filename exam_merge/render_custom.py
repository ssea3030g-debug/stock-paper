#!/usr/bin/env python3
"""custom_questions/*.json(새로 만든 문항)을 변형본과 같은 모양의 문항 그림(PNG, 300dpi)으로 만든다.

  python3 exam_merge/render_custom.py            # custom_questions/*.json → 같은 이름의 .png

글꼴은 변형본 PDF에 들어 있던 나눔명조 부분 글꼴(fonts/, SIL OFL)을 쓴다.
build.py는 custom_questions/<지문>_<번호>.png가 있으면 변형본의 그 문항 대신 이 그림을 넣고,
custom_questions/<지문>/q<번호>.png 묶음이 있으면 그 지문의 문항 전체를 새 문항으로 바꾼다(정답은 각 json의 answer).
"""
import glob
import html
import json
import os
import subprocess
import tempfile

HERE = os.path.dirname(os.path.abspath(__file__))
FONTS = sorted(glob.glob(os.path.join(HERE, 'fonts', 'U_*.ttf')))
# 부분 글꼴에 없는 글자는 같은 나눔명조 전체 글꼴(google/fonts, SIL OFL)로 찍는다
FULL = [os.path.join(HERE, 'fonts', 'NanumMyeongjo-Regular.ttf'), os.path.join(HERE, 'fonts', 'NanumMyeongjo-Bold.ttf')]
NEG = ('않은 것', '않는 것', '틀린 것', '없는 것', '다른 하나')   # 발문 속 부정어(앞 단어)는 밑줄
COLW = 263.0   # 변형본 한 단의 문항 폭(pt)


def css():
    faces, reg, bold = [], [], []
    for i, f in enumerate(FONTS):
        fam = f'nm{i}'
        faces.append(f"@font-face{{font-family:'{fam}';src:url('file://{f}')}}")
        (bold if 'Bold' in f else reg).append(f"'{fam}'")
    for f, lst in zip(FULL, (reg, bold)):
        if os.path.exists(f):
            faces.append(f"@font-face{{font-family:'{os.path.basename(f)[:-4]}';src:url('file://{f}')}}")
            lst.append(f"'{os.path.basename(f)[:-4]}'")
    fb = '"WenQuanYi Zen Hei",serif'
    return '\n'.join(faces) + f'''
body{{margin:0;background:#fff}}
.q{{width:{COLW}pt;padding:2pt 0 4pt 1pt;box-sizing:border-box;color:#000;
   font-family:{",".join(reg)},{fb};font-size:10pt;line-height:14.1pt}}
.stem u{{text-underline-offset:2pt;text-decoration-thickness:0.6pt}}
.stem{{font-family:{",".join(bold)},{",".join(reg)},{fb};font-size:10.3pt;line-height:14.5pt;margin-bottom:5pt}}
.bogi{{position:relative;border:0.6pt solid #000;margin:9pt 0 8pt;padding:9pt 7pt 7pt;font-size:9.6pt;line-height:13.7pt;text-align:justify}}
.lab{{position:absolute;top:-6.5pt;left:0;right:0;text-align:center;font-size:8.8pt;line-height:12pt}}
.lab span{{background:#fff;padding:0 5pt}}
table{{border-collapse:collapse;width:100%;margin-top:5pt;font-size:8.8pt;line-height:11.5pt}}
td,th{{border:0.5pt solid #000;padding:2pt 2.5pt;text-align:center;vertical-align:middle}}
th{{font-weight:bold;background:#f2f2f2}}
table{{table-layout:auto}}
td:first-child{{white-space:nowrap}}
th{{white-space:normal;word-break:keep-all;line-height:11pt}}
.ch{{margin-top:4pt;padding-left:1.15em;text-indent:-1.15em}}
.grid{{display:grid;grid-template-columns:1fr 1fr 1fr}}
.bl{{padding-left:1.2em;text-indent:-1.2em;margin-top:1pt}}
.ans{{margin:10pt 0 4pt 10pt;display:flex;align-items:flex-end}}
.ans span{{flex:1;border-bottom:0.6pt solid #000;margin-left:8pt;height:10pt}}
'''


def html_of(q):
    stem = html.escape(q['stem'])
    for w in NEG:
        if w in stem:
            k, a = stem.rfind(w), w.split()[0]
            stem = stem[:k] + f'<u>{a}</u>' + stem[k + len(a):]
            break
    out = [f'<div class="q"><div class="stem">{stem}</div>']
    if q.get('bogi_text') or q.get('table') or q.get('bogi_lines'):
        out.append('<div class="bogi"><div class="lab"><span>&lt;보 기&gt;</span></div>')
        if q.get('bogi_text'):
            out.append(f'<div style="white-space:pre-line">{html.escape(q["bogi_text"])}</div>')
        for ln in q.get('bogi_lines', []):
            out.append(f'<div class="bl">{html.escape(ln)}</div>')
        if q.get('table'):
            rows = q['table']
            out.append('<table><tr>' + ''.join(f'<th>{html.escape(c)}</th>' for c in rows[0]) + '</tr>')
            for r in rows[1:]:
                out.append('<tr>' + ''.join(f'<td>{html.escape(c)}</td>' for c in r) + '</tr>')
            out.append('</table>')
        out.append('</div>')
    chs = q.get('choices', [])
    if chs and max(len(c) for c in chs) <= 14:   # ㄱ, ㄴ 같은 짧은 선지는 기출처럼 한 줄에 셋씩
        out.append('<div class="grid">' + ''.join(
            f'<div class="ch">{"①②③④⑤"[i]} {html.escape(c)}</div>' for i, c in enumerate(chs)) + '</div>')
        chs = []
    for i, c in enumerate(chs):
        out.append(f'<div class="ch">{"①②③④⑤"[i]} {html.escape(c)}</div>')
    if q.get('short'):
        out.append('<div class="ans">답: <span></span></div>')
    out.append('</div>')
    return '\n'.join(out)


JS = r'''
let pw;
for (const p of [process.env.PLAYWRIGHT_PATH, '/opt/node22/lib/node_modules/playwright', 'playwright']) {
  if (!p) continue; try { pw = require(p); break; } catch (e) {}
}
(async () => {
  const b = await pw.chromium.launch();
  const pg = await b.newPage({deviceScaleFactor: 300 / 96});
  for (const [h, out] of JSON.parse(process.argv[2])) {
    await pg.goto('file://' + h);
    await pg.evaluate(() => document.fonts.ready);
    await (await pg.$('.q')).screenshot({path: out});
  }
  await b.close();
})();
'''


def main():
    jobs = []
    tmp = tempfile.mkdtemp(prefix='custom_q_')
    for j in sorted(glob.glob(os.path.join(HERE, 'custom_questions', '*.json')) +
                    glob.glob(os.path.join(HERE, 'custom_questions', '*', '*.json'))):
        with open(j, encoding='utf8') as f:
            q = json.load(f)
        h = os.path.join(tmp, os.path.relpath(j, HERE).replace(os.sep, '_')[:-5] + '.html')   # 지문마다 q1.json이 있으므로 경로로 구분
        with open(h, 'w', encoding='utf8') as f:
            f.write(f'<!doctype html><meta charset="utf-8"><style>{css()}</style>{html_of(q)}')
        jobs.append([h, j[:-5] + '.png'])
    js = os.path.join(tmp, 'shot.js')
    with open(js, 'w') as f:
        f.write(JS)
    subprocess.run(['node', js, json.dumps(jobs)], check=True)
    for _, p in jobs:
        print('만듦:', os.path.relpath(p, HERE))


if __name__ == '__main__':
    main()
