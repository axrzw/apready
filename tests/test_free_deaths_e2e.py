"""Free deaths end to end: Play with free deaths -> the game connects through the relay -> only every
3rd death reaches the room, and the counter (ping) shows the real total."""
import base64
import hashlib
import json
import socket
import threading
import time
import urllib.request
from http.server import ThreadingHTTPServer

from app import dlproxy, roomfeed, runner, server
from tests.test_roomfeed import _frame, _read_client_frame


class FakeRoom:
    """A tiny Archipelago room: RoomInfo, Connect -> Connected, Bounce -> Bounced to matching tags."""

    def __init__(self):
        self.srv = socket.socket()
        self.srv.bind(("127.0.0.1", 0))
        self.srv.listen(8)
        self.port = self.srv.getsockname()[1]
        self.clients = []      # (conn, tags)
        self.bounces = []      # every Bounce the room got
        self.lock = threading.Lock()
        threading.Thread(target=self._accept, daemon=True).start()

    def _accept(self):
        while True:
            try:
                conn, _ = self.srv.accept()
            except OSError:
                return
            threading.Thread(target=self._serve, args=(conn,), daemon=True).start()

    def _send(self, conn, packets):
        with self.lock:
            conn.sendall(_frame(0x1, json.dumps(packets).encode()))

    def _serve(self, conn):
        req = b""
        while b"\r\n\r\n" not in req:
            chunk = conn.recv(4096)
            if not chunk:
                return
            req += chunk
        key = [l.split(b": ", 1)[1] for l in req.split(b"\r\n") if l.lower().startswith(b"sec-websocket-key")][0]
        accept = base64.b64encode(hashlib.sha1(key + b"258EAFA5-E914-47DA-95CA-C5AB0DC85B11").digest())
        conn.sendall(b"HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\n"
                     b"Sec-WebSocket-Accept: " + accept + b"\r\n\r\n")
        self._send(conn, [{"cmd": "RoomInfo", "games": ["TUNIC"], "seed_name": "S1"}])
        entry = [conn, set()]
        try:
            while True:
                op, data = _read_client_frame(conn)
                if op == 0x8:
                    return
                for p in json.loads(data):
                    if p["cmd"] == "Connect":
                        entry[1] = set(p.get("tags", []))
                        with self.lock:
                            self.clients.append(entry)
                        self._send(conn, [{"cmd": "Connected", "slot": 1, "team": 0, "players": [
                            {"team": 0, "slot": 1, "alias": "Mishal", "name": "Mishal"}], "slot_info": {},
                            "checked_locations": [], "missing_locations": []}])
                    elif p["cmd"] == "Bounce":
                        with self.lock:
                            self.bounces.append(p)
                            targets = [c for c, tags in self.clients if tags & set(p.get("tags", []))]
                        for c in targets:
                            self._send(c, [{"cmd": "Bounced", **{k: v for k, v in p.items() if k != "cmd"}}])
        except Exception:
            return


def _wait(cond, t=5):
    end = time.time() + t
    while time.time() < end:
        if cond():
            return True
        time.sleep(0.05)
    return False


def test_play_with_free_deaths(tmp_path, monkeypatch):
    monkeypatch.setenv("APPDATA", str(tmp_path))
    room = FakeRoom()
    sessions = []
    monkeypatch.setattr(runner, "start", lambda fn, recipe, phases, session, options: sessions.append(session) or runner.Task())
    monkeypatch.setattr(roomfeed.RoomFeed, "_open", lambda self: roomfeed.WebSocket(self.host, self.port, secure=False))
    monkeypatch.setattr(dlproxy, "_upstream", lambda h, p: roomfeed.WebSocket(h, p, secure=False))
    server.reload_recipes()
    srv = ThreadingHTTPServer(("127.0.0.1", 0), server.Handler)
    threading.Thread(target=srv.serve_forever, daemon=True).start()
    base = f"http://127.0.0.1:{srv.server_address[1]}"

    def post(path, body):
        req = urllib.request.Request(base + path, json.dumps(body).encode(), {"Content-Type": "application/json"})
        return json.loads(urllib.request.urlopen(req).read())

    def ping():
        return json.loads(urllib.request.urlopen(base + "/api/ping").read())
    try:
        post("/api/name", {"name": "Mishal"})
        post("/api/play", {"game": "tunic", "room": f"127.0.0.1:{room.port}", "options": {"free_deaths": 2}})
        s = sessions[-1]
        assert s["host"] == "127.0.0.1" and int(s["port"]) == dlproxy.ACTIVE["proxy"].local_port  # the game gets the relay
        assert _wait(lambda: server.FEED["feed"].status == "connected")
        # the game connects through the relay like a real client
        game = roomfeed.WebSocket("127.0.0.1", int(s["port"]), secure=False)
        assert json.loads(game.recv_text())[0]["cmd"] == "RoomInfo"
        game.send_text(json.dumps([{"cmd": "Connect", "name": "Mishal", "tags": ["DeathLink"]}]))
        assert json.loads(game.recv_text())[0]["cmd"] == "Connected"
        assert ping()["free"] == {"left": 2, "of": 2}
        for n in range(6):
            game.send_text(json.dumps([{"cmd": "Bounce", "tags": ["DeathLink"], "data": {"source": "Mishal", "cause": f"d{n + 1}"}}]))
        sent = lambda: [b["data"]["cause"] for b in room.bounces if "DeathLink" in b["tags"]]
        assert _wait(lambda: len(sent()) == 2) and sent() == ["d3", "d6"]  # only every 3rd death left home
        assert _wait(lambda: ping()["deaths"].get("Mishal") == 6)        # the counter shows all 6
        assert ping()["free"] == {"left": 2, "of": 2}
        shared = [b for b in room.bounces if "MyReadyAP" in b["tags"] and b["data"].get("kind") == "deaths"]
        assert shared and shared[-1]["data"]["deaths"] == 6                 # the others' apps learn the real number
        assert dlproxy.busy()                                               # closing the window waits for the game
        game.close()
        assert _wait(lambda: not dlproxy.busy())
        # Play again with 0 free deaths: straight to the room, no relay
        post("/api/play", {"game": "tunic", "room": f"127.0.0.1:{room.port}", "options": {"free_deaths": 0}})
        assert sessions[-1]["host"] == "127.0.0.1" and int(sessions[-1]["port"]) == room.port
        assert dlproxy.ACTIVE["proxy"] is None
    finally:
        dlproxy.stop()
        if server.FEED["feed"]:
            server.FEED["feed"].stop()
            server.FEED["feed"] = None
        srv.shutdown()


def test_no_relay_when_death_link_is_off_or_native(tmp_path, monkeypatch):
    monkeypatch.setenv("APPDATA", str(tmp_path))
    server.reload_recipes()
    r = server.RECIPES
    assert server._free_deaths(r["tunic"], {"options": {"free_deaths": 3}}, death_link=False) == 0
    assert server._free_deaths(r["cuphead"], {"options": {"free_deaths": 3}}, death_link=True) == 0  # its own setting
    assert server._free_deaths(r["hitman"], {"options": {"free_deaths": 3}}, death_link=True) == 0   # no Death Link
    assert server._free_deaths(r["tunic"], {"options": {"free_deaths": 99}}, death_link=True) == 25
