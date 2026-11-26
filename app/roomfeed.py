"""Watch a room: a read-only Archipelago client that shows everything that happens.

It logs in to the player's own slot as a "TextOnly" client (like Archipelago's Text Client),
so it never plays, never sends checks and never sends a death. With the DeathLink tag it also
*hears* deaths. Everything the server prints (items sent, hints, joins, goals, chat) and every
death goes into a list the UI polls.

The WebSocket client is written with the standard library only (no third-party packages),
so the exe stays small. Archipelago rooms answer on wss:// first and ws:// as a fallback.
"""
import base64
import json
import os
import re
import socket
import ssl
import struct
import threading
import time
import urllib.request
import uuid
from pathlib import Path

AP_VERSION = {"major": 0, "minor": 6, "build": 0, "class": "Version"}
FLAG_PROGRESSION, FLAG_USEFUL, FLAG_TRAP = 1, 2, 4


# ---------- archipelago.gg room links ----------

WEBHOST = "https://archipelago.gg"
SHARE_TAG = "MyReadyAP"  # Bounce tag My Ready AP apps use to share real death counts (free deaths included)
ROOM_LINK = re.compile(r"archipelago\.gg/room/([A-Za-z0-9_\-]+)")


def _get_json(url: str):
    req = urllib.request.Request(url, headers={"User-Agent": "APReady", "Accept": "application/json"})
    with urllib.request.urlopen(req, timeout=20) as r:
        return json.loads(r.read().decode("utf-8"))


def resolve_room_link(text: str, get_json=_get_json, wake=None):
    """'https://archipelago.gg/room/<id>' -> {host, port, room, tracker}. Opening the room page wakes
    a sleeping room (it gets a new port), so friends never have to look for the port."""
    m = ROOM_LINK.search(text or "")
    if not m:
        return None
    room = m.group(1)
    (wake or (lambda u: urllib.request.urlopen(urllib.request.Request(u, headers={"User-Agent": "APReady"}), timeout=20).read()))(
        f"{WEBHOST}/room/{room}")
    status = {}
    for _ in range(10):  # the room needs a moment to start after being woken
        status = get_json(f"{WEBHOST}/api/room_status/{room}")
        if status.get("last_port"):
            break
        time.sleep(1)
    if not status.get("last_port"):
        raise ConnectionError("الروم ما اشتغل. افتح رابطه في المتصفح وجرب مرة ثانية")
    tracker = str(status.get("tracker", "")).rstrip("/").split("/")[-1]
    return {"host": "archipelago.gg", "port": str(status["last_port"]), "room": room, "tracker": tracker}


# ---------- a minimal WebSocket client (RFC 6455) ----------

class WebSocket:
    def __init__(self, host: str, port: int, secure: bool, timeout: float = 15):
        raw = socket.create_connection((host, port), timeout=timeout)
        if secure:
            raw = ssl.create_default_context().wrap_socket(raw, server_hostname=host)
        self.sock = raw
        key = base64.b64encode(os.urandom(16)).decode()
        req = (f"GET / HTTP/1.1\r\nHost: {host}:{port}\r\nUpgrade: websocket\r\nConnection: Upgrade\r\n"
               f"Sec-WebSocket-Key: {key}\r\nSec-WebSocket-Version: 13\r\nUser-Agent: APReady\r\n\r\n")
        self.sock.sendall(req.encode())
        head = b""
        while b"\r\n\r\n" not in head:
            chunk = self.sock.recv(4096)
            if not chunk:
                raise ConnectionError("closed during handshake")
            head += chunk
        status = head.split(b"\r\n", 1)[0]
        if b" 101 " not in status + b" ":
            raise ConnectionError(f"handshake refused: {status.decode(errors='replace')}")
        self.buf = head.split(b"\r\n\r\n", 1)[1]
        self.lock = threading.Lock()
        # the timeout was only for connecting: a room can stay silent for minutes (no pings), and a read
        # that times out would drop the connection (the free-deaths relay then cut the game off)
        self.sock.settimeout(None)

    def _read(self, n: int) -> bytes:
        while len(self.buf) < n:
            chunk = self.sock.recv(65536)
            if not chunk:
                raise ConnectionError("connection closed")
            self.buf += chunk
        out, self.buf = self.buf[:n], self.buf[n:]
        return out

    def _send_frame(self, opcode: int, payload: bytes):
        head = bytes([0x80 | opcode])
        n = len(payload)
        if n < 126:
            head += bytes([0x80 | n])
        elif n < 65536:
            head += bytes([0x80 | 126]) + struct.pack(">H", n)
        else:
            head += bytes([0x80 | 127]) + struct.pack(">Q", n)
        mask = os.urandom(4)
        masked = bytes(b ^ mask[i % 4] for i, b in enumerate(payload))
        with self.lock:
            self.sock.sendall(head + mask + masked)

    def send_text(self, text: str):
        self._send_frame(0x1, text.encode("utf-8"))

    def recv_text(self) -> str:
        """Next text message; answers pings, joins fragments, raises on close."""
        parts, kind = [], None
        while True:
            b1, b2 = self._read(2)
            fin, opcode = b1 & 0x80, b1 & 0x0F
            n = b2 & 0x7F
            if n == 126:
                n = struct.unpack(">H", self._read(2))[0]
            elif n == 127:
                n = struct.unpack(">Q", self._read(8))[0]
            mask = self._read(4) if b2 & 0x80 else None
            data = self._read(n)
            if mask:
                data = bytes(b ^ mask[i % 4] for i, b in enumerate(data))
            if opcode == 0x9:  # ping
                self._send_frame(0xA, data)
                continue
            if opcode == 0xA:  # pong
                continue
            if opcode == 0x8:
                raise ConnectionError("server closed the connection")
            if opcode in (0x1, 0x2):
                kind, parts = opcode, [data]
            elif opcode == 0x0:
                parts.append(data)
            if fin and kind is not None:
                return b"".join(parts).decode("utf-8", "replace")

    def close(self):
        try:
            self._send_frame(0x8, b"")
        except OSError:
            pass
        try:
            self.sock.close()
        except OSError:
            pass


def death_text(who: str, cause: str = "", free: bool = False) -> str:
    """One line for the log: who died, and how when the game says (Death Link's "cause")."""
    head = f"🛟 {who} مات (موتة مجانية، ما انرسلت للشباب)" if free else f"☠ {who} مات"
    cause = " ".join((cause or "").split())[:200]
    return head + (f": {cause}" if cause else "")


# ---------- the room feed ----------

class RoomFeed:
    """One watched room. Thread-safe; the UI reads snapshot(since)."""

    def __init__(self, host: str, port: int, slot: str, password: str = "", connect=None, tracker: str = "",
                 get_json=_get_json, store=None):
        self.host, self.port, self.slot, self.password = host, int(port), slot, password or ""
        self.tracker, self._get_json = tracker, get_json
        self.progress = {}        # player name -> {"done", "total", "goal"}
        self.my_checked = self.my_missing = None
        self._connect = connect or self._open
        self.events = []
        self.seq = 0              # event number, keeps growing even when old events are dropped
        self.deaths = {}          # player name -> deaths heard (Death Link messages that reached the room)
        self.real = {}            # player name -> real total shared by My Ready AP (free deaths included)
        self.seed = None          # this multiworld (the counts are kept per seed, across restarts)
        self.store = store        # JSON file for the counts, or None
        self.my_death_heard_at = 0.0  # last Death Link from my own slot that reached the room
        self._announced = False
        self.team = 0
        self.hint_cost = 0          # % of my locations a hint costs (RoomInfo)
        self.hint_points = None     # my points (Connected / RoomUpdate)
        self.hints = []             # raw hint dicts from the room's data storage (_read_hints_<team>_<slot>)
        self.status = "connecting"
        self.error = ""
        # is MY GAME (not this watcher) connected to the room? From the server's Join/Part lines for my slot:
        # "unknown" until one is seen (the game may have connected before this watcher), then "playing"/"lost"
        self.game_clients = 0
        self.game_state = "unknown"
        self.game_since = 0.0
        self.my_slot = None
        self.players = {}         # slot number -> name
        self.games = {}           # slot number -> game
        self.items = {}           # game -> {id: name}
        self.locations = {}       # game -> {id: name}
        self.lock = threading.Lock()
        self.stop_flag = threading.Event()
        self.ws = None

    # -- lifecycle --
    def start(self):
        threading.Thread(target=self._run, daemon=True).start()
        if self.tracker:
            threading.Thread(target=self._track, daemon=True).start()
        return self

    def _track(self):
        """Everyone's progress from the archipelago.gg tracker (checks done / total, goal)."""
        totals = {}
        while not self.stop_flag.is_set():
            try:
                if not totals:
                    st = self._get_json(f"{WEBHOST}/api/static_tracker/{self.tracker}")
                    totals = {(t["team"], t["player"]): t["total_locations"] for t in st.get("player_locations_total", [])}
                tr = self._get_json(f"{WEBHOST}/api/tracker/{self.tracker}")
                names = {(a["team"], a["player"]): a.get("alias") for a in tr.get("aliases", [])}
                goal = {(x["team"], x["player"]): x.get("status") == 30 for x in tr.get("player_status", [])}  # 30 = goal done
                prog = {}
                for c in tr.get("player_checks_done", []):
                    k = (c["team"], c["player"])
                    name = names.get(k) or self.players.get(c["player"]) or f"Player {c['player']}"
                    prog[name] = {"done": len(c.get("locations", [])), "total": totals.get(k, 0), "goal": goal.get(k, False)}
                with self.lock:
                    self.progress = prog
            except Exception:
                pass  # tracker hiccup: keep the last numbers
            if self.stop_flag.wait(30):
                return

    def say(self, text: str):
        """Send a chat / server command (e.g. !release) as this slot."""
        if self.status != "connected" or not self.ws:
            raise ConnectionError("مو متصل بالروم للحين")
        self._send({"cmd": "Say", "text": text})
        self._add("sent", text)

    def stop(self):
        self.stop_flag.set()
        if self.ws:
            self.ws.close()

    def _open(self):
        last = None
        for secure in (True, False):
            try:
                return WebSocket(self.host, self.port, secure)
            except (OSError, ConnectionError, ssl.SSLError) as e:
                last = e
        raise ConnectionError(str(last))

    def _run(self):
        delay = 2
        while not self.stop_flag.is_set():
            try:
                self.status = "connecting"
                self.ws = self._connect()
                delay = 2
                self._session()
            except Exception as e:  # network drop, room asleep, refused login...
                self.error = str(e)
                if self.status == "refused":
                    return
                self.status = "reconnecting"
            if self.stop_flag.wait(delay):
                return
            delay = min(delay * 2, 30)

    # -- protocol --
    def _send(self, *packets):
        self.ws.send_text(json.dumps(list(packets)))

    def _session(self):
        while not self.stop_flag.is_set():
            for p in json.loads(self.ws.recv_text()):
                self._handle(p)

    # -- death counter (kept per multiworld; shared between My Ready AP users) --
    def _load_counts(self):
        if not self.store or not self.seed:
            return
        try:
            saved = json.loads(Path(self.store).read_text(encoding="utf-8")).get(self.seed, {})
        except (OSError, ValueError, AttributeError):
            return
        with self.lock:
            for field in ("deaths", "real"):
                mine = getattr(self, field)
                for k, v in (saved.get(field) or {}).items():
                    if isinstance(k, str) and isinstance(v, int):
                        mine[k] = max(mine.get(k, 0), v)

    def _save_counts(self):
        if not self.store or not self.seed:
            return
        try:
            try:
                data = json.loads(Path(self.store).read_text(encoding="utf-8"))
            except (OSError, ValueError):
                data = {}
            with self.lock:
                data[self.seed] = {"deaths": dict(self.deaths), "real": dict(self.real)}
            for old in list(data)[:-20]:  # keep the last 20 multiworlds
                data.pop(old)
            Path(self.store).write_text(json.dumps(data, ensure_ascii=False), encoding="utf-8")
        except OSError:
            pass

    def death_counts(self) -> dict:
        with self.lock:
            names = set(self.deaths) | set(self.real)
            counts = {n: max(self.deaths.get(n, 0), self.real.get(n, 0)) for n in names}
        return dict(sorted(counts.items(), key=lambda kv: -kv[1]))

    def record_my_death(self, sent: bool = True, cause: str = ""):
        """The relay saw this player die (sent on or kept as a free death): count it and tell the others.
        A free death never reaches the room as Death Link, so it is logged here and shared with the
        other My Ready AP apps, cause included, so their logs show it too."""
        with self.lock:
            self.real[self.slot] = max(self.real.get(self.slot, 0), self.deaths.get(self.slot, 0)) + 1
        self._save_counts()
        if not sent:
            self._add("death", death_text(self.slot, cause, free=True), who=self.slot)
            self._bounce_share({"kind": "death", "source": self.slot, "cause": (cause or "")[:200], "free": True})
        self._share_mine()

    def _bounce_share(self, data: dict):
        if self.status != "connected" or not self.ws:
            return
        try:
            self._send({"cmd": "Bounce", "tags": [SHARE_TAG], "data": data})
        except Exception:
            pass

    def _share_mine(self):
        n = self.real.get(self.slot)
        if n is None or self.status != "connected" or not self.ws:
            return
        try:
            self._send({"cmd": "Bounce", "tags": [SHARE_TAG], "data": {"kind": "deaths", "source": self.slot, "deaths": n}})
        except Exception:
            pass

    def _shared(self, d: dict):
        if d.get("kind") == "deaths?":
            self._share_mine()
            return
        if d.get("kind") == "death":  # another player's free death (it never reached the room as Death Link)
            who, cause = d.get("source"), d.get("cause") or ""
            if isinstance(who, str) and 0 < len(who) <= 32 and who != self.slot and isinstance(cause, str):
                self._add("death", death_text(who, cause[:200], free=True), who=who)
            return
        who, n = d.get("source"), d.get("deaths")
        if d.get("kind") != "deaths" or not isinstance(who, str) or not 0 < len(who) <= 32 \
                or not isinstance(n, int) or isinstance(n, bool) or not 0 <= n <= 100000 or who == self.slot:
            return  # from another player's app: only well-formed numbers, and nobody speaks for me
        with self.lock:
            self.real[who] = max(self.real.get(who, 0), n)
        self._save_counts()

    def _handle(self, p: dict):
        cmd = p.get("cmd")
        if cmd == "RoomInfo":
            if isinstance(p.get("hint_cost"), int):
                self.hint_cost = p["hint_cost"]
            if p.get("seed_name") and p.get("seed_name") != self.seed:
                self.seed = str(p["seed_name"])
                self._load_counts()
            self._send({"cmd": "GetDataPackage", "games": p.get("games", [])})
            self._send({"cmd": "Connect", "password": self.password, "game": "", "name": self.slot,
                        "uuid": uuid.uuid4().hex, "version": AP_VERSION, "items_handling": 0,
                        "tags": ["TextOnly", "DeathLink", SHARE_TAG], "slot_data": False})
        elif cmd == "DataPackage":
            for game, pkg in p.get("data", {}).get("games", {}).items():
                self.items[game] = {v: k for k, v in pkg.get("item_name_to_id", {}).items()}
                self.locations[game] = {v: k for k, v in pkg.get("location_name_to_id", {}).items()}
        elif cmd == "Connected":
            self.my_slot = p.get("slot")
            self.team = p.get("team", 0)
            if isinstance(p.get("hint_points"), int):
                self.hint_points = p["hint_points"]
            self.my_checked = set(p.get("checked_locations", []))
            self.my_missing = set(p.get("missing_locations", []))
            for pl in p.get("players", []):
                self.players[pl["slot"]] = pl.get("alias") or pl.get("name")
            for s, info in p.get("slot_info", {}).items():
                self.games[int(s)] = info.get("game", "")
            self.status = "connected"
            self.error = ""
            if not self._announced:  # once; a quiet reconnect is not news
                self._announced = True
                self._add("system", "✔ متصل بالروم")
            # every hint about my items or my world, kept up to date by the room (data storage)
            self._send({"cmd": "Get", "keys": [self._hint_key()]}, {"cmd": "SetNotify", "keys": [self._hint_key()]})
            self._share_mine()  # my real count, and ask the other apps for theirs
            self._send({"cmd": "Bounce", "tags": [SHARE_TAG], "data": {"kind": "deaths?"}})
        elif cmd == "ConnectionRefused":
            self.status = "refused"
            self.error = ", ".join(p.get("errors", [])) or "refused"
            self._add("system", "✖ الروم رفض الاتصال: " + self.error)
            raise ConnectionError(self.error)
        elif cmd == "Retrieved" and isinstance(p.get("keys"), dict) and self._hint_key() in p["keys"]:
            self._set_hints(p["keys"][self._hint_key()])
        elif cmd == "SetReply" and p.get("key") == self._hint_key():
            self._set_hints(p.get("value"))
        elif cmd == "RoomUpdate" and isinstance(p.get("hint_points"), int):
            self.hint_points = p["hint_points"]
            if self.my_checked is not None:
                new = set(p.get("checked_locations", []))
                self.my_checked |= new
                self.my_missing -= new
        elif cmd == "RoomUpdate" and self.my_checked is not None:
            new = set(p.get("checked_locations", []))
            self.my_checked |= new
            self.my_missing -= new
        elif cmd == "PrintJSON":
            self._print(p)
        elif cmd == "Bounced" and "DeathLink" in p.get("tags", []):
            d = p.get("data", {})
            who = d.get("source") or "؟"
            with self.lock:
                self.deaths[who] = self.deaths.get(who, 0) + 1
                if who == self.slot:
                    self.my_death_heard_at = time.time()
            self._save_counts()
            cause = d.get("cause") if isinstance(d.get("cause"), str) else ""
            self._add("death", death_text(who, cause), who=who)
        elif cmd == "Bounced" and SHARE_TAG in p.get("tags", []) and isinstance(p.get("data"), dict):
            self._shared(p["data"])

    # -- rendering --
    def _name(self, slot) -> str:
        try:
            return self.players.get(int(slot), f"Player {slot}")
        except (TypeError, ValueError):
            return str(slot)

    def _item_name(self, item_id, owner_slot) -> str:
        game = self.games.get(int(owner_slot), "") if owner_slot is not None else ""
        return self.items.get(game, {}).get(int(item_id), f"Item {item_id}")

    def _location_name(self, loc_id, owner_slot) -> str:
        game = self.games.get(int(owner_slot), "") if owner_slot is not None else ""
        return self.locations.get(game, {}).get(int(loc_id), f"Location {loc_id}")

    def _text(self, parts: list) -> str:
        out = []
        for part in parts:
            t = part.get("type", "text")
            v = part.get("text", "")
            if t in ("player_id",):
                out.append(self._name(v))
            elif t == "item_id":
                out.append(self._item_name(v, part.get("player")))
            elif t == "location_id":
                out.append(self._location_name(v, part.get("player")))
            else:
                out.append(str(v))
        return "".join(out)

    # server chatter nobody needs in the log: clients joining/leaving (every app reconnect too), tag
    # changes, the server's tutorial line
    NOISE = {"Join", "Part", "TagsChanged", "Tutorial"}

    # clients that are not the game: this watcher (TextOnly), trackers (PopTracker), hint clients
    NOT_GAME = {"TextOnly", "Tracker", "HintGame"}

    def _game_link(self, p: dict):
        """Join/Part for my slot: is my game connected? Part carries no tags, but its text says
        "has left the game" for a game and "has stopped viewing/tracking/hinting" for the rest."""
        if p.get("slot") != self.my_slot or self.my_slot is None:
            return
        text = "".join(str(x.get("text", "")) for x in p.get("data", []) if isinstance(x, dict))
        if p.get("type") == "Join":
            tags = set(p.get("tags") or [])
            if tags & self.NOT_GAME or " playing " not in f" {text} ":
                return
            self.game_clients += 1
            if self.game_state != "playing":
                self.game_state, self.game_since = "playing", time.time()
                self._add("conn", "لعبتك اتصلت بالروم", state="playing")
        elif p.get("type") == "Part" and "has left the game" in text:
            self.game_clients = max(0, self.game_clients - 1)
            if self.game_clients == 0 and self.game_state != "lost":
                self.game_state, self.game_since = "lost", time.time()
                self._add("conn", "لعبتك انفصلت عن الروم", state="lost")

    def _print(self, p: dict):
        if p.get("type") in ("Join", "Part"):
            self._game_link(p)
        if p.get("type") in self.NOISE:
            return
        text = self._text(p.get("data", []))
        kind = {"ItemSend": "item", "ItemCheat": "item", "Hint": "hint", "Join": "join", "Part": "join",
                "Chat": "chat", "ServerChat": "chat", "Goal": "goal", "Release": "goal", "Collect": "goal",
                "Countdown": "system", "Tutorial": "system", "CommandResult": "cmd",
                "AdminCommandResult": "cmd"}.get(p.get("type"), "system")
        extra = {}
        if p.get("type") == "Hint" and isinstance(p.get("item"), dict):  # a hint that concerns me pops up in the page
            finder, receiver = p["item"].get("player"), p.get("receiving")
            extra = {"to_me": receiver == self.my_slot, "from_me": finder == self.my_slot and receiver != self.my_slot,
                     "found": bool(p.get("found")), "sender": self._name(finder), "receiver": self._name(receiver),
                     "flags": p["item"].get("flags", 0),
                     "item": self._item_name(p["item"].get("item"), receiver),
                     "location": self._location_name(p["item"].get("location"), finder)}
        if p.get("type") in ("ItemSend", "ItemCheat") and isinstance(p.get("item"), dict):
            it = p["item"]
            sender, receiver = it.get("player"), p.get("receiving")
            extra = {"sender": self._name(sender), "receiver": self._name(receiver),
                     "flags": it.get("flags", 0),
                     "to_me": receiver == self.my_slot, "from_me": sender == self.my_slot,
                     # the parts on their own, so the page can say it in Arabic
                     "item": self._item_name(it.get("item"), receiver), "location": self._location_name(it.get("location"), sender)}
        self._add(kind, text, **extra)

    def _add(self, kind: str, text: str, **extra):
        with self.lock:
            self.events.append({"i": self.seq, "t": time.strftime("%H:%M:%S"), "kind": kind, "text": text, **extra})
            self.seq += 1
            if len(self.events) > 5000:  # keep memory bounded in long sessions
                drop = len(self.events) - 5000
                self.events = self.events[drop:]

    def snapshot(self, since: int = 0) -> dict:
        snap = self._snapshot(since)
        snap["deaths"] = self.death_counts()
        snap["hints"] = self.hint_view()
        snap["trackers"] = self.trackers()
        snap["game"] = self.my_game()
        return snap

    # -- hints --
    def _hint_key(self) -> str:
        return f"_read_hints_{self.team}_{self.my_slot}"

    def _set_hints(self, value):
        if isinstance(value, list):
            with self.lock:
                self.hints = [h for h in value if isinstance(h, dict)]

    def hint_view(self) -> dict:
        """Hints in plain words: where my items are, and what in my world belongs to the others."""
        def item_name(h):
            g = self.games.get(h.get("receiving_player"), "")
            return self.items.get(g, {}).get(h.get("item"), f"Item {h.get('item')}")

        def loc_name(h):
            g = self.games.get(h.get("finding_player"), "")
            return self.locations.get(g, {}).get(h.get("location"), f"Location {h.get('location')}")
        with self.lock:
            hints = list(self.hints)
        mine, theirs = [], []
        for h in hints:
            row = {"item": item_name(h), "location": loc_name(h), "found": bool(h.get("found")),
                   "finder": self._name(h.get("finding_player")), "receiver": self._name(h.get("receiving_player")),
                   "entrance": h.get("entrance") or "", "important": bool((h.get("item_flags") or 0) & 1)}
            if h.get("receiving_player") == self.my_slot:
                mine.append(row)
            if h.get("finding_player") == self.my_slot and h.get("receiving_player") != self.my_slot:
                theirs.append(row)
        order = lambda r: (r["found"], not r["important"], r["item"])
        total = (len(self.my_checked) + len(self.my_missing)) if self.my_checked is not None else 0
        cost = max(1, int(self.hint_cost * 0.01 * total)) if self.hint_cost and total else None
        return {"mine": sorted(mine, key=order), "theirs": sorted(theirs, key=order),
                "points": self.hint_points, "cost": cost}

    def trackers(self) -> dict:
        """archipelago.gg's own tracker pages for this room: mine and everyone's."""
        if not self.tracker or self.my_slot is None:
            return {}
        return {"mine": f"{WEBHOST}/tracker/{self.tracker}/{self.team}/{self.my_slot}",
                "all": f"{WEBHOST}/tracker/{self.tracker}"}

    def my_game(self) -> str:
        return self.games.get(self.my_slot, "")

    def hint_items(self) -> list:
        """Names of my game's items, for the hint box's suggestions."""
        g = self.games.get(self.my_slot, "")
        return sorted(self.items.get(g, {}).values())

    def _snapshot(self, since: int = 0) -> dict:
        with self.lock:
            ev = [e for e in self.events if e["i"] >= since]
            mine = None
            if self.my_checked is not None:
                total = len(self.my_checked) + len(self.my_missing)
                mine = {"done": len(self.my_checked), "total": total}
            progress = dict(self.progress)
            if not progress and mine and self.my_slot is not None:  # not on archipelago.gg: at least my own
                progress = {self._name(self.my_slot): dict(mine, goal=False)}
            return {"status": self.status, "error": self.error, "events": ev, "progress": progress, "me": self.slot,
                    "game_link": {"state": self.game_state, "since": self.game_since},
                    "deaths": None,
                    "room": f"{self.host}:{self.port}", "slot": self.slot}
