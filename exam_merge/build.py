#!/usr/bin/env python3
"""변형본 PDF의 각 지문 문제 페이지에 학력평가 원문 지문을 끼워 넣어 A4 PDF로 다시 만든다.

사용법
  python3 exam_merge/build.py --variant 변형본.pdf --orig-dir 원본시험지폴더 --out 결과.pdf
  python3 exam_merge/build.py ... --only 인문08,과학05      # 일부 지문만(시험용)
  python3 exam_merge/build.py ... --work /tmp/work          # 중간 파일 위치(기본: 임시폴더)

동작
  1) 변형본의 각 문제 페이지에서 "2023년 6월 고2 21-25번" 같은 출처 줄을 읽는다.
  2) 원본 폴더의 시험지 중 "2023학년도 6월"인 것을 찾고, 그 안에서 "[21 ~ 25]" 발문을 찾는다.
  3) 발문 다음에 나오는 지문 박스(들)를 그림에서 찾아 잘라 낸다(발문 줄은 제외).
  4) 변형본에서 문제를 번호별로 잘라 낸다(표시어 박스·출처 줄은 쓰지 않는다).
  5) A4 한 쪽의 왼쪽 단에 지문, 오른쪽 단에 문제를 쌓고, 넘치는 문제는 다음 쪽(2단)으로 넘긴다.
  6) 쪽 번호를 새로 매기고 색인 쪽(2쪽)의 "문제" 쪽수·"원문 PDF" 열을 고친다.

필요한 도구: poppler(pdftotext, pdftoppm), ImageMagick(convert), node + playwright(chromium).
원본 시험지를 못 찾은 지문은 변형본 쪽을 그대로 두고 요약에 MISSING으로 표시한다.
"""
import argparse
import glob
import html
import os
import re
import shutil
import subprocess
import sys
import tempfile

A4W, A4H = 595.28, 841.89
BOTTOM = 796.0          # 본문 아래 끝(바닥글 선 위)
TOP1, TOPN = 78.0, 56.0  # 1쪽 / 이어지는 쪽 본문 위 끝
GAP_Q = 48.0             # 문제 사이 간격
GAP_P = 8.0              # 지문 조각 사이 간격
COLX = (30.0, 306.0)     # 왼쪽/오른쪽 단 x
COLW = 262.0
QX = (29.0, 304.0)       # 문제 그림 x (변형본 좌표와 동일)
MIN_SCALE = 0.62         # 지문을 왼쪽 단에 한 덩어리로 넣을 때 허용하는 최소 배율
TILDE = '~～∼〜'


def run(cmd, **kw):
    return subprocess.run(cmd, check=True, capture_output=True, **kw)


# ---------------------------------------------------------------- pdf 텍스트
def bbox_pages(pdf, first=None, last=None):
    """[{w,h,lines:[{x0,y0,x1,y1,text,first_x}]}] (쪽별)"""
    cmd = ['pdftotext', '-bbox-layout']
    if first:
        cmd += ['-f', str(first)]
    if last:
        cmd += ['-l', str(last)]
    s = run(cmd + [pdf, '-']).stdout.decode('utf8')
    pages = []
    for pm in re.finditer(r'<page width="([\d.]+)" height="([\d.]+)">(.*?)</page>', s, re.S):
        lines = []
        for lm in re.finditer(r'<line xMin="([\d.]+)" yMin="([\d.]+)" xMax="([\d.]+)" yMax="([\d.]+)">(.*?)</line>',
                              pm.group(3), re.S):
            words = re.findall(r'<word xMin="([\d.]+)"[^>]*>([^<]*)</word>', lm.group(5))
            if not words:
                continue
            lines.append(dict(x0=float(lm.group(1)), y0=float(lm.group(2)), x1=float(lm.group(3)),
                              y1=float(lm.group(4)),
                              text=html.unescape(' '.join(w[1] for w in words)),
                              first=html.unescape(words[0][1])))
        pages.append(dict(w=float(pm.group(1)), h=float(pm.group(2)), lines=lines))
    return pages


def words_of_page(pdf, page):
    s = run(['pdftotext', '-bbox', '-f', str(page), '-l', str(page), pdf, '-']).stdout.decode('utf8')
    return [dict(x0=float(a), y0=float(b), x1=float(c), y1=float(d), t=html.unescape(t))
            for a, b, c, d, t in re.findall(
                r'<word xMin="([\d.]+)" yMin="([\d.]+)" xMax="([\d.]+)" yMax="([\d.]+)">([^<]*)</word>', s)]


# ---------------------------------------------------------------- 화상 도구
def read_pgm(path):
    with open(path, 'rb') as f:
        data = f.read()
    m = re.match(rb'P5\s+(\d+)\s+(\d+)\s+(\d+)\s', data)
    w, h = int(m.group(1)), int(m.group(2))
    return w, h, data[m.end():]


def render_gray_pgm(pdf, page, dpi, out_root):
    run(['pdftoppm', '-singlefile', '-r', str(dpi), '-gray', '-f', str(page), '-l', str(page), pdf, out_root])
    return read_pgm(out_root + '.pgm')


def render_png(pdf, page, dpi, out_root, gray=True):
    cmd = ['pdftoppm', '-singlefile', '-png', '-r', str(dpi), '-f', str(page), '-l', str(page)]
    if gray:
        cmd.append('-gray')
    run(cmd + [pdf, out_root])
    return out_root + '.png'


def crop_png(src, dpi, x0, y0, x1, y1, out):
    """pt 좌표로 자르기"""
    k = dpi / 72.0
    px, py = int(round(x0 * k)), int(round(y0 * k))
    pw, ph = int(round((x1 - x0) * k)), int(round((y1 - y0) * k))
    run(['convert', src, '-crop', f'{pw}x{ph}+{px}+{py}', '+repage', '-colors', '16', '-depth', '4', out])
    return pw / k, ph / k


# ---------------------------------------------------------------- 원본 시험지 분석
def find_boxes(w, h, data, dpi=100):
    """긴 가로선 쌍으로 이루어진 큰 테두리 상자를 찾는다. 반환: [(x0,y0,x1,y1)] (pt)"""
    segs = []
    pat = re.compile(rb'[\x00-\x80]{%d,}' % int(2.8 * dpi))
    for y in range(h):
        row = data[y * w:(y + 1) * w]
        for m in pat.finditer(row):
            segs.append([y, y, m.start(), m.end()])
    # 가까운 줄 합치기
    merged = []
    for s in segs:
        for m in merged:
            if s[0] - m[1] <= 3 and abs(s[2] - m[2]) <= 5 and abs(s[3] - m[3]) <= 5:
                m[1] = s[1]
                break
        else:
            merged.append(s)

    def edge_ok(xa, xb, ya, yb):
        ok = n = 0
        for y in range(ya, yb, 3):
            row = data[y * w + xa - 1: y * w + xa + 4]
            row2 = data[y * w + xb - 4: y * w + xb + 1]
            n += 1
            if row and min(row) < 140 and row2 and min(row2) < 140:
                ok += 1
        return n and ok / n >= 0.85

    boxes = []
    used = set()
    merged.sort(key=lambda s: s[0])
    for i, a in enumerate(merged):
        if i in used:
            continue
        best = None
        for j in range(i + 1, len(merged)):
            b = merged[j]
            if abs(b[2] - a[2]) > 6 or abs(b[3] - a[3]) > 6 or b[0] - a[1] < 30:
                continue
            if edge_ok(a[2], a[3], a[1], b[0]):
                best = j
        if best is not None:
            b = merged[best]
            for k in range(i, best + 1):
                used.add(k)
            f = 72.0 / dpi
            boxes.append((a[2] * f, a[0] * f, a[3] * f, b[1] * f))
    return boxes


class Exam:
    def __init__(self, path, work):
        self.path = path
        self.work = work
        first = bbox_pages(path, 1, 1)[0]
        m = re.search(r'(\d{4})\s*학년도\s*(\d{1,2})\s*월', ' '.join(l['text'] for l in first['lines']))
        self.key = (int(m.group(1)), int(m.group(2))) if m else None
        self._events = None
        self._pages = None

    def pages(self):
        if self._pages is None:
            self._pages = bbox_pages(self.path)
        return self._pages

    def events(self):
        """읽는 순서(쪽→단→y)로 정렬된 H(발문)/Q(문항)/B(상자) 사건"""
        if self._events is not None:
            return self._events
        ev = []
        base = os.path.join(self.work, 'det_' + os.path.basename(self.path)[:-4])
        for pi, pg in enumerate(self.pages(), 1):
            w, h, data = render_gray_pgm(self.path, pi, 100, f'{base}_{pi}')
            boxes = find_boxes(w, h, data)
            inner = lambda b, o: o is not b and o[0] >= b[0] - 3 and o[2] <= b[2] + 3 and o[1] >= b[1] - 3 and o[3] <= b[3] + 3
            boxes = [b for b in boxes if not any(inner(o, b) for o in boxes)]
            col = lambda x: 0 if x < pg['w'] / 2 else 1
            for b in boxes:
                ev.append(((pi, col((b[0] + b[2]) / 2), b[1]), 'B', dict(page=pi, box=b)))
            for ln in pg['lines']:
                cx = col(ln['x0'])
                m = re.search(r'\[\s*(\d+)\s*[%s]\s*(\d+)\s*\]' % TILDE, ln['text'])
                if m:
                    ev.append(((pi, cx, ln['y0']), 'H', dict(a=int(m.group(1)), b=int(m.group(2)), page=pi)))
                elif re.fullmatch(r'\d{1,2}\.', ln['first']) and not any(
                        b[0] <= ln['x0'] <= b[2] and b[1] <= ln['y0'] <= b[3] for b in boxes):
                    ev.append(((pi, cx, ln['y0']), 'Q', dict(page=pi)))
        ev.sort(key=lambda e: e[0])
        self._events = ev
        return ev

    def passage_boxes(self, a, b):
        ev = self.events()
        for i, (_, kind, d) in enumerate(ev):
            if kind == 'H' and d['a'] == a and d['b'] == b:
                got = []
                for _, k2, d2 in ev[i + 1:]:
                    if k2 != 'B':
                        break
                    got.append((d2['page'], d2['box']))
                return got
        return None


def cut_passage(exam, boxes, work, tag):
    """지문 상자들을 잘라 한 장으로 이어 붙인다. 반환 (png, w_pt, h_pt)"""
    parts = []
    for n, (pg, (x0, y0, x1, y1)) in enumerate(boxes):
        src = render_png(exam.path, pg, 220, os.path.join(work, f'o_{tag}_{pg}'))
        out = os.path.join(work, f'p_{tag}_{n}.png')
        crop_png(src, 220, x0 - 1, y0 - 1, x1 + 2, y1 + 2, out)
        parts.append(out)
    out = os.path.join(work, f'passage_{tag}.png')
    if len(parts) == 1:
        shutil.copy(parts[0], out)
    else:
        run(['convert'] + parts + ['-background', 'white', '-gravity', 'NorthWest', '-append', out])

    def dims(p):
        size = run(['identify', '-format', '%w %h', p]).stdout.decode().split()
        return int(size[0]) * 72 / 220.0, int(size[1]) * 72 / 220.0
    w, h = dims(out)
    return out, w, h, [(p,) + dims(p) for p in parts]


# ---------------------------------------------------------------- 변형본 분석
def parse_variant(var, work):
    pages = bbox_pages(var)
    items = []
    for pi, pg in enumerate(pages, 1):
        src = title = None
        for ln in pg['lines']:
            m = re.search(r'(\d{4})년\s*(\d{1,2})월\s*고2\s*(\d+)-(\d+)번', ln['text'])
            if m and ln['y0'] < 100:
                src = tuple(int(x) for x in m.groups())
            if 50 < ln['y0'] < 75 and ln['x0'] < 40 and not title:
                title = ln['text']
        if src and title:
            items.append(dict(page=pi, src=src, title=title, lines=pg['lines']))
    return pages, items


def question_blocks(item, var, work):
    """문제 번호별로 [(num, png, w, h)] (번호순)"""
    lines = item['lines']
    qs = []
    for ln in lines:
        if ln['y0'] > 120 and ln['y0'] < 790 and re.fullmatch(r'\d{1,2}\.', ln['first']) and (
                abs(ln['x0'] - 30.0) < 4 or abs(ln['x0'] - 306.6) < 4):
            qs.append(ln)
    w, h, data = render_gray_pgm(var, item['page'], 100, os.path.join(work, f'vd_{item["page"]}'))
    k = 100 / 72.0
    png = render_png(var, item['page'], 300, os.path.join(work, f'v_{item["page"]}'))
    out = []
    for q in qs:
        left = q['x0'] < 100
        xa, xb = (29.0, 293.0) if left else (304.0, 567.0)
        nxt = [o['y0'] for o in qs if (o['x0'] < 100) == left and o['y0'] > q['y0'] + 1]
        ya = q['y0'] - 3.0
        yb = (min(nxt) - 4.0) if nxt else 797.0
        # 아래 흰 줄 제거
        px0, px1 = int(xa * k), int(xb * k)
        y = int(yb * k)
        while y > int(ya * k):
            row = data[y * w + px0: y * w + px1]
            if row and min(row) < 200:
                break
            y -= 1
        yb = min(yb, (y + 1) / k + 3.0)
        num = int(q['first'][:-1])
        f = os.path.join(work, f'q_{item["page"]}_{num}.png')
        wq, hq = crop_png(png, 300, xa, ya, xb, yb, f)
        out.append((num, f, wq, hq))
    out.sort()
    return out


# ---------------------------------------------------------------- 배치
def layout(passage, questions):
    """passage=(png,w,h), questions=[(num,png,w,h)] → 쪽 목록. 쪽=list of (png,x,y,w,h)"""
    pages = [[]]
    page_top = lambda p: TOP1 if p == 0 else TOPN
    pw, ph = passage[1], passage[2]
    parts = passage[3]
    s_one = min(COLW / pw, (BOTTOM - TOP1 - 4) / ph)
    state = dict(p=0, c=0, y=TOP1)
    mode = 'side'
    if s_one >= MIN_SCALE:
        w, h = pw * s_one, ph * s_one
        pages[0].append((passage[0], COLX[0], TOP1, w, h))
        state.update(c=1, y=TOP1)
    else:
        mode = 'flow'

    def place(png, w, h, gap):
        scale = 1.0
        avail = BOTTOM - page_top(state['p'])
        if h > avail:
            scale = avail / h
        w, h = w * scale, h * scale
        if state['y'] + h > BOTTOM + 0.5 and state['y'] > page_top(state['p']) + 0.1:
            if state['c'] == 0:
                state['c'] = 1
            else:
                state['c'] = 0
                state['p'] += 1
                pages.append([])
            state['y'] = page_top(state['p'])
        pages[state['p']].append((png, QX[state['c']], state['y'], w, h))
        state['y'] += h + gap

    if mode == 'flow':
        for png, w, h in parts:   # 지문 상자를 한 개씩 단에 흘려 넣는다
            k = COLW / w
            place(png, w * k, h * k, GAP_P)
        state['y'] += GAP_Q - GAP_P
    for num, png, w, h in questions:
        place(png, w, h, GAP_Q)
    return pages, mode, (s_one if mode == 'side' else COLW / pw)


# ---------------------------------------------------------------- HTML 작성
CSS = '''@page{size:A4;margin:0}html,body{margin:0;padding:0;background:#fff}
.pg{position:relative;width:%(w)spt;height:%(h)spt;overflow:hidden;page-break-after:always}
.pg img,.pg div{position:absolute}
.n{font:9pt/1 "DejaVu Sans","Liberation Sans",sans-serif;text-align:right;color:#111}
.t{font:7.6pt/1 "DejaVu Sans","WenQuanYi Zen Hei",sans-serif;color:#111;white-space:nowrap}
''' % dict(w=A4W, h=A4H)


def img(png, x, y, w, h):
    return f'<img src="file://{png}" style="left:{x:.2f}pt;top:{y:.2f}pt;width:{w:.2f}pt;height:{h:.2f}pt">'


def rect(x0, y0, x1, y1, color='#fff'):
    return (f'<div style="left:{x0:.2f}pt;top:{y0:.2f}pt;width:{x1 - x0:.2f}pt;height:{y1 - y0:.2f}pt;'
            f'background:{color}"></div>')


def pagenum(n, total):
    return rect(534, 15.5, 568, 31.5) + f'<div class="n" style="right:{A4W - 565.3:.2f}pt;top:18pt">{n}/{total}</div>'


def build_html(plan, total, hdr, ftr, title_png):
    """plan: 항목별 {'kind':'passage'|'asis'|'raw', ...}"""
    out = [f'<!doctype html><meta charset="utf-8"><style>{CSS}</style>']
    n = 0
    for e in plan:
        if e['kind'] == 'raw':       # 표지·색인
            n += 1
            out.append(f'<div class="pg">{img(e["png"], 0, 0, A4W, A4H)}{e.get("extra", "")}</div>')
            continue
        if e['kind'] == 'asis':      # 원본을 못 찾은 지문: 변형본 쪽 그대로
            n += 1
            out.append(f'<div class="pg">{img(e["png"], 0, 0, A4W, A4H)}{pagenum(n, total)}</div>')
            continue
        for pi, items in enumerate(e['pages']):
            n += 1
            body = img(hdr, 0, 0, A4W, 42) + img(ftr, 0, 797, A4W, A4H - 797) + pagenum(n, total)
            top = TOP1 if pi == 0 else TOPN
            if pi == 0:
                body += img(title_png[e['page']], 28, 52, 539, 22)
            body += f'<div style="left:297.4pt;top:{top - 2:.1f}pt;height:{BOTTOM - top - 2:.1f}pt;border-left:0.35pt solid #000"></div>'
            for png, x, y, w, h in items:
                body += img(png, x, y, w, h)
            out.append(f'<div class="pg">{body}</div>')
    return '\n'.join(out)


RENDER_JS = r'''
const path=require('path');
let pw;
for (const p of [process.env.PLAYWRIGHT_PATH, '/opt/node22/lib/node_modules/playwright', 'playwright']) {
  if (!p) continue; try { pw = require(p); break; } catch (e) {}
}
(async () => {
  const b = await pw.chromium.launch();
  const pg = await b.newPage();
  await pg.goto('file://' + path.resolve(process.argv[2]));
  await pg.pdf({path: process.argv[3], preferCSSPageSize: true, printBackground: true});
  await b.close();
})();
'''


# ---------------------------------------------------------------- 메인
def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--variant', required=True)
    ap.add_argument('--orig-dir', required=True)
    ap.add_argument('--out', required=True)
    ap.add_argument('--only', help='지문 번호 목록 예: 인문08,과학05')
    ap.add_argument('--work')
    a = ap.parse_args()
    work = os.path.abspath(a.work or tempfile.mkdtemp(prefix='exam_merge_'))
    os.makedirs(work, exist_ok=True)
    var = os.path.abspath(a.variant)

    exams = {}
    for p in sorted(glob.glob(os.path.join(a.orig_dir, '**', '*.pdf'), recursive=True)):
        try:
            ex = Exam(os.path.abspath(p), work)
        except Exception as e:  # noqa
            print('건너뜀(읽기 실패):', p, e, file=sys.stderr)
            continue
        if ex.key:
            exams[ex.key] = ex
            print(f'원본 시험지: {os.path.basename(p)} → {ex.key[0]}학년도 {ex.key[1]}월')
        else:
            print('건너뜀(학년도·월을 못 찾음):', os.path.basename(p), file=sys.stderr)

    vpages, items = parse_variant(var, work)
    only = set(x.strip() for x in a.only.split(',')) if a.only else None
    sid = lambda it: re.sub(r'\s+', '', ' '.join(it['title'].split()[:2]))
    if only:
        items = [it for it in items if sid(it) in only]

    # 머리글·바닥글·제목 그림
    first_png = render_png(var, items[0]['page'], 300, os.path.join(work, 'hf'))
    hdr = os.path.join(work, 'hdr.png')
    ftr = os.path.join(work, 'ftr.png')
    crop_png(first_png, 300, 0, 0, A4W, 42, hdr)
    crop_png(first_png, 300, 0, 797, A4W, A4H, ftr)
    title_png = {}

    plan = []
    report = []
    exam_cache = {}
    for it in items:
        s = sid(it)
        tp = os.path.join(work, f'title_{it["page"]}.png')
        vp = render_png(var, it['page'], 300, os.path.join(work, f'v_{it["page"]}'))
        crop_png(vp, 300, 28, 52, 567, 74, tp)
        title_png[it['page']] = tp
        yy, mm, qa, qb = it['src']
        ex = exams.get((yy, mm))
        if not ex:
            plan.append(dict(kind='asis', png=render_png(var, it['page'], 200, os.path.join(work, f'asis_{it["page"]}')),
                             page=it['page'], sid=s))
            report.append((s, f'MISSING 원본 시험지 없음({yy}학년도 {mm}월)'))
            continue
        boxes = ex.passage_boxes(qa, qb)
        if not boxes:
            plan.append(dict(kind='asis', png=render_png(var, it['page'], 200, os.path.join(work, f'asis_{it["page"]}')),
                             page=it['page'], sid=s))
            report.append((s, f'FAIL 발문 [{qa}~{qb}] 또는 지문 상자를 못 찾음'))
            continue
        passage = cut_passage(ex, boxes, work, s)
        qs = question_blocks(it, var, work)
        if not qs:
            report.append((s, 'FAIL 문제를 못 찾음'))
            continue
        pages, mode, scale = layout(passage, qs)
        plan.append(dict(kind='passage', pages=pages, page=it['page'], sid=s))
        report.append((s, f'OK 문제 {len(qs)}개 · 지문 상자 {len(boxes)}개 · {mode} 배율 {scale:.2f} · {len(pages)}쪽'))

    # 표지·색인(원본 변형본 1~2쪽)은 전체를 만들 때만 포함
    front = []
    if not only:
        front = [dict(kind='raw', png=render_png(var, 1, 200, os.path.join(work, 'cover')))]
        front.append(dict(kind='raw', png=render_png(var, 2, 200, os.path.join(work, 'index')), index=True))
    plan = front + plan

    total = sum(1 if e['kind'] != 'passage' else len(e['pages']) for e in plan)
    # 색인 쪽 고치기
    if front:
        start = {}
        n = len(front)
        for e in plan[len(front):]:
            start[e['page']] = n + 1
            n += 1 if e['kind'] != 'passage' else len(e['pages'])
        words = words_of_page(var, 2)
        hdr_q = next(w for w in words if w['t'] == '문제' and w['y0'] > 80)
        hdr_o = next(w for w in words if w['t'] == '원문' and w['y0'] > 80)
        extra = ''
        extra += rect(hdr_o['x0'] - 1, hdr_o['y0'] - 1.5, 564.2, hdr_o['y1'] + 1.5)
        extra += f'<div class="t" style="left:{hdr_o["x0"]:.1f}pt;top:{hdr_o["y0"]:.1f}pt;font-weight:bold">출처</div>'
        rows = sorted([w for w in words if re.fullmatch(r'\d+쪽', w['t']) and abs(w['x0'] - hdr_q['x0']) < 3],
                      key=lambda w: w['y0'])
        order = [it for it in parse_variant(var, work)[1]]
        for w, it in zip(rows, order):
            extra += rect(w['x0'] - 1, w['y0'] - 1.5, w['x0'] + 40, w['y1'] + 1.5)
            pnum = start.get(it['page'])
            extra += f'<div class="t" style="left:{w["x0"]:.1f}pt;top:{w["y0"]:.1f}pt">{pnum}쪽</div>'
            extra += rect(hdr_o['x0'] - 1, w['y0'] - 1.5, 564.2, w['y1'] + 1.5)
            y, m, qa, qb = it['src']
            extra += (f'<div class="t" style="left:{hdr_o["x0"]:.1f}pt;top:{w["y0"]:.1f}pt">'
                      f"’{y % 100}.{m}월 {qa}-{qb}번</div>")
        plan[1]['extra'] = extra
        # 색인 쪽에는 쪽 번호 갱신
        plan[1]['extra'] += pagenum(2, total)
        plan[0]['extra'] = pagenum(1, total)

    html_path = os.path.join(work, 'out.html')
    with open(html_path, 'w', encoding='utf8') as f:
        f.write(build_html(plan, total, hdr, ftr, title_png))
    js = os.path.join(work, 'render.js')
    with open(js, 'w') as f:
        f.write(RENDER_JS)
    out = os.path.abspath(a.out)
    run(['node', js, html_path, out])
    print()
    for s, msg in report:
        print(f'{s:8s} {msg}')
    need = sorted({(it['src'][0], it['src'][1]) for it in items if (it['src'][0], it['src'][1]) not in exams})
    if need:
        print('\n더 필요한 원본 시험지: ' + ', '.join(f'{y}학년도 {m}월 고2' for y, m in need))
    print(f'\n총 {total}쪽 → {out}  (작업 폴더: {work})')


if __name__ == '__main__':
    main()
