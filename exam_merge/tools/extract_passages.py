import sys, os, re, glob, json
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
import build as B
OUT = os.environ.get('OUT', '/tmp/passage_texts')
work = OUT + '/work'; os.makedirs(work, exist_ok=True)
exams = {}
for p in sorted(glob.glob(os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), 'originals', '*.pdf'))):
    e = B.Exam(os.path.abspath(p), work); exams[e.key] = e
pages, items = B.parse_variant(os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), 'variant_변형본.pdf'), work)
counts = {}
for it in items:
    sid = re.sub(r'\s+', '', ' '.join(it['title'].split()[:2]))
    yy, mm, qa, qb = it['src']
    ex = exams.get((yy, mm))
    nq = sum(1 for ln in it['lines'] if 120 < ln['y0'] < 790 and re.fullmatch(r'\d{1,2}\.', ln['first']) and (abs(ln['x0']-30) < 4 or abs(ln['x0']-306.6) < 4))
    counts[sid] = (it['title'], it['src'], nq)
    if not ex: print(sid, 'NO EXAM'); continue
    boxes = ex.passage_boxes(qa, qb)
    txt = []
    for pg, (x0, y0, x1, y1), _ in boxes:
        r = B.run(['pdftotext', '-f', str(pg), '-l', str(pg), '-x', str(int(x0)), '-y', str(int(y0)), '-W', str(int(x1-x0)+1), '-H', str(int(y1-y0)+1), '-layout', ex.path, '-']).stdout.decode()
        txt.append(r)
    open(f'{OUT}/{sid}.txt', 'w').write(f"# {it['title']} {it['src']}\n" + '\n'.join(txt))
    print(sid, it['title'], it['src'], nq, len(''.join(txt)))
