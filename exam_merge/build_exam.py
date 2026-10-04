#!/usr/bin/env python3
"""학교 기출(독서과 문제지)과 같은 모양의 모의 시험지를 만든다.

  python3 exam_merge/build_exam.py --out 모의시험지.pdf [--exam exam_merge/mock_exam/exam.json]

exam.json: 제목·날짜·배점 목록과 세트 목록({file, parts}). 각 세트 파일은 문항 목록(render_custom.py의 json 형식,
stem에는 번호·배점 없이 적는다. 'pos'가 있으면 정답 선지를 맨 앞에 적고 자리를 pos로 정한다).
- 단답형은 stem이 "[단답형n]"으로 시작하고 short=true, 배점도 stem에 직접 적는다.
- 지문은 원본 시험지에서 잘라 쓰고(build.py), parts가 둘 이상이면 (가)(나)(다)를 붙여 잇는다(build_combo.py).
- 쪽: A4 2단, 머리글(제목·쪽수), 1쪽 실시일 표와 안내, 바닥글. 마지막 쪽 뒤에 정답표를 붙인다.
"""
import argparse
import html
import json
import os
import re
import subprocess
import tempfile

import build as B
import build_combo as C
import render_custom as R

HERE = os.path.dirname(os.path.abspath(__file__))
COLX = (30.0, 304.0)
COLW = 262.0
TOP1, TOPN, BOTTOM = 106.0, 54.0, 798.0
GAP = dict(head=4.0, passage=12.0, q=16.0, set=22.0)
CIRC = '①②③④⑤'
FONT = {k: os.path.join(HERE, 'fonts', v) for k, v in
        dict(g='NanumGothic-Bold.ttf', m='NanumMyeongjo-Regular.ttf', mb='NanumMyeongjo-Bold.ttf').items()}


def font_css():
    return ''.join(f"@font-face{{font-family:'{k}';src:url('file://{v}')}}" for k, v in FONT.items())


def shoot(jobs, tmp):
    """[(html, png)] → 각 html의 .q 요소를 300dpi PNG로"""
    js = os.path.join(tmp, 'shot.js')
    with open(js, 'w') as f:
        f.write(R.JS)
    subprocess.run(['node', js, json.dumps(jobs)], check=True)


def prepare(exam, tmp):
    """세트별 문항 번호·배점을 붙이고 PNG로 만든다 → [(heading_html, parts, [(kind, q, png)])]"""
    scores = list(exam['scores'])
    num = 0
    out, jobs, key = [], [], []
    style = f'<style>{R.css()}{font_css()}.hd{{font-family:"g",sans-serif;font-size:10.2pt;line-height:14pt;text-decoration:underline;text-underline-offset:2.5pt;padding:1pt 0 2pt}}</style>'
    for si, st in enumerate(exam['sets']):
        with open(os.path.join(os.path.dirname(exam['_path']), 'sets', st['file']), encoding='utf8') as f:
            qs = json.load(f)
        first, nsel, shorts = num + 1, 0, []
        items = []
        for q in qs:
            q = dict(q)
            if 'pos' in q:
                c = q['choices'].pop(0)
                q['choices'].insert(q['pos'] - 1, c)
                q['answer'] = CIRC[q.pop('pos') - 1]
            if q.get('short'):
                shorts.append(re.match(r'\[(단답형\d+)\]', q['stem']).group(1))
                label = shorts[-1]
            else:
                num += 1
                nsel += 1
                q['stem'] = f'{num}. {q["stem"]} [{scores[num - 1]:.1f}점]'
                label = str(num)
            png = os.path.join(tmp, f'q_{si}_{len(items)}.png')
            h = os.path.join(tmp, f'q_{si}_{len(items)}.html')
            with open(h, 'w', encoding='utf8') as f:
                f.write(f'<!doctype html><meta charset="utf-8">{style}{R.html_of(q)}')
            jobs.append([h, png])
            items.append((label, q, png))
            key.append((label, q['answer']))
        rng = f'{first}~{num}' if nsel > 1 else f'{first}'
        head = f'[{rng}{", " + ", ".join(shorts) if shorts else ""}] 다음 글을 읽고 물음에 답하시오.'
        hp = os.path.join(tmp, f'h_{si}.png')
        hh = os.path.join(tmp, f'h_{si}.html')
        with open(hh, 'w', encoding='utf8') as f:
            f.write(f'<!doctype html><meta charset="utf-8">{style}<div class="q"><div class="hd">{html.escape(head)}</div></div>')
        jobs.append([hh, hp])
        out.append((hp, st['parts'], items))
    # 1쪽 안내
    n_short = sum(1 for k, _ in key if k.startswith('단답'))
    guide = ('<div class="q" style="border:0.6pt solid #000;padding:5pt 6pt;font-size:9.4pt;line-height:15pt">'
             '※반, 번호, 이름, 과목코드( <b style="border:0.6pt solid #000;padding:0 3pt">0 1</b> )를 입력하시오.<br>'
             f'※선택형 ({num})문항 ( <b style="border:0.6pt solid #000;padding:0 3pt">0 1</b> 번~'
             f'<b style="border:0.6pt solid #000;padding:0 3pt">{num}</b> 번), 단답형 ({n_short})문항임.<br>'
             '※모든 문제는 제시된 지문 및 수업 내용을 참고하여 풀이하시오.</div>')
    gp = os.path.join(tmp, 'guide.png')
    gh = os.path.join(tmp, 'guide.html')
    with open(gh, 'w', encoding='utf8') as f:
        f.write(f'<!doctype html><meta charset="utf-8">{style}{guide}')
    jobs.append([gh, gp])
    shoot(jobs, tmp)
    return out, gp, key


def flow(blocks):
    """blocks: [(kind, png, w_pt, h_pt)] kind=head|passage|q|guide → 쪽 목록 [[(png,x,y,w,h)]]"""
    pages = [[]]
    st = dict(p=0, c=0, y=TOP1)
    top = lambda p: TOP1 if p == 0 else TOPN

    def nxt():
        if st['c'] == 0:
            st['c'] = 1
        else:
            st['c'], st['p'] = 0, st['p'] + 1
            pages.append([])
        st['y'] = top(st['p'])

    prev = None
    for kind, png, w, h in blocks:
        k = COLW / w
        w, h = COLW, h * k
        if prev and st['y'] > top(st['p']) + 0.1:
            st['y'] += GAP['set'] if kind == 'head' else GAP['head'] if prev == 'head' else \
                GAP['passage'] if prev == 'passage' else GAP['q']
        if kind == 'head':      # 발문 줄이 단 끝에 혼자 남지 않게
            if st['y'] + h + 60 > BOTTOM:
                nxt()
        if kind == 'passage':
            n = 0
            while True:
                room = BOTTOM - st['y']
                if h <= room + 0.5:
                    pages[st['p']].append((png, COLX[st['c']], st['y'], w, h))
                    st['y'] += h
                    break
                n += 1
                a, b = png[:-4] + f'_a{n}.png', png[:-4] + f'_b{n}.png'
                r = B.split_png(png, room, h, a, b) if room > 60 else None
                if r:
                    pages[st['p']].append((a, COLX[st['c']], st['y'], w, h * r[0]))
                    png, h = b, h * r[1]
                elif st['y'] <= top(st['p']) + 0.1:
                    s = room / h
                    pages[st['p']].append((png, COLX[st['c']], st['y'], w * s, h * s))
                    st['y'] += h * s
                    break
                nxt()
        else:
            if st['y'] + h > BOTTOM + 0.5 and st['y'] > top(st['p']) + 0.1:
                nxt()
            s = min(1.0, (BOTTOM - st['y']) / h)
            pages[st['p']].append((png, COLX[st['c']], st['y'], w * s, h * s))
            st['y'] += h * s
        prev = kind
    return pages


PAGE_CSS = '''@page{size:A4;margin:0}html,body{margin:0;background:#fff}
.pg{position:relative;width:595.28pt;height:841.89pt;overflow:hidden;page-break-after:always}
.pg>*{position:absolute}
.tt{left:0;width:595.28pt;top:13pt;text-align:center;font:17.5pt/1 'g',sans-serif;letter-spacing:-0.3pt}
.tt span{border-bottom:1.6pt solid #000;padding:0 24pt 3pt}
.pn{right:24pt;top:12pt;border:1pt solid #000;border-radius:7pt;padding:2pt 5pt;font:10.5pt/1 'g',sans-serif}
.ft{left:30pt;width:535pt;top:804pt;border-top:0.6pt solid #000;padding-top:3pt;font:7.3pt/10pt 'm',serif}
.ft b{float:right;font-weight:normal}
.vl{left:297pt;border-left:0.5pt solid #000}
table.info{left:30pt;top:52pt;width:535pt;border-collapse:collapse;font:9.2pt/1 'm',serif}
table.info td{border:0.6pt solid #000;height:20pt;text-align:center;padding:0 3pt}
.ak{left:40pt;top:70pt;width:515pt;font:10pt/1.5 'm',serif}
.ak table{border-collapse:collapse;width:100%;margin-top:10pt}
.ak td,.ak th{border:0.6pt solid #000;text-align:center;padding:3pt 2pt}
.ak th{background:#eee;font-family:'g'}
'''


def page_html(n, total, items, title, footer, first=False, last=False):
    body = [f'<div class="tt"><span>{html.escape(title)}</span></div>',
            f'<div class="pn">{n}/{total}</div>']
    top = TOP1 if first else TOPN
    if first:
        body.append('<table class="info"><tr><td style="width:62pt">실시일</td><td colspan="3" style="width:250pt">'
                    + html.escape(EXAM['date']) + '</td><td rowspan="2" style="width:14pt;font-size:8pt">결<br><br>재</td>'
                    '<td>교과주임</td><td>계</td><td>부장</td><td>교감</td><td>교장</td></tr>'
                    '<tr><td>출제자</td><td colspan="3"></td><td></td><td></td><td></td><td></td><td></td></tr></table>')
        top = TOP1
    body.append(f'<div class="vl" style="top:{top - 2:.1f}pt;height:{BOTTOM - top + 4:.1f}pt"></div>')
    for png, x, y, w, h in items:
        body.append(f'<img src="file://{png}" style="left:{x:.2f}pt;top:{y:.2f}pt;width:{w:.2f}pt;height:{h:.2f}pt">')
    body.append(f'<div class="ft">{html.escape(footer)}<b>{"끝." if last else "☞뒷면에 계속"}</b></div>')
    return f'<div class="pg">{"".join(body)}</div>'


def key_html(key, title):
    sel = [(k, v) for k, v in key if not k.startswith('단답')]
    rows = []
    for i in range(0, len(sel), 8):
        chunk = sel[i:i + 8]
        rows.append('<tr>' + ''.join(f'<th>{k}</th>' for k, _ in chunk) + '</tr><tr>'
                    + ''.join(f'<td>{v}</td>' for _, v in chunk) + '</tr>')
    sh = ''.join(f'<tr><th style="width:70pt">{k}</th><td style="text-align:left">{html.escape(v)}</td></tr>'
                 for k, v in key if k.startswith('단답'))
    return (f'<div class="pg"><div class="tt"><span>정답표</span></div><div class="ak">'
            f'<div style="font-family:g">{html.escape(title)}</div><table>{"".join(rows)}</table>'
            f'<table>{sh}</table></div></div>')


EXAM = {}


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--exam', default=os.path.join(HERE, 'mock_exam', 'exam.json'))
    ap.add_argument('--out', required=True)
    ap.add_argument('--work')
    a = ap.parse_args()
    work = os.path.abspath(a.work or tempfile.mkdtemp(prefix='exam_mock_'))
    os.makedirs(work, exist_ok=True)
    with open(a.exam, encoding='utf8') as f:
        EXAM.update(json.load(f))
    EXAM['_path'] = os.path.abspath(a.exam)

    sets, guide, key = prepare(EXAM, work)
    exams = {}
    import glob
    for p in sorted(glob.glob(os.path.join(HERE, 'originals', '*.pdf'))):
        ex = B.Exam(os.path.abspath(p), work)
        exams[ex.key] = ex
    _, items = B.parse_variant(os.path.join(HERE, 'variant_변형본.pdf'), work)
    by_sid = {re.sub(r'\s+', '', ' '.join(it['title'].split()[:2])): it for it in items}

    blocks = [('guide',) + (guide,) + tuple(x * 72 / 300.0 for x in B.gray_of(guide)[:2])]
    pt = lambda p: tuple(x * 72 / 300.0 for x in B.gray_of(p)[:2])
    for si, (hp, parts, qitems) in enumerate(sets):
        cut = []
        for s in parts:
            yy, mm, qa, qb = by_sid[s]['src']
            ex = exams[(yy, mm)]
            png, w, h, _, unit = B.cut_passage(ex, ex.passage_boxes(qa, qb), work, f'm{si}_{s}', None)
            cut.append((png, unit))
        if len(cut) > 1:
            png, w, h, _, _ = C.combo_passage(cut, work, f'm{si}')
        blocks.append(('head', hp) + pt(hp))
        blocks.append(('passage', png, w, h))
        for _, _, qp in qitems:
            blocks.append(('q', qp) + pt(qp))
        print(f'세트 {si + 1}: {"+".join(parts)} · 문항 {len(qitems)}개')
    pages = flow(blocks)
    total = len(pages)
    out = [f'<!doctype html><meta charset="utf-8"><style>{font_css()}{PAGE_CSS}</style>']
    for i, items_ in enumerate(pages):
        out.append(page_html(i + 1, total, items_, EXAM['title'], EXAM['footer'], first=i == 0, last=i == total - 1))
    out.append(key_html(key, EXAM['title']))
    hp = os.path.join(work, 'exam.html')
    with open(hp, 'w', encoding='utf8') as f:
        f.write('\n'.join(out))
    js = os.path.join(work, 'render.js')
    with open(js, 'w') as f:
        f.write(B.RENDER_JS)
    B.run(['node', js, hp, os.path.abspath(a.out)])
    print(f'총 {total}쪽 + 정답표 → {os.path.abspath(a.out)}')
    print('정답:', ' '.join(f'{k}){v}' for k, v in key))


if __name__ == '__main__':
    main()
