"""The free-deaths relay: game <-> app <-> room, holding back free deaths only."""
import json
import threading
import time

from app import dlproxy, roomfeed

from tests.test_roomfeed import _frame, _read_client_frame, _ws_server


def _death(n):
    return json.dumps([{"cmd": "Bounce", "tags": ["DeathLink"], "data": {"source": "Mishal", "cause": f"death {n}"}}])


def test_filter_holds_back_free_deaths():
    seen = []
    p = dlproxy.DeathLinkProxy("h", 1, free=2, on_death=lambda total, sent: seen.append((total, sent)))
    try:
        other = json.dumps([{"cmd": "LocationChecks", "locations": [1]}])
        assert p.filter(other) == other  # untouched, byte for byte
        assert p.filter(_death(1)) is None and p.free_left() == 1
        assert p.filter(_death(2)) is None and p.free_left() == 0
        assert json.loads(p.filter(_death(3)))[0]["data"]["cause"] == "death 3"  # the 3rd is sent
        assert p.free_left() == 2
        both = json.dumps([{"cmd": "LocationChecks", "locations": [2]}, json.loads(_death(4))[0]])
        assert json.loads(p.filter(both)) == [{"cmd": "LocationChecks", "locations": [2]}]  # death held, check kept
        assert seen == [(1, False), (2, False), (3, True), (4, False)]
    finally:
        p.stop()


def test_zero_free_deaths_sends_everything():
    p = dlproxy.DeathLinkProxy("h", 1, free=0)
    try:
        assert p.filter(_death(1)) == _death(1)
    finally:
        p.stop()


def test_relay_end_to_end_over_real_sockets():
    """A fake room behind the relay; a game connects to the relay like it would to the room."""
    at_room, done = [], threading.Event()

    def room(conn):
        conn.sendall(_frame(0x1, b'[{"cmd":"RoomInfo"}]'))
        for _ in range(2):
            at_room.append(_read_client_frame(conn)[1].decode())
        done.set()
        time.sleep(0.5)
    host, port = _ws_server(room)
    p = dlproxy.DeathLinkProxy(host, port, free=1, connect=lambda h, pt: roomfeed.WebSocket(h, pt, secure=False)).start()
    try:
        game = roomfeed.WebSocket("127.0.0.1", p.local_port, secure=False)
        assert json.loads(game.recv_text()) == [{"cmd": "RoomInfo"}]  # room -> game passes through
        game.send_text(_death(1))   # free: stays home
        game.send_text(_death(2))   # sent
        game.send_text('[{"cmd":"Say","text":"hi"}]')
        assert done.wait(5)
        assert [json.loads(m)[0].get("cmd") for m in at_room] == ["Bounce", "Say"]
        assert json.loads(at_room[0])[0]["data"]["cause"] == "death 2"
        assert dlproxy.DeathLinkProxy.free_left(p) == 1
        game.close()
    finally:
        p.stop()


def test_tls_hello_is_refused_so_the_game_falls_back_to_ws():
    import socket
    p = dlproxy.DeathLinkProxy("h", 1, free=1).start()
    try:
        s = socket.create_connection(("127.0.0.1", p.local_port))
        s.sendall(b"\x16\x03\x01\x02\x00")
        s.settimeout(3)
        assert s.recv(10) == b""  # closed
    finally:
        p.stop()


def test_a_quiet_room_does_not_drop_the_game(monkeypatch):
    """The upstream socket kept its 15 s connect timeout, so a room silent for 15 s cut the game off."""
    got = threading.Event()

    def room(conn):
        time.sleep(1.5)  # longer than the (shortened) connect timeout below
        conn.sendall(_frame(0x1, b'[{"cmd":"PrintJSON","data":[]}]'))
        got.wait(5)

    host, port = _ws_server(room)
    p = dlproxy.DeathLinkProxy(host, port, free=1,
                               connect=lambda h, pt: roomfeed.WebSocket(h, pt, secure=False, timeout=0.5)).start()
    try:
        game = roomfeed.WebSocket("127.0.0.1", p.local_port, secure=False, timeout=0.5)
        assert game.sock.gettimeout() is None
        assert json.loads(game.recv_text())[0]["cmd"] == "PrintJSON"  # still connected after the silence
        got.set()
        game.close()
    finally:
        p.stop()
