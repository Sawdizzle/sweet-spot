"""Local dev server that mirrors vercel.json rewrites: /<game> serves games/<game>/index.html.
Run from the repo root: python3 tools/dev-server.py 8766"""
import http.server, os, sys

GAMES = {"baseball", "fieldgoal", "pk", "golf", "drag"}

class Handler(http.server.SimpleHTTPRequestHandler):
    def translate_path(self, path):
        clean = path.split("?", 1)[0].split("#", 1)[0].strip("/")
        if clean in GAMES:
            path = f"/games/{clean}/index.html"
        return super().translate_path(path)

    def end_headers(self):
        self.send_header("Cache-Control", "no-store")
        super().end_headers()

if __name__ == "__main__":
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 8766
    root = sys.argv[2] if len(sys.argv) > 2 else os.getcwd()
    os.chdir(root)
    http.server.ThreadingHTTPServer(("127.0.0.1", port), Handler).serve_forever()
