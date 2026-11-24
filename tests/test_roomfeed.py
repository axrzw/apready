"""The 📡 room watcher: WebSocket client, Archipelago protocol handling, progress, room links."""
import base64
import hashlib
import json
import socket
import struct
import threading

from app import roomfeed
from app.server import parse_room


# ---------- a real local WebSocket server (stdlib) for the client ----------

def _ws_server(script):
    """Accept one client, do the handshake, run script(conn), return (host, port)."""
    srv = socket.socket()
    srv.bind(("127.0.0.1", 0))
    srv.listen(1)

    def run():
        conn, _ = srv.accept()
        req = b""
        while b"\r\n\r\n" not in req:
            req += conn.recv(4096)
        key = [l.split(b": ", 1)[1] for l in req.split(b"\r\n") if l.lower().startswith(b"sec-websocket-key")][0]
        accept = base64.b64encode(hashlib.sha1(key + b"258EAFA5-E914-47DA-95CA-C5AB0DC85B11").digest())
        conn.sendall(b"HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\n"
                     b"Sec-WebSocket-Accept: " + accept + b"\r\n\r\n")
        script(conn)
        conn.close()
        srv.close()
    threading.Thread(target=run, daemon=True).start()
    return srv.getsockname()


def _frame(opcode, data: bytes, fin=True):
    n = len(data)
    head = bytes([(0x80 if fin else 0) | opcode])
    head += bytes([n]) if n < 126 else bytes([126]) + struct.pack(">H", n) if n < 65536 else bytes([127]) + struct.pack(">Q", n)
    return head + data


def _read_client_frame(conn):
    b1, b2 = conn.recv(1)[0], conn.recv(1)[0]
    n = b2 & 0x7F
    if n == 126:
        n = struct.unpack(">H", conn.recv(2))[0]
    mask = conn.recv(4)
    data = b""
    while len(data) < n:
        data += conn.recv(n - len(data))
    return b1 & 0x0F, bytes(b ^ mask[i % 4] for i, b in enumerate(data))


def test_websocket_client_against_a_real_server():
    got = {}

    def script(conn):
        conn.sendall(_frame(0x9, b"hi"))                                   # ping -> client must pong
        big = json.dumps([{"cmd": "X", "pad": "a" * 70000}]).encode()      # 64-bit length
        conn.sendall(_frame(0x1, b'[{"cmd":"Room', fin=False) + _frame(0x0, b'Info"}]'))  # fragmented
        conn.sendall(_frame(0x1, big))
        got["pong"] = _read_client_frame(conn)
        got["text"] = _read_client_frame(conn)
    host, port = _ws_server(script)
    ws = roomfeed.WebSocket(host, port, secure=False)
    assert json.loads(ws.recv_text()) == [{"cmd": "RoomInfo"}]
    assert len(ws.recv_text()) > 70000
    ws.send_text('[{"cmd":"Connect"}]')
    import time
    for _ in range(50):
        if "text" in got:
            break
        time.sleep(0.05)
    assert got["pong"] == (0xA, b"hi") and got["text"] == (0x1, b'[{"cmd":"Connect"}]')
    ws.close()


# ---------- Archipelago protocol, with packets as the server sends them ----------

class FakeWS:
    def __init__(self, packets):
        self.inbox = [json.dumps(p) for p in packets]
        self.sent = []

    def send_text(self, t):
        self.sent.extend(json.loads(t))

    def recv_text(self):
        if not self.inbox:
            raise ConnectionError("done")
        return self.inbox.pop(0)

    def close(self):
        pass


ROOM = [
    [{"cmd": "RoomInfo", "games": ["Clique"], "version": {"major": 0, "minor": 6, "build": 0}}],
    [{"cmd": "DataPackage", "data": {"games": {"Clique": {
        "item_name_to_id": {"Feeling of Satisfaction": 69696969, "Button Activation": 69696968},
        "location_name_to_id": {"The Big Red Button": 69696969, "The Item on the Desk": 69696968}}}}}],
    [{"cmd": "Connected", "slot": 1, "team": 0,
      "players": [{"team": 0, "slot": 1, "alias": "Mishal", "name": "Mishal"}, {"team": 0, "slot": 2, "alias": "Fahad", "name": "Fahad"}],
      "slot_info": {"1": {"name": "Mishal", "game": "Clique"}, "2": {"name": "Fahad", "game": "Clique"}},
      "checked_locations": [], "missing_locations": [69696968, 69696969]}],
    [{"cmd": "PrintJSON", "type": "ItemSend", "receiving": 1, "item": {"item": 69696968, "location": 69696968, "player": 2, "flags": 1},
      "data": [{"type": "player_id", "text": "2"}, {"text": " sent "}, {"type": "item_id", "text": "69696968", "player": 1, "flags": 1},
               {"text": " to "}, {"type": "player_id", "text": "1"}, {"text": " ("}, {"type": "location_id", "text": "69696968", "player": 2}, {"text": ")"}]}],
    [{"cmd": "Bounced", "tags": ["DeathLink"], "data": {"time": 1.0, "source": "Fahad", "cause": "Fahad fell"}}],
    [{"cmd": "RoomUpdate", "checked_locations": [69696968]}],
    [{"cmd": "PrintJSON", "type": "Goal", "data": [{"type": "player_id", "text": "2"}, {"text": " has completed their goal."}]}],
]


def _feed(packets, **kw):
    ws = FakeWS(packets)
    f = roomfeed.RoomFeed("archipelago.gg", 38281, "Mishal", connect=lambda: ws, **kw)
    f.stop_flag.set()  # one pass, no reconnect loop
    f.ws = ws
    try:
        while True:
            for p in json.loads(ws.recv_text()):
                f._handle(p)
    except ConnectionError:
        pass
    return f, ws


def test_feed_reads_items_deaths_and_my_progress():
    f, ws = _feed(ROOM)
    connect = next(p for p in ws.sent if p["cmd"] == "Connect")
    assert connect["tags"] == ["TextOnly", "DeathLink", "MyReadyAP"] and connect["items_handling"] == 0 and connect["name"] == "Mishal"
    snap = f.snapshot()
    texts = [e["text"] for e in snap["events"]]
    assert "Fahad sent Button Activation to Mishal (The Item on the Desk)" in texts
    item = next(e for e in snap["events"] if e["kind"] == "item")
    assert item["to_me"] and not item["from_me"] and item["sender"] == "Fahad"
    assert any(e["kind"] == "death" and e["text"] == "☠ Fahad مات: Fahad fell" for e in snap["events"])
    assert snap["deaths"] == {"Fahad": 1}
    assert snap["progress"] == {"Mishal": {"done": 1, "total": 2, "goal": False}}
    assert any(e["kind"] == "goal" for e in snap["events"])
    assert [e["i"] for e in f.snapshot(since=2)["events"]] == list(range(2, len(snap["events"])))


def test_refused_login_is_reported():
    f, _ = _feed(ROOM[:2] + [[{"cmd": "ConnectionRefused", "errors": ["InvalidSlot"]}]])
    assert f.status == "refused" and "InvalidSlot" in f.error


def test_progress_for_everyone_from_the_archipelago_tracker():
    api = {
        "https://archipelago.gg/api/static_tracker/TRK": {"player_locations_total": [
            {"team": 0, "player": 1, "total_locations": 20}, {"team": 0, "player": 2, "total_locations": 10}]},
        "https://archipelago.gg/api/tracker/TRK": {
            "aliases": [{"team": 0, "player": 1, "alias": "Mishal"}, {"team": 0, "player": 2, "alias": "Fahad"}],
            "player_checks_done": [{"team": 0, "player": 1, "locations": [1, 2, 3, 4, 5]},
                                   {"team": 0, "player": 2, "locations": list(range(10))}],
            "player_status": [{"team": 0, "player": 1, "status": 20}, {"team": 0, "player": 2, "status": 30}]},
    }
    f = roomfeed.RoomFeed("archipelago.gg", 1, "Mishal", tracker="TRK", get_json=api.__getitem__)
    f.stop_flag.wait = lambda t: True  # one round
    f._track()
    assert f.snapshot()["progress"] == {"Mishal": {"done": 5, "total": 20, "goal": False},
                                        "Fahad": {"done": 10, "total": 10, "goal": True}}


def test_room_link_finds_the_port_and_wakes_the_room():
    woke = []
    api = {"https://archipelago.gg/api/room_status/AbC-123": {"last_port": 51234, "tracker": "/tracker/TrK9"}}
    room = roomfeed.resolve_room_link("https://archipelago.gg/room/AbC-123", api.__getitem__, woke.append)
    assert room == {"host": "archipelago.gg", "port": "51234", "room": "AbC-123", "tracker": "TrK9"}
    assert woke == ["https://archipelago.gg/room/AbC-123"]
    assert parse_room("  https://archipelago.gg/room/AbC-123 ", resolve=lambda t: {"host": "h", "port": "1"}) == {"host": "h", "port": "1"}
    assert parse_room("archipelago.gg:38281") == {"host": "archipelago.gg", "port": "38281"}


# ---------- death counter: shared real totals (free deaths included), kept per multiworld ----------

def test_death_counter_merges_shared_totals_and_survives_restarts(tmp_path):
    store = tmp_path / "deaths.json"
    room = [[{"cmd": "RoomInfo", "games": ["Clique"], "seed_name": "SEED1"}]] + ROOM[1:3] + [
        [{"cmd": "Bounced", "tags": ["DeathLink"], "data": {"source": "Fahad"}}],
        [{"cmd": "Bounced", "tags": ["MyReadyAP"], "data": {"kind": "deaths", "source": "Fahad", "deaths": 5}}],
        [{"cmd": "Bounced", "tags": ["MyReadyAP"], "data": {"kind": "deaths", "source": "Mishal", "deaths": 99}}],  # nobody speaks for me
        [{"cmd": "Bounced", "tags": ["MyReadyAP"], "data": {"kind": "deaths", "source": "X", "deaths": "lots"}}],  # junk
    ]
    f, ws = _feed(room, store=store)
    assert f.death_counts() == {"Fahad": 5}
    f.status, f.ws = "connected", ws
    f.record_my_death(); f.record_my_death()  # two free deaths the relay kept home
    assert f.death_counts() == {"Fahad": 5, "Mishal": 2}
    shared = [p for p in ws.sent if p.get("cmd") == "Bounce" and p["data"].get("kind") == "deaths"]
    assert shared[-1]["data"] == {"kind": "deaths", "source": "Mishal", "deaths": 2} and shared[-1]["tags"] == ["MyReadyAP"]
    assert any(p.get("cmd") == "Bounce" and p["data"].get("kind") == "deaths?" for p in ws.sent)  # asked the others
    # the app restarts: same seed, the counts come back
    f2, _ = _feed([[{"cmd": "RoomInfo", "games": [], "seed_name": "SEED1"}]], store=store)
    assert f2.death_counts() == {"Fahad": 5, "Mishal": 2}
    f3, _ = _feed([[{"cmd": "RoomInfo", "games": [], "seed_name": "OTHER"}]], store=store)
    assert f3.death_counts() == {}  # a new multiworld starts at zero


def test_free_deaths_show_in_everyones_log():
    """A free death never reaches the room as Death Link: my log shows it, and the other apps get it."""
    room = ROOM[:3] + [
        [{"cmd": "Bounced", "tags": ["MyReadyAP"], "data": {"kind": "death", "source": "Fahad", "cause": "Fahad  was\nshot", "free": True}}],
        [{"cmd": "Bounced", "tags": ["MyReadyAP"], "data": {"kind": "death", "source": "Mishal", "cause": "fake"}}],  # not about me
        [{"cmd": "Bounced", "tags": ["DeathLink"], "data": {"source": "Sara"}}],  # no cause given
    ]
    f, ws = _feed(room)
    texts = [e["text"] for e in f.snapshot()["events"] if e["kind"] == "death"]
    assert texts == ["🛟 Fahad مات (موتة مجانية، ما انرسلت للشباب): Fahad was shot", "☠ Sara مات"]
    f.status, f.ws = "connected", ws
    f.record_my_death(sent=False, cause="Mishal fell into lava")
    assert f.snapshot()["events"][-1]["text"] == "🛟 Mishal مات (موتة مجانية، ما انرسلت للشباب): Mishal fell into lava"
    shared = [p["data"] for p in ws.sent if p.get("cmd") == "Bounce" and p["data"].get("kind") == "death"]
    assert shared == [{"kind": "death", "source": "Mishal", "cause": "Mishal fell into lava", "free": True}]
    f.record_my_death(sent=True, cause="sent one")  # the room hears this one as Death Link: no extra log line
    assert len([p for p in ws.sent if p.get("cmd") == "Bounce" and p["data"].get("kind") == "death"]) == 1


def test_server_chatter_stays_out_of_the_log():
    """Join/Part (every client and app reconnect), tag changes and the tutorial line are noise."""
    noise = [[{"cmd": "PrintJSON", "type": t, "data": [{"text": t}]}] for t in ("Join", "Part", "TagsChanged", "Tutorial")]
    f, _ = _feed(ROOM[:3] + noise + ROOM[3:4])
    kinds = [e["kind"] for e in f.snapshot()["events"]]
    texts = " ".join(e["text"] for e in f.snapshot()["events"])
    assert not any(t in texts for t in ("Join", "Part", "TagsChanged", "Tutorial"))
    assert kinds.count("item") == 1
    # a reconnect doesn't add another "connected" line
    f._handle(ROOM[2][0])
    assert [e["text"] for e in f.snapshot()["events"]].count("✔ متصل بالروم") == 1
