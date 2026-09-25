"""Cloudflare Pages 에 올릴 설치형 웹앱(PWA) 폴더를 만든다.

  python scripts/build_site.py [--src output] [--site site]

site/ 에 이미 있는 지난 호는 그대로 두고, --src 의 YYYY-MM-DD.html 을 더해서
  index.html          가장 최근 호 (앱을 열면 바로 보임)
  YYYY-MM-DD.html     각 호
  archive.html        지난 호 목록
  manifest.webmanifest, sw.js, icon-*.png, _headers
를 쓴다. 각 호 HTML 의 <head> 에 매니페스트·아이콘·서비스 워커 연결을 넣는다.
"""
from __future__ import annotations

import argparse
import datetime as dt
import json
import re
import shutil
import sys
from pathlib import Path

import yaml

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

from paper import fmt, render  # noqa: E402

DATE_FILE = re.compile(r"^(\d{4}-\d{2}-\d{2})\.html$")
MARK = "<!-- pwa -->"

SW = """// 아침증권신문 서비스 워커: 페이지는 네트워크 우선(오프라인이면 마지막으로 본 것), 아이콘은 캐시 우선
var CACHE = "paper-v1";
self.addEventListener("install", function (e) { self.skipWaiting(); });
self.addEventListener("activate", function (e) { e.waitUntil(self.clients.claim()); });
self.addEventListener("fetch", function (e) {
  var req = e.request;
  if (req.method !== "GET" || new URL(req.url).origin !== location.origin) return;
  if (req.mode === "navigate" || req.destination === "document") {
    e.respondWith(fetch(req).then(function (res) {
      var copy = res.clone();
      caches.open(CACHE).then(function (c) { c.put(req, copy); });
      return res;
    }).catch(function () {
      return caches.match(req).then(function (r) { return r || caches.match("./"); });
    }));
    return;
  }
  e.respondWith(caches.match(req).then(function (r) {
    return r || fetch(req).then(function (res) {
      var copy = res.clone();
      caches.open(CACHE).then(function (c) { c.put(req, copy); });
      return res;
    });
  }));
});
"""

HEADERS = """/*
  X-Content-Type-Options: nosniff
  Referrer-Policy: strict-origin-when-cross-origin
/*.html
  Cache-Control: no-cache
/
  Cache-Control: no-cache
/sw.js
  Cache-Control: no-cache
/manifest.webmanifest
  Content-Type: application/manifest+json
"""


def head_tags(site: dict) -> str:
    return (f'{MARK}\n<link rel="manifest" href="manifest.webmanifest">\n'
            f'<meta name="theme-color" content="{site.get("theme_color", "#17160f")}">\n'
            '<link rel="icon" href="icon-192.png">\n<link rel="apple-touch-icon" href="icon-180.png">\n'
            '<script>if ("serviceWorker" in navigator) navigator.serviceWorker.register("sw.js").catch(function () {});</script>\n')


def add_pwa(html: str, site: dict) -> str:
    if MARK in html:
        return html
    i = html.find("</head>")
    return html[:i] + head_tags(site) + html[i:] if i >= 0 else html


def manifest(site: dict) -> dict:
    return {"name": site.get("name", "아침증권신문"), "short_name": site.get("short_name", "아침증권"),
            "description": "국내외 증시·지표·뉴스를 모은 아침 증권 신문", "lang": "ko",
            "start_url": "./", "scope": "./", "display": "standalone", "orientation": "portrait",
            "theme_color": site.get("theme_color", "#17160f"), "background_color": site.get("background_color", "#edeae2"),
            "icons": [{"src": "icon-192.png", "sizes": "192x192", "type": "image/png", "purpose": "any"},
                      {"src": "icon-512.png", "sizes": "512x512", "type": "image/png", "purpose": "any"},
                      {"src": "icon-512.png", "sizes": "512x512", "type": "image/png", "purpose": "maskable"}]}


def build(cfg: dict, src: Path, site_dir: Path) -> list[str]:
    site = cfg.get("site") or {}
    site_dir.mkdir(parents=True, exist_ok=True)
    for p in src.iterdir():
        if DATE_FILE.match(p.name):
            shutil.copyfile(p, site_dir / p.name)
    dates = sorted((DATE_FILE.match(p.name).group(1) for p in site_dir.iterdir() if DATE_FILE.match(p.name)),
                   reverse=True)
    if not dates:
        raise SystemExit(f"{src} 와 {site_dir} 에 YYYY-MM-DD.html 이 없습니다")
    for d in dates:
        p = site_dir / f"{d}.html"
        p.write_text(add_pwa(p.read_text(encoding="utf-8"), site), encoding="utf-8")
    shutil.copyfile(site_dir / f"{dates[0]}.html", site_dir / "index.html")

    issues = [{"file": f"{d}.html", "label_long": fmt.date_ko(dt.date.fromisoformat(d)),
               "no": render.issue_number(cfg, dt.date.fromisoformat(d))} for d in dates]
    archive = render.env().get_template("index.html.j2").render(paper=cfg.get("newspaper", {}), issues=issues)
    (site_dir / "archive.html").write_text(add_pwa(archive, site), encoding="utf-8")

    (site_dir / "manifest.webmanifest").write_text(json.dumps(manifest(site), ensure_ascii=False, indent=1),
                                                   encoding="utf-8")
    (site_dir / "sw.js").write_text(SW, encoding="utf-8")
    (site_dir / "_headers").write_text(HEADERS, encoding="utf-8")
    for n in (180, 192, 512):
        shutil.copyfile(ROOT / "static" / f"icon-{n}.png", site_dir / f"icon-{n}.png")
    return dates


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("--config", default=str(ROOT / "config.yaml"))
    ap.add_argument("--src", default=str(ROOT / "output"))
    ap.add_argument("--site", default=str(ROOT / "site"))
    args = ap.parse_args(argv)
    cfg = yaml.safe_load(Path(args.config).read_text(encoding="utf-8"))
    dates = build(cfg, Path(args.src), Path(args.site))
    print(f"{args.site}: {len(dates)}개 호, 최신 {dates[0]}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
