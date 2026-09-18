"""Dev server for Sax Rush: like `python -m http.server` but
- listens on localhost only (never exposed to the LAN),
- refuses dotfiles/dirs (.git, .claude) and directory listings,
- sends no-cache headers so edits show up on a plain reload."""
import sys
from urllib.parse import unquote
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer


class Handler(SimpleHTTPRequestHandler):
    def end_headers(self):
        self.send_header("Cache-Control", "no-store, no-cache, must-revalidate, max-age=0")
        self.send_header("Pragma", "no-cache")
        self.send_header("Expires", "0")
        super().end_headers()

    def send_head(self):
        path = unquote(self.path.split("?", 1)[0])
        if any(seg.startswith(".") for seg in path.split("/") if seg):
            self.send_error(404, "Not found")
            return None
        return super().send_head()

    def list_directory(self, path):
        self.send_error(403, "Directory listing disabled")
        return None

    def log_message(self, fmt, *args):
        pass  # keep the console quiet


if __name__ == "__main__":
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 8734
    ThreadingHTTPServer(("127.0.0.1", port), Handler).serve_forever()
