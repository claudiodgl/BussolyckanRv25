"""Serve the Rv 25 story map: python serve.py [port]  →  http://127.0.0.1:8020"""
import functools
import http.server
import sys
from pathlib import Path

PORT = int(sys.argv[1]) if len(sys.argv) > 1 else 8020
STATIC = Path(__file__).resolve().parent / "static"


class Handler(http.server.SimpleHTTPRequestHandler):
    extensions_map = {**http.server.SimpleHTTPRequestHandler.extensions_map,
                      ".js": "text/javascript", ".geojson": "application/json"}

    def end_headers(self):
        self.send_header("Cache-Control", "no-cache")
        super().end_headers()

    def log_message(self, *a):
        pass


if __name__ == "__main__":
    h = functools.partial(Handler, directory=str(STATIC))
    with http.server.ThreadingHTTPServer(("127.0.0.1", PORT), h) as srv:
        print(f"Rv 25 story map → http://127.0.0.1:{PORT}")
        srv.serve_forever()
