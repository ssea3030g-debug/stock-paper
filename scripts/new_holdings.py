"""이미 발행된 신문에 없는(=아직 한 번도 수집되지 않은) 새 종목만 골라낸다.

  python scripts/new_holdings.py --live output/data/holdings.json --page /path/site/index.html --out output/data/new_holdings.json

--page 는 이미 발행된 신문 HTML(내 종목 데이터가 담긴 <script id="stock-data">) 하나를 가리킨다.
그 안의 snapshot(발행 시점 보유 종목)에 없는 종목만 --out 에 배열로 쓴다. 파일이 없거나
비어 있으면 --live 전체를 새 종목으로 취급한다.
"""
from __future__ import annotations

import argparse
import json
import re
import sys
from pathlib import Path

STOCK_DATA_RE = re.compile(r'<script type="application/json" id="stock-data">(.*?)</script>', re.S)


def key_of(h: dict) -> str:
    return f"{str(h.get('market') or 'KR').upper()}-{str(h.get('code') or '').upper()}"


def ident(h: dict) -> str:
    """앱 저장소의 문서 id 가 있으면 그것(이름만 넣어 아직 못 맞춘 Q-… 종목 포함), 없으면 시장-코드."""
    return str(h.get("id") or key_of(h))


def published_keys(page: Path) -> set[str]:
    if not page.exists():
        return set()
    m = STOCK_DATA_RE.search(page.read_text(encoding="utf-8"))
    if not m:
        return set()
    try:
        data = json.loads(m.group(1))
    except json.JSONDecodeError:
        return set()
    return {ident(h) for h in (data.get("snapshot") or [])}


def new_holdings(live: list[dict], page: Path) -> list[dict]:
    seen = published_keys(page)
    return [h for h in live if (h.get("code") or h.get("name") or h.get("query")) and ident(h) not in seen]


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("--live", required=True)
    ap.add_argument("--page", required=True)
    ap.add_argument("--out", required=True)
    args = ap.parse_args(argv)
    live = json.loads(Path(args.live).read_text(encoding="utf-8"))
    new = new_holdings(live, Path(args.page))
    out = Path(args.out)
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(json.dumps(new, ensure_ascii=False, indent=1), encoding="utf-8")
    print(len(new))
    return 0


if __name__ == "__main__":
    sys.exit(main())
