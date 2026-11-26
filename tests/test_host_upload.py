"""Host: the generated seed goes up to archipelago.gg and a room opens, without the host touching the website."""
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

import pytest

from app import host


class FakeWebhost(BaseHTTPRequestHandler):
    got = {}

    def log_message(self, *a):
        pass

    def do_POST(self):
        n = int(self.headers["Content-Length"])
        body = self.rfile.read(n)
        FakeWebhost.got["upload"] = body
        if b'name="file"; filename="AP_123.zip"' not in body or b"ZIPDATA" not in body:
            self.send_response(200)
            self.end_headers()
            self.wfile.write(b'<div class="user-message">Could not load multidata. Wrong Version detected.</div>')
            return
        self.send_response(302)
        self.send_header("Set-Cookie", "session=abc; Path=/")
        self.send_header("Location", "/seed/SEED1")
        self.end_headers()

    def do_GET(self):
        FakeWebhost.got["cookie"] = self.headers.get("Cookie", "")
        if self.path == "/new_room/SEED1" and "session=abc" in FakeWebhost.got["cookie"]:
            self.send_response(302)
            self.send_header("Location", "/room/ROOM9")
        else:
            self.send_response(403)
        self.end_headers()


def _serve(monkeypatch):
    srv = ThreadingHTTPServer(("127.0.0.1", 0), FakeWebhost)
    threading.Thread(target=srv.serve_forever, daemon=True).start()
    base = f"http://127.0.0.1:{srv.server_address[1]}"
    monkeypatch.setattr(host, "WEBHOST", base)
    monkeypatch.setattr(host, "UPLOAD_URL", base + "/uploads")
    return srv, base


def test_upload_then_new_room_with_the_same_session(tmp_path, monkeypatch):
    srv, base = _serve(monkeypatch)
    z = tmp_path / "AP_123.zip"
    z.write_bytes(b"ZIPDATA")
    try:
        assert host.upload_and_open_room(z) == f"{base}/room/ROOM9"
        assert "session=abc" in FakeWebhost.got["cookie"]          # the room belongs to the session that uploaded
    finally:
        srv.shutdown()


def test_a_refused_upload_says_why(tmp_path, monkeypatch):
    srv, _ = _serve(monkeypatch)
    z = tmp_path / "AP_123.zip"
    z.write_bytes(b"something else")
    try:
        with pytest.raises(RuntimeError, match="Wrong Version"):
            host.upload_and_open_room(z)
    finally:
        srv.shutdown()


def test_generation_errors_name_the_friend():
    players = [{"file": "Mishal.yaml", "name": "Mishal", "game": "Celeste (Open World)"},
               {"file": "Fahad.yaml", "name": "Fahad", "game": "DOOM 1993"}]
    out = "Traceback...\nException: Error generating world for player Fahad: Option difficulty 'super' is not valid\n"
    msg = host.explain_failure(out, players)
    assert "Fahad" in msg and "DOOM 1993" in msg and "Mishal" not in msg.split("\n")[0]
    msg = host.explain_failure("Exception: Game Celeste already registered", players)
    assert "مرتين" in msg
