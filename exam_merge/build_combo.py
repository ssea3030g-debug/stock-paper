#!/usr/bin/env python3
"""여러 지문을 (가)(나)(다)로 묶은 고난도 세트를 A4 PDF로 만든다.

  python3 exam_merge/build_combo.py --out 고난도_세트.pdf [--only 고난도01]

combo_sets.json  {"고난도01": {"title": "...", "parts": ["사회01", "사회07", "사회08"]}, ...}
문항은 custom_questions/<세트>/q*.json → render_custom.py로 만든 q*.png를 쓴다(정답은 json의 answer).
지문 그림·머리글·배치는 build.py와 같다. 각 지문 위에 (가)(나)(다)를 붙여 하나로 이어 붙인다.
"""
import argparse
import glob
import json
import os
import re
import tempfile

import build as B

HERE = os.path.dirname(os.path.abspath(__file__))
LABELS = '가나다라마'
TITLE_FONT = os.path.join(HERE, 'fonts', 'NanumGothic-Bold.ttf')
LABEL_FONT = os.path.join(HERE, 'fonts', 'NanumMyeongjo-Bold.ttf')


def combo_passage(parts, work, tag):
    """각 지문 그림을 같은 폭으로 맞추고 위에 (가)(나)… 표시를 붙여 세로로 잇는다 → build.cut_passage와 같은 형식"""
    pngs, units = [], []
    for png, unit in parts:
        pngs.append(png)
        units.append(unit)
    W = max(B.gray_of(p)[0] for p in pngs)
    seq = []
    for i, p in enumerate(pngs):
        q = os.path.join(work, f'cp_{tag}_{i}.png')
        B.run(['convert', p, '+repage', '-resize', f'{W}x', q])
        lab = os.path.join(work, f'cl_{tag}_{i}.png')
        B.run(['convert', '-size', f'{W}x70', 'xc:white', '-font', LABEL_FONT, '-pointsize', '40',
               '-fill', 'black', '-gravity', 'SouthWest', '-annotate', '+6+8', f'({LABELS[i]})', lab])
        if i:
            gap = os.path.join(work, f'cg_{tag}_{i}.png')
            B.run(['convert', '-size', f'{W}x30', 'xc:white', gap])
            seq.append(gap)
        seq += [lab, q]
    out = os.path.join(work, f'combo_{tag}.png')
    B.run(['convert'] + seq + ['-background', 'white', '-append', out])
    w, h, _ = B.gray_of(out)
    w, h = w * 72 / 220.0, h * 72 / 220.0
    return out, w, h, [(out, w, h)], sum(units) / len(units)


def title_png(text, work, tag):
    out = os.path.join(work, f'ctitle_{tag}.png')
    B.run(['convert', '-size', '2246x92', 'xc:white', '-font', TITLE_FONT, '-pointsize', '58', '-fill', 'black',
           '-gravity', 'West', '-annotate', '+12+0', text, out])
    return out


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--variant', default=os.path.join(HERE, 'variant_변형본.pdf'))
    ap.add_argument('--orig-dir', default=os.path.join(HERE, 'originals'))
    ap.add_argument('--sets', default=os.path.join(HERE, 'combo_sets.json'))
    ap.add_argument('--out', required=True)
    ap.add_argument('--only')
    ap.add_argument('--work')
    a = ap.parse_args()
    work = os.path.abspath(a.work or tempfile.mkdtemp(prefix='exam_combo_'))
    os.makedirs(work, exist_ok=True)
    var = os.path.abspath(a.variant)
    with open(a.sets, encoding='utf8') as f:
        sets = {k: v for k, v in json.load(f).items() if not k.startswith('_')}
    if a.only:
        sets = {k: v for k, v in sets.items() if k in a.only.split(',')}

    exams = {}
    for p in sorted(glob.glob(os.path.join(a.orig_dir, '*.pdf'))):
        ex = B.Exam(os.path.abspath(p), work)
        if ex.key:
            exams[ex.key] = ex
    _, items = B.parse_variant(var, work)
    sid = lambda it: re.sub(r'\s+', '', ' '.join(it['title'].split()[:2]))
    by_sid = {sid(it): it for it in items}

    first_png = B.render_png(var, items[0]['page'], 300, os.path.join(work, 'hf'))
    hdr, ftr = os.path.join(work, 'hdr.png'), os.path.join(work, 'ftr.png')
    B.crop_png(first_png, 300, 0, 0, B.A4W, 42, hdr)
    B.crop_png(first_png, 300, 0, 797, B.A4W, B.A4H, ftr)

    plan, titles = [], {}
    for n, (name, spec) in enumerate(sets.items()):
        parts = []
        for s in spec['parts']:
            it = by_sid[s]
            yy, mm, qa, qb = it['src']
            ex = exams[(yy, mm)]
            png, _, _, _, unit = B.cut_passage(ex, ex.passage_boxes(qa, qb), work, f'{name}_{s}', None)
            parts.append((png, unit))
        passage = combo_passage(parts, work, name)
        cdir = os.path.join(HERE, 'custom_questions', name)
        qs, ans = [], {}
        for p in sorted(glob.glob(os.path.join(cdir, 'q*.png')), key=lambda p: int(re.sub(r'\D', '', os.path.basename(p)))):
            k = int(re.sub(r'\D', '', os.path.basename(p)))
            cw, ch = B.gray_of(p)[:2]
            qs.append((k, p, 263.0, ch * 263.0 / cw))
            with open(p[:-4] + '.json', encoding='utf8') as f:
                ans[str(k)] = json.load(f).get('answer', '')
        titles[-1 - n] = title_png(spec['title'], work, name)
        pages, scale = B.layout(passage, qs)
        plan.append(dict(kind='passage', pages=pages, page=-1 - n, sid=name, ans=ans))
        print(f'{name}: {"+".join(spec["parts"])} · 문제 {len(qs)}개 · 지문 배율 {scale:.2f} · {len(pages)}쪽')

    total = sum(len(e['pages']) for e in plan)
    html_path = os.path.join(work, 'combo.html')
    with open(html_path, 'w', encoding='utf8') as f:
        f.write(B.build_html(plan, total, hdr, ftr, titles))
    js = os.path.join(work, 'render.js')
    with open(js, 'w') as f:
        f.write(B.RENDER_JS)
    B.run(['node', js, html_path, os.path.abspath(a.out)])
    print(f'총 {total}쪽 → {os.path.abspath(a.out)}')


if __name__ == '__main__':
    main()
