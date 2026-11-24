"""CI helper (not in the exe): a fake Archipelago room plus the free-deaths relay in front of it, so a real
.NET client (Archipelago.MultiClient.Net, what Terraria's and many BepInEx mods use) can log in through
the relay. Prints "RELAY <port>" and then everything the room receives, one JSON line each.
Run: python -m tools.relay_check_room
"""
import base64
import hashlib
import json
import socket
import struct
import sys
import threading
import time

from app import dlproxy, roomfeed

VERSION = {"major": 0, "minor": 6, "build": 0, "class": "Version"}


def _read_frame(conn):
    def rd(n):
        b = b""
        while len(b) < n:
            c = conn.recv(n - len(b))
            if not c:
                raise ConnectionError("closed")
            b += c
        return b
    b1, b2 = rd(2)
    n = b2 & 0x7F
    if n == 126:
        n = struct.unpack(">H", rd(2))[0]
    elif n == 127:
        n = struct.unpack(">Q", rd(8))[0]
    mask = rd(4) if b2 & 0x80 else None
    data = rd(n)
    if mask:
        data = bytes(x ^ mask[i % 4] for i, x in enumerate(data))
    return b1 & 0x0F, data


def _send(conn, packets):
    data = json.dumps(packets).encode()
    n = len(data)
    head = bytes([0x81]) + (bytes([n]) if n < 126 else bytes([126]) + struct.pack(">H", n) if n < 65536
                            else bytes([127]) + struct.pack(">Q", n))
    conn.sendall(head + data)


def serve(conn):
    req = b""
    while b"\r\n\r\n" not in req:
        req += conn.recv(4096)
    key = [l.split(b":", 1)[1].strip() for l in req.split(b"\r\n") if l.lower().startswith(b"sec-websocket-key")][0]
    acc = base64.b64encode(hashlib.sha1(key + b"258EAFA5-E914-47DA-95CA-C5AB0DC85B11").digest())
    conn.sendall(b"HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\n"
                 b"Sec-WebSocket-Accept: " + acc + b"\r\n\r\n")
    _send(conn, [{"cmd": "RoomInfo", "version": VERSION, "generator_version": VERSION, "tags": ["AP"],
                  "password": False, "permissions": {"release": 2, "collect": 2, "remaining": 2},
                  "hint_cost": 10, "location_check_points": 1, "games": ["Terraria"],
                  "datapackage_checksums": {"Terraria": "abc"}, "seed_name": "CI", "time": time.time()}])
    while True:
        op, data = _read_frame(conn)
        if op == 0x8:
            return
        if op == 0x9:
            conn.sendall(bytes([0x8A, len(data)]) + data)
            continue
        if op != 0x1:
            continue
        for p in json.loads(data):
            print(json.dumps(p), flush=True)
            if p.get("cmd") == "GetDataPackage":
                _send(conn, [{"cmd": "DataPackage", "data": {"games": {"Terraria": {
                    "item_name_to_id": {"Reward: Coins": 1}, "location_name_to_id": {"Timber!!": 1}, "checksum": "abc"}}}}])
            elif p.get("cmd") == "Connect":
                _send(conn, [{"cmd": "Connected", "team": 0, "slot": 1,
                              "players": [{"team": 0, "slot": 1, "alias": p["name"], "name": p["name"]}],
                              "missing_locations": [1], "checked_locations": [],
                              "slot_data": {"goal": ["Mechanical Bosses"], "deathlink": True, "randomize_npcs": []},
                              "slot_info": {"1": {"name": p["name"], "game": "Terraria", "type": 1, "group_members": []}},
                              "hint_points": 0}])
            elif p.get("cmd") == "Bounce":
                _send(conn, [{"cmd": "Bounced", **{k: v for k, v in p.items() if k != "cmd"}}])


def main():
    srv = socket.socket()
    srv.bind(("127.0.0.1", 0))
    srv.listen(4)
    port = srv.getsockname()[1]

    def accept():
        while True:
            c, _ = srv.accept()
            threading.Thread(target=serve, args=(c,), daemon=True).start()
    threading.Thread(target=accept, daemon=True).start()
    free = int(sys.argv[1]) if len(sys.argv) > 1 else 2
    relay = dlproxy.DeathLinkProxy("127.0.0.1", port, free,
                                   connect=lambda h, p: roomfeed.WebSocket(h, p, secure=False)).start()
    print(f"RELAY {relay.local_port}", flush=True)
    while True:
        time.sleep(1)


if __name__ == "__main__":
    main()
