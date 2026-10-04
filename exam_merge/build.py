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
import json
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
    """세로 테두리 쌍으로 큰 상자를 찾는다(위·아래 가로줄이 없는 이어지는 상자 포함). 반환 [(x0,y0,x1,y1)] (pt)"""
    f = 72.0 / dpi
    pat = re.compile(rb'[\x00-\x80]{%d,}' % int(1.2 * dpi))
    runs = []  # [x, y0, y1]
    for x in range(w):
        col = data[x::w]
        for m in pat.finditer(col):
            runs.append([x, m.start(), m.end()])
    # 두꺼운 선(이웃한 x) 합치기
    lines = []
    for r in sorted(runs):           # 이웃한 x에서 겹치거나 이어지는 세로 조각은 한 선으로(살짝 기운 선 대응)
        for l in lines:
            if r[0] - l[0] <= 3 and r[1] <= l[2] + 4 and r[2] >= l[1] - 4:
                l[0] = r[0]
                l[1], l[2] = min(l[1], r[1]), max(l[2], r[2])
                break
        else:
            lines.append(list(r))
    wmin, wmax = 280 / f, 345 / f   # 상자 폭(pt 280~345)
    pairs = []
    for b in lines:                  # b = 오른쪽 변 후보
        for a in lines:
            ov = min(a[2], b[2]) - max(a[1], b[1])
            if (wmin <= b[0] - a[0] <= wmax and ov >= 0.8 * max(a[2] - a[1], b[2] - b[1])
                    and (abs(a[1] - b[1]) <= 10 or abs(a[2] - b[2]) <= 10)):
                pairs.append((b[0] - a[0], id(a), id(b), a, b))
    pairs.sort(key=lambda p: p[0])   # 폭이 좁은 쌍부터(단 구분선과 짝지어지는 것 방지)
    used_a, used_b, boxes = set(), set(), []
    for _, ia, ib, a, b in pairs:
        if ia in used_a or ib in used_b:
            continue
        used_a.add(ia)
        used_b.add(ib)
        boxes.append((a[0] * f, min(a[1], b[1]) * f, b[0] * f, max(a[2], b[2]) * f))
    # 중복 제거
    out = []
    for bx in boxes:
        if not any(abs(bx[0] - o[0]) < 4 and abs(bx[1] - o[1]) < 6 and abs(bx[3] - o[3]) < 6 for o in out):
            out.append(bx)
    return out


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
            col = lambda x: 0 if x < pg['w'] * 0.48 else 1
            for b in boxes:
                ev.append(((pi, col((b[0] + b[2]) / 2), b[1]), 'B', dict(page=pi, box=b)))
            for ln in pg['lines']:
                cx = col(ln['x0'])
                m = re.search(r'\[\s*(\d+)\s*[%s]\s*(\d+)\s*\]' % TILDE, ln['text'])
                if m:
                    ev.append(((pi, cx, ln['y0']), 'H', dict(a=int(m.group(1)), b=int(m.group(2)), page=pi)))
                elif re.fullmatch(r'\d{1,2}\.', ln['first']) and not any(
                        b[0] <= ln['x0'] <= b[2] and b[1] - 4 <= ln['y0'] <= b[3] for b in boxes):
                    ev.append(((pi, cx, ln['y0']), 'Q', dict(page=pi)))
        ev.sort(key=lambda e: e[0])
        self._events = ev
        return ev

    def passage_boxes(self, a, b):
        """[(쪽, (x0,y0,x1,y1), 테두리없음)] — 상자가 있으면 상자, 없으면(테두리 없는 시험지) 글줄 묶음을 쓴다"""
        ev = self.events()
        for i, (key, kind, d) in enumerate(ev):
            if kind == 'H' and d['a'] == a and d['b'] == b:
                got = []
                for _, k2, d2 in ev[i + 1:]:
                    if k2 != 'B':
                        break
                    got.append((d2['page'], d2['box'], False))
                if got:   # 상자 바로 아래 각주(* …)도 지문에 포함
                    pg, (x0, y0, x1, y1), _ = got[-1]
                    for ln in self.pages()[pg - 1]['lines']:
                        if (ln['text'].lstrip()[:1] in '*※' and x0 - 5 <= ln['x0'] <= x1
                                and y1 - 2 <= ln['y0'] <= y1 + 45):
                            y1 = max(y1, ln['y1'] + 2)
                    got[-1] = (pg, (x0, y0, x1, y1), False)
                return got or self._unboxed(key, a, b)
        return None

    def _unboxed(self, hkey, a, b):
        """발문 다음부터 첫 문항(또는 다음 발문) 앞까지의 글줄을 단별로 묶어 영역으로 만든다"""
        rows = []
        for pi, pg in enumerate(self.pages(), 1):
            for ln in pg['lines']:
                col = 0 if ln['x0'] < pg['w'] * 0.48 else 1
                rows.append(((pi, col, ln['y0']), pi, col, ln))
        rows.sort(key=lambda r: r[0])
        segs, cur = [], None
        started = False
        for key, pi, col, ln in rows:
            if not started:
                if key == hkey and re.search(r'\[\s*%d\s*[%s]\s*%d\s*\]' % (a, TILDE, b), ln['text']):
                    started = True
                continue
            ph = self.pages()[pi - 1]['h']
            if (ln['y0'] < 0.095 * ph or ln['y0'] > 0.93 * ph      # 쪽 머리글·바닥글
                    or ln['text'].strip() in ('국어 영역', '고2')
                    or re.fullmatch(r'[\d\s/]+', ln['text'])):
                continue
            if re.fullmatch(r'\d{1,2}\.', ln['first']) or re.search(r'\[\s*\d+\s*[%s]\s*\d+\s*\]' % TILDE, ln['text']):
                break
            if cur and cur['page'] == pi and cur['col'] == col:
                cur['x0'] = min(cur['x0'], ln['x0'])
                cur['x1'] = max(cur['x1'], ln['x1'])
                cur['y1'] = ln['y1']
            else:
                cur = dict(page=pi, col=col, x0=ln['x0'], x1=ln['x1'], y0=ln['y0'], y1=ln['y1'])
                segs.append(cur)
        return [(s['page'], (s['x0'] - 3, s['y0'] - 1.5, s['x1'] + 3, s['y1'] + 1), True) for s in segs]


def gray_of(png):
    w, h = (int(v) for v in run(['identify', '-format', '%w %h', png]).stdout.decode().split())
    return w, h, run(['convert', png, '-colorspace', 'gray', '-depth', '8', 'gray:-']).stdout


def strip_hborder(png, top, bottom):
    """상자 위/아래 가로 테두리 줄을 지워(잘라) 이어진 상자처럼 만든다"""
    w, h, d = gray_of(png)
    dark = lambda y: sum(1 for v in d[y * w:(y + 1) * w:4] if v < 128) > (w // 4) * 0.5
    y0, y1 = 0, h
    if top:
        for y in range(min(14, h)):
            if dark(y):
                y0 = y + 1
    if bottom:
        for y in range(h - 1, max(h - 15, 0), -1):
            if dark(y):
                y1 = y
    if y0 or y1 < h:
        run(['convert', png, '-crop', f'{w}x{y1 - y0}+0+{y0}', '+repage', png])
    return y0


def find_phrase(words, phrase):
    """단어 목록(읽는 순서)에서 띄어쓰기를 무시하고 구절을 찾아 해당 단어들을 돌려준다"""
    key = re.sub(r'\s+', '', phrase)
    text, owner = '', []
    for i, w in enumerate(words):
        t = re.sub(r'\s+', '', w['t'])
        text += t
        owner += [i] * len(t)
    k = text.find(key)
    if k < 0:
        return None
    return [words[i] for i in sorted(set(owner[k:k + len(key)]))]


def cut_passage(exam, boxes, work, tag, marks=None):
    """지문 상자(또는 글줄 묶음)들을 잘라 이음매 없이 한 장으로 이어 붙인다.
    marks=[(표시, 구절)]이면 해당 구절에 밑줄을 긋고 왼쪽 여백에 (표시)를 적는다.
    반환 (png, w_pt, h_pt, [(png,w,h)], unit)"""
    K = 220 / 72.0
    parts, found = [], []      # found: (표시, 조각 번호, [(x0,x1,y_밑줄)] px)
    plain_all = all(b[2] for b in boxes)
    for n, (pg, (x0, y0, x1, y1), plain) in enumerate(boxes):
        src = render_png(exam.path, pg, 220, os.path.join(work, f'o_{tag}_{pg}'))
        out = os.path.join(work, f'p_{tag}_{n}.png')
        crop_png(src, 220, x0 - 1, y0 - 1, x1 + 2, y1 + 2, out)
        cut_top = 0
        if not plain:
            cut_top = strip_hborder(out, top=n > 0, bottom=n < len(boxes) - 1)
        for label, phrase in (marks or []):
            if any(f[0] == label for f in found):
                continue
            ws = [w for w in words_of_page(exam.path, pg)
                  if x0 <= (w['x0'] + w['x1']) / 2 <= x1 and y0 <= (w['y0'] + w['y1']) / 2 <= y1]
            hit = find_phrase(ws, phrase)
            if hit:
                lines = {}
                for w in hit:
                    lines.setdefault(round(w['y0'] / 4), []).append(w)
                segs = [((min(w['x0'] for w in ln) - (x0 - 1)) * K, (max(w['x1'] for w in ln) - (x0 - 1)) * K,
                         (max(w['y1'] for w in ln) - (y0 - 1)) * K + 2 - cut_top) for _, ln in sorted(lines.items())]
                found.append((label, n, segs))
        parts.append(out)
    out = os.path.join(work, f'passage_{tag}.png')
    if len(parts) == 1:
        shutil.copy(parts[0], out)
    else:
        run(['convert'] + parts + ['-background', 'white', '-gravity', 'North', '-append', out])
    bo = 0
    if plain_all:   # 테두리 없는 시험지: 다른 지문과 같게 얇은 테두리를 한 번 두른다
        run(['convert', out, '-bordercolor', 'white', '-border', '10', '-bordercolor', 'black', '-border', '2', out])
        bo = 12
    for label, phrase in (marks or []):
        if not any(f[0] == label for f in found):
            print(f'  경고: {tag} 표시어 ({label}) 구절을 원문에서 못 찾음: {phrase[:20]}…', file=sys.stderr)
    if found:       # 밑줄과 왼쪽 여백의 (표시)
        dims = [gray_of(p)[:2] for p in parts]
        wmax = max(d[0] for d in dims)
        margin = 70
        run(['convert', out, '-background', 'white', '-gravity', 'West', '-splice', f'{margin}x0', out])
        draw = []
        for label, n, segs in found:
            dx = (wmax - dims[n][0]) // 2 + bo + margin
            dy = sum(d[1] for d in dims[:n]) + bo
            for xa, xb, yu in segs:
                draw += ['-draw', f'rectangle {xa + dx:.0f},{yu + dy:.0f} {xb + dx:.0f},{yu + dy + 2:.0f}']
            draw += ['-draw', f"text 4,{segs[0][2] + dy - 4:.0f} '({label})'"]
        run(['convert', out, '-fill', 'black', '-font', 'DejaVu-Sans-Bold', '-pointsize', '30'] + draw + [out])
    w, h, _ = gray_of(out)
    w, h = w * 72 / 220.0, h * 72 / 220.0
    unit = exam.pages()[boxes[0][0] - 1]['w'] / 841.89   # A3 원본=1, A4 원본≈0.71 (글자 실제 크기 보정)
    return out, w, h, [(out, w, h)], unit


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
def split_png(png, cut_pt, h_pt, out_a, out_b):
    """그림을 위에서 cut_pt(출력 pt) 이하의 빈 줄에서 둘로 자른다(아래 조각 위쪽 빈 줄은 없앤다).
    반환 (위 조각 비율, 아래 조각 비율) 또는 None"""
    w, h, data = gray_of(png)
    k = h / h_pt
    xa, xb = int(w * 0.04), int(w * 0.96)       # 좌우 테두리는 빼고 본다
    rows = range(0, h, max(1, h // 200))
    edges = [x for x in range(w) if sum(1 for y in rows if data[y * w + x] < 128) > len(rows) * 0.8]
    if edges:                                     # 세로 테두리선 안쪽만 본다
        left = [x for x in edges if x < w / 2]
        right = [x for x in edges if x > w / 2]
        if left:
            xa = max(xa, max(left) + 3)
        if right:
            xb = min(xb, min(right) - 3)
    white = lambda y: min(data[y * w + xa: y * w + xb]) > 200
    y = min(int(cut_pt * k), h - 1)
    while y > 1 and not (white(y) and white(y - 1)):
        y -= 1
    if y < h * 0.05 or y * 1.0 / k < 40:
        return None
    yb = y
    while yb < h - 1 and white(yb):
        yb += 1
    yb = max(y, yb - int(4 * k))                 # 줄 위 여백 조금 남김
    run(['convert', png, '-crop', f'{w}x{y}+0+0', '+repage', out_a])
    run(['convert', png, '-crop', f'{w}x{h - yb}+0+{yb}', '+repage', out_b])
    return y / h, (h - yb) / h


def layout(passage, questions):
    """지문을 왼쪽 단 → 오른쪽 단 → 다음 쪽 순으로 흘려 넣고(단 끝에서는 줄 사이로 나눔),
    이어서 문제를 남은 자리부터 차례로 넣는다. 반환 (쪽 목록, 배율). 쪽=list of (png,x,y,w,h)"""
    png0, pw, ph, _, unit = passage
    k = COLW / pw
    if ph * k > BOTTOM - TOP1 and ph * k <= (BOTTOM - TOP1) * 1.1:   # 조금 넘치면 줄여서 한 단에
        k = (BOTTOM - TOP1) / ph
    top = lambda p: TOP1 if p == 0 else TOPN
    pages = [[]]
    st = dict(p=0, c=0, y=TOP1)

    def page(p):
        while len(pages) <= p:
            pages.append([])
        return pages[p]

    def next_col():
        if st['c'] == 0:
            st['c'] = 1
        else:
            st['c'], st['p'] = 0, st['p'] + 1
            page(st['p'])
        st['y'] = top(st['p'])

    # 지문
    png, w, h = png0, pw * k, ph * k
    n = 0
    while True:
        room = BOTTOM - st['y']
        if h <= room + 0.5:
            page(st['p']).append((png, COLX[st['c']], st['y'], w, h))
            st['y'] += h + GAP_Q
            break
        n += 1
        a, b = png[:-4] + f'_a{n}.png', png[:-4] + f'_b{n}.png'
        r = split_png(png, room, h, a, b) if room > 60 else None
        if r:
            page(st['p']).append((a, COLX[st['c']], st['y'], w, h * r[0]))
            png, h = b, h * r[1]
        elif st['y'] <= top(st['p']) + 0.1:      # 빈 단에서도 못 나누면 줄여서 넣는다(무한 반복 방지)
            sc = room / h
            page(st['p']).append((png, COLX[st['c']], st['y'], w * sc, h * sc))
            st['y'] += h * sc + GAP_Q
            break
        next_col()

    # 문제: 남은 자리에 차례로(들어갈 자리가 없으면 다음 단)
    for num, qpng, qw, qh in questions:
        while True:
            s = min(1.0, (BOTTOM - top(st['p'])) / qh)
            if st['y'] + qh * s <= BOTTOM + 0.5 or st['y'] <= top(st['p']) + 0.1:
                page(st['p']).append((qpng, QX[st['c']], st['y'], qw * s, qh * s))
                st['y'] += qh * s + GAP_Q
                break
            next_col()
    return pages, k * unit


# ---------------------------------------------------------------- HTML 작성
CSS = '''@page{size:A4;margin:0}html,body{margin:0;padding:0;background:#fff}
.pg{position:relative;width:%(w)spt;height:%(h)spt;overflow:hidden;page-break-after:always}
.pg img,.pg div{position:absolute}
.n{font:9pt/1 "DejaVu Sans","Liberation Sans",sans-serif;text-align:right;color:#111}
.ans{font:7.5pt/1 "DejaVu Sans","WenQuanYi Zen Hei",sans-serif;color:#222;white-space:nowrap;transform:rotate(180deg)}
.t{font:7.6pt/1 "DejaVu Sans","WenQuanYi Zen Hei",sans-serif;color:#111;white-space:nowrap}
''' % dict(w=A4W, h=A4H)


def img(png, x, y, w, h):
    return f'<img src="file://{png}" style="left:{x:.2f}pt;top:{y:.2f}pt;width:{w:.2f}pt;height:{h:.2f}pt">'


def rect(x0, y0, x1, y1, color='#fff'):
    return (f'<div style="left:{x0:.2f}pt;top:{y0:.2f}pt;width:{x1 - x0:.2f}pt;height:{y1 - y0:.2f}pt;'
            f'background:{color}"></div>')


def pagenum(n, total):
    return rect(534, 15.5, 568, 31.5) + f'<div class="n" style="right:{A4W - 565.3:.2f}pt;top:18pt">{n}/{total}</div>'


def answer_div(ans):
    """정답을 쪽 오른쪽 아래(바닥글 아래)에 가로로, 거꾸로(180° 회전) 적는다"""
    if not ans:
        return ''
    txt = '정답  ' + '  '.join(f'{k}. {v}' for k, v in sorted(ans.items(), key=lambda kv: int(kv[0])))
    return f'<div class="ans" style="right:{A4W - 565.3:.2f}pt;top:824pt">{html.escape(txt)}</div>'


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
            out.append(f'<div class="pg">{img(e["png"], 0, 0, A4W, A4H)}{pagenum(n, total)}{answer_div(e.get("ans"))}</div>')
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
            if pi == len(e['pages']) - 1:
                body += answer_div(e.get('ans'))
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
    ap.add_argument('--answers', default=os.path.join(os.path.dirname(os.path.abspath(__file__)), 'answers.json'),
                    help='정답 파일(JSON). 없으면 정답 표시 안 함')
    ap.add_argument('--marks', default=os.path.join(os.path.dirname(os.path.abspath(__file__)), 'marks.json'),
                    help='지문 표시어 파일(JSON): {"인문01": [["a", "구절"], ...]}')
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

    answers = {}
    if a.answers and os.path.exists(a.answers):
        with open(a.answers, encoding='utf8') as f:
            answers = json.load(f)
    marks = {}
    if a.marks and os.path.exists(a.marks):
        with open(a.marks, encoding='utf8') as f:
            marks = {k: v for k, v in json.load(f).items() if not k.startswith('_')}
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
                             page=it['page'], sid=s, ans=answers.get(s)))
            report.append((s, f'MISSING 원본 시험지 없음({yy}학년도 {mm}월)'))
            continue
        boxes = ex.passage_boxes(qa, qb)
        if not boxes:
            plan.append(dict(kind='asis', png=render_png(var, it['page'], 200, os.path.join(work, f'asis_{it["page"]}')),
                             page=it['page'], sid=s))
            report.append((s, f'FAIL 발문 [{qa}~{qb}] 또는 지문 상자를 못 찾음'))
            continue
        passage = cut_passage(ex, boxes, work, s, marks.get(s))
        qs = question_blocks(it, var, work)
        if not qs:
            report.append((s, 'FAIL 문제를 못 찾음'))
            continue
        pages, scale = layout(passage, qs)
        plan.append(dict(kind='passage', pages=pages, page=it['page'], sid=s, ans=answers.get(s)))
        report.append((s, f'OK 문제 {len(qs)}개 · 지문 상자 {len(boxes)}개 · 지문 배율 {scale:.2f} · {len(pages)}쪽'))

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
