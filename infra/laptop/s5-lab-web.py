#!/usr/bin/env python3
"""Halaman uji di "VM target" lab simulasi (dijalankan s5-lab-web@<id>.service di netns lab-<id>).

Menampilkan nama lab, IP VM target, dan IP tunnel pengunjung (10.8.0.x) supaya pemohon bisa
memastikan tunnelnya bekerja dari browser. Hanya stdlib, tanpa akses tulis apa pun.
"""
import html
import sys
from datetime import datetime, timedelta, timezone
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

# shortcut: nama lab disalin dari seed DB; lab baru tanpa entri di sini tampil sebagai "lab-<id>".
NAMES = {"cloud": "Lab Cloud Computing", "cyber": "Lab Cyber Security", "jarkom": "Lab Jaringan Komputer"}
LAB_ID = sys.argv[1] if len(sys.argv) > 1 else "?"
LAB_NAME = NAMES.get(LAB_ID, f"lab-{LAB_ID}")
WIB = timezone(timedelta(hours=7))

PAGE = """<!doctype html><html lang="id"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1"><title>{name}</title>
<style>body{{margin:0;font:16px/1.6 system-ui,sans-serif;background:#f1f4f9;color:#0f1d3a}}
main{{max-width:34rem;margin:0 auto;padding:2.5rem 1.25rem}}.ok{{display:inline-block;background:#d9f7ec;color:#05603a;
font-weight:700;border-radius:99px;padding:.25rem .8rem;font-size:.9rem}}h1{{font-size:2rem;margin:.75rem 0 .25rem}}
dl{{background:#fff;border-radius:12px;padding:1rem 1.25rem;box-shadow:0 1px 3px #0001}}dt{{color:#5b6b86;font-size:.85rem}}
dd{{margin:0 0 .75rem;font:600 1.1rem ui-monospace,monospace}}p{{color:#5b6b86}}</style></head>
<body><main><span class="ok">&#10003; Terhubung lewat Singgah</span><h1>{name}</h1>
<p>Halaman uji di VM target jaringan lab. Kalau kamu bisa membuka halaman ini, tunnel WireGuard-mu sudah benar.</p>
<dl><dt>VM target</dt><dd>{target}</dd><dt>IP tunnel kamu (dilihat lab)</dt><dd>{client}</dd><dt>Waktu</dt><dd>{now} WIB</dd></dl>
<p>Lab lain dan perangkat pengguna lain sengaja tidak bisa dijangkau dari akses ini.</p></main></body></html>"""


class Handler(BaseHTTPRequestHandler):
    server_version = "s5-lab-web"
    sys_version = ""

    def do_GET(self):
        if self.path not in ("/", "/index.html"):
            self.send_error(404)
            return
        body = PAGE.format(
            name=html.escape(LAB_NAME),
            target=html.escape(self.connection.getsockname()[0]),
            client=html.escape(self.client_address[0]),
            now=datetime.now(WIB).strftime("%d-%m-%Y %H.%M.%S"),
        ).encode()
        self.send_response(200)
        self.send_header("Content-Type", "text/html; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(body)


if __name__ == "__main__":
    ThreadingHTTPServer(("0.0.0.0", 80), Handler).serve_forever()
