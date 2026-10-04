import json,glob,sys,collections
CI='①②③④⑤'
d=sys.argv[1]; n=r1=0; ans=[]
for f in sorted(glob.glob(d+'/sets/*.json')):
    for q in json.load(open(f)):
        if q.get('short'): continue
        if 'pos' not in q: ans.append(q['answer']); continue
        ch=list(q['choices']); c=ch.pop(0); ch.insert(q['pos']-1,c); ai=q['pos']-1; ans.append(CI[ai])
        if 'bogi_lines' in q and len(max(ch,key=len))<15: continue
        L=[len(x) for x in ch]; r=sorted(L,reverse=True).index(L[ai])+1; n+=1; r1+=r==1
        if L[ai]/(sum(L)/5)>1.12: print('  긴 정답', f.split('/')[-1], L)
print(f'정답 최장 {r1}/{n}', dict(collections.Counter(ans)), len(ans))
