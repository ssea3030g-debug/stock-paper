#!/usr/bin/env python3
"""custom_questions/*.json(새로 만든 문항)을 변형본과 같은 모양의 문항 그림(PNG, 300dpi)으로 만든다.

  python3 exam_merge/render_custom.py            # custom_questions/*.json → 같은 이름의 .png

글꼴은 변형본 PDF에 들어 있던 나눔명조 부분 글꼴(fonts/, SIL OFL)을 쓴다.
build.py는 custom_questions/<지문>_<번호>.png가 있으면 변형본의 그 문항 대신 이 그림을 넣는다.
"""
import glob
import html
import json
import os
import subprocess
import tempfile

HERE = os.path.dirname(os.path.abspath(__file__))
FONTS = sorted(glob.glob(os.path.join(HERE, 'fonts', 'U_*.ttf')))
COLW = 263.0   # 변형본 한 단의 문항 폭(pt)


def css():
    faces, reg, bold = [], [], []
    for i, f in enumerate(FONTS):
        fam = f'nm{i}'
        faces.append(f"@font-face{{font-family:'{fam}';src:url('file://{f}')}}")
        (bold if 'Bold' in f else reg).append(f"'{fam}'")
    fb = '"WenQuanYi Zen Hei",serif'
    return '\n'.join(faces) + f'''
body{{margin:0;background:#fff}}
.q{{width:{COLW}pt;padding:2pt 0 4pt 1pt;box-sizing:border-box;color:#000;
   font-family:{",".join(reg)},{fb};font-size:10pt;line-height:14.1pt}}
.stem{{font-family:{",".join(bold)},{",".join(reg)},{fb};font-size:10.3pt;line-height:14.5pt;margin-bottom:5pt}}
.bogi{{position:relative;border:0.6pt solid #000;margin:9pt 0 8pt;padding:9pt 7pt 7pt;font-size:9.6pt;line-height:13.7pt;text-align:justify}}
.lab{{position:absolute;top:-6.5pt;left:0;right:0;text-align:center;font-size:8.8pt;line-height:12pt}}
.lab span{{background:#fff;padding:0 5pt}}
table{{border-collapse:collapse;width:100%;margin-top:5pt;font-size:8.8pt;line-height:11.5pt}}
td,th{{border:0.5pt solid #000;padding:2pt 2.5pt;text-align:center;vertical-align:middle}}
th{{font-weight:bold;background:#f2f2f2}}
td:first-child,th{{white-space:nowrap}}
.ch{{margin-top:4pt}}
'''


def html_of(q):
    out = [f'<div class="q"><div class="stem">{html.escape(q["stem"])}</div>']
    if q.get('bogi_text') or q.get('table'):
        out.append('<div class="bogi"><div class="lab"><span>&lt;보 기&gt;</span></div>')
        if q.get('bogi_text'):
            out.append(f'<div>{html.escape(q["bogi_text"])}</div>')
        if q.get('table'):
            rows = q['table']
            out.append('<table><tr>' + ''.join(f'<th>{html.escape(c)}</th>' for c in rows[0]) + '</tr>')
            for r in rows[1:]:
                out.append('<tr>' + ''.join(f'<td>{html.escape(c)}</td>' for c in r) + '</tr>')
            out.append('</table>')
        out.append('</div>')
    for i, c in enumerate(q['choices']):
        out.append(f'<div class="ch">{"①②③④⑤"[i]} {html.escape(c)}</div>')
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
    for j in sorted(glob.glob(os.path.join(HERE, 'custom_questions', '*.json'))):
        with open(j, encoding='utf8') as f:
            q = json.load(f)
        h = os.path.join(tmp, os.path.basename(j)[:-5] + '.html')
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
