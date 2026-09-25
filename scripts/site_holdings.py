"""Cloudflare 앱에 저장된(또는 아직 연결 전이면 정적) 내 종목 목록을 받아온다.

  python scripts/site_holdings.py --out output/data/holdings.json

config.yaml 의 site.pages_url 이 설정돼 있으면 <pages_url>/api/holdings 를 호출해서 받고,
아직 비어 있으면(Cloudflare 미연결) data/site_holdings.json 을 그대로 쓴다.
"""
from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path
from urllib.error import URLError
from urllib.request import Request, urlopen

import yaml

ROOT = Path(__file__).resolve().parent.parent


def fetch(cfg: dict) -> tuple[list, str]:
    url = ((cfg.get("site") or {}).get("pages_url") or "").strip().rstrip("/")
    if url:
        req = Request(url + "/api/holdings", headers={"User-Agent": "stock-paper-copy/1.0"})
        try:
            with urlopen(req, timeout=15) as r:
                data = json.loads(r.read().decode("utf-8"))
            if not isinstance(data, list):
                raise ValueError(f"응답이 배열이 아님: {type(data).__name__}")
            return data, "cloudflare"
        except (URLError, TimeoutError, ValueError) as e:
            # 네트워크 차단·KV 미연결이어도 신문 발행은 계속되도록 정적 목록으로 대신함
            print(f"경고: {url}/api/holdings 조회 실패 ({e}) → data/site_holdings.json 사용", file=sys.stderr)
            return static(), "static-fallback"
    return static(), "static"


def static() -> list:
    fallback = ROOT / "data" / "site_holdings.json"
    return json.loads(fallback.read_text(encoding="utf-8")) if fallback.exists() else []


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("--config", default=str(ROOT / "config.yaml"))
    ap.add_argument("--out", required=True)
    args = ap.parse_args(argv)
    cfg = yaml.safe_load(Path(args.config).read_text(encoding="utf-8"))
    holdings, src = fetch(cfg)
    out = Path(args.out)
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(json.dumps(holdings, ensure_ascii=False, indent=1), encoding="utf-8")
    print(f"{out}: {len(holdings)}개 종목 ({src})")
    return 0


if __name__ == "__main__":
    sys.exit(main())
