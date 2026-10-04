"""usage: qtool.py write <sid> <spec.json>   (spec = list of question dicts)
          qtool.py check [sid...]"""
import sys, json, glob, os, subprocess
HERE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


def cov(f):
    s = set()
    for r in subprocess.run(['fc-query', '--format=%{charset}', f], capture_output=True, text=True).stdout.split():
        a, _, b = r.partition('-')
        a = int(a, 16)
        s.update(range(a, (int(b, 16) if b else a) + 1))
    return s


ALL = set()
for f in glob.glob(HERE + '/fonts/*.ttf'):
    ALL |= cov(f)


def check(sids):
    bad = 0
    for sid in sids:
        for j in sorted(glob.glob(f'{HERE}/custom_questions/{sid}/q*.json')):
            q = json.load(open(j))
            texts = [q['stem'], q.get('bogi_text', '')] + q.get('bogi_lines', []) + q.get('choices', []) + \
                [c for r in q.get('table', []) for c in r]
            miss = sorted({c for t in texts for c in t if not c.isspace() and ord(c) not in ALL})
            if miss:
                bad += 1
                print(os.path.relpath(j, HERE), '글꼴에 없는 글자:', ''.join(miss))
            if not q.get('short') and len(q.get('choices', [])) != 5:
                print(os.path.relpath(j, HERE), '선지 수', len(q.get('choices', [])))
    return bad


if sys.argv[1] == 'write':
    sid = sys.argv[2]
    spec = json.load(open(sys.argv[3]))
    d = f'{HERE}/custom_questions/{sid}'
    os.makedirs(d, exist_ok=True)
    for f in glob.glob(d + '/q*'):
        os.remove(f)
    for i, q in enumerate(spec, 1):
        q['stem'] = f'{i}. ' + q['stem']
        if 'pos' in q:      # 정답 선지를 맨 앞에 적고 pos로 자리를 정한다
            c = q['choices'].pop(0)
            q['choices'].insert(q['pos'] - 1, c)
            q['answer'] = '①②③④⑤'[q.pop('pos') - 1]
        with open(f'{d}/q{i}.json', 'w') as fo:
            json.dump(q, fo, ensure_ascii=False, indent=1)
    check([sid])
    print(sid, '정답:', ' '.join(q['answer'] for q in spec))
else:
    print('문제 있는 문항:', check(sys.argv[2:] or [os.path.basename(p) for p in glob.glob(HERE + '/custom_questions/*')]))
