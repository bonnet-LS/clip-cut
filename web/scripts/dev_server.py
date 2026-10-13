"""로컬 테스트 서버: 저장소 루트 vercel.json 에 적힌 헤더(교차 출처 격리, CSP 등)를 똑같이 붙여 public/ 을 제공한다.

사용법: python3 scripts/dev_server.py [포트]  (기본 5080)
"""
import json
import re
import sys
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
RULES = [
    (re.compile("^" + rule["source"].replace("(.*)", ".*") + "$"), rule["headers"])
    for rule in json.loads((ROOT.parent / "vercel.json").read_text(encoding="utf-8"))["headers"]
]


class Handler(SimpleHTTPRequestHandler):
    def end_headers(self):
        path = self.path.split("?")[0]
        for pattern, headers in RULES:
            if pattern.match(path):
                for h in headers:
                    if h["key"].lower() != "cache-control":
                        self.send_header(h["key"], h["value"])
        self.send_header("Cache-Control", "no-store")
        super().end_headers()


if __name__ == "__main__":
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 5080
    server = ThreadingHTTPServer(("127.0.0.1", port), partial(Handler, directory=str(ROOT / "public")))
    print(f"http://localhost:{port}")
    server.serve_forever()
