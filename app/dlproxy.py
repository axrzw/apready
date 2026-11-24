"""Free deaths for every game: a local relay between the game and the Archipelago server.

Only used when the player sets "free deaths" above 0 (and Death Link is on). Play then gives the game
127.0.0.1:<port> instead of the room's address. Everything passes through unchanged, both ways, except
the game's own Death Link messages: they are counted, and with N free deaths only every (N+1)th one is
sent on (N=2: deaths 1 and 2 stay home, the 3rd is sent, then again). Deaths sent TO the player are
never touched. With 0 free deaths none of this runs and the game connects straight to the room.
"""
import base64
import hashlib
import json
import socket
import ssl
import threading
import time

from . import roomfeed

PREFERRED_PORT = 47281  # a fixed port, so a game that remembers the last address keeps working
_GUID = b"258EAFA5-E914-47DA-95CA-C5AB0DC85B11"


class _Peer(roomfeed.WebSocket):
    """The game's side of the relay: we are the WebSocket server here (frames go out unmasked)."""

    def __init__(self, sock, buf: bytes):
        self.sock, self.buf, self.lock = sock, buf, threading.Lock()

    def _send_frame(self, opcode: int, payload: bytes):
        n = len(payload)
        head = bytes([0x80 | opcode])
        if n < 126:
            head += bytes([n])
        elif n < 65536:
            head += bytes([126]) + n.to_bytes(2, "big")
        else:
            head += bytes([127]) + n.to_bytes(8, "big")
        with self.lock:
            self.sock.sendall(head + payload)


def _upstream(host: str, port: int):
    last = None
    for secure in (True, False):  # archipelago.gg speaks wss; a local server usually plain ws
        try:
            return roomfeed.WebSocket(host, port, secure)
        except (OSError, ConnectionError, ssl.SSLError) as e:
            last = e
    raise ConnectionError(str(last))


class DeathLinkProxy:
    def __init__(self, host: str, port: int, free: int, on_death=None, connect=None):
        self.host, self.port, self.free = host, int(port), max(0, int(free))
        self.on_death = on_death or (lambda total, sent, cause="": None)
        self._connect = connect or _upstream
        self.deaths = 0          # this player's deaths seen in this session
        self.last_death_at = 0.0 # when the relay last saw one (to tell if a death came another way)
        self.sent = 0
        self.clients = 0         # games connected right now (keeps the app alive while > 0)
        self.lock = threading.Lock()
        self.stopped = threading.Event()
        self.srv = socket.socket()
        self.srv.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
        try:
            self.srv.bind(("127.0.0.1", PREFERRED_PORT))
        except OSError:
            self.srv.bind(("127.0.0.1", 0))
        self.srv.listen(4)
        self.local_port = self.srv.getsockname()[1]

    def start(self):
        threading.Thread(target=self._accept, daemon=True).start()
        return self

    def stop(self):
        self.stopped.set()
        try:
            self.srv.close()
        except OSError:
            pass

    def free_left(self) -> int:
        with self.lock:
            return self.free - (self.deaths % (self.free + 1)) if self.free else 0

    # -- relay --
    def _accept(self):
        while not self.stopped.is_set():
            try:
                conn, _ = self.srv.accept()
            except OSError:
                return
            threading.Thread(target=self._serve, args=(conn,), daemon=True).start()

    def _handshake(self, conn):
        conn.settimeout(15)
        head = b""
        while b"\r\n\r\n" not in head:
            chunk = conn.recv(4096)
            if not chunk or len(head) > 65536 or (not head and chunk[:1] == b"\x16"):  # TLS hello: not for us
                return None
            head += chunk
        req, rest = head.split(b"\r\n\r\n", 1)
        key = next((l.split(b":", 1)[1].strip() for l in req.split(b"\r\n")
                    if l.lower().startswith(b"sec-websocket-key:")), None)
        if not key:
            return None
        accept = base64.b64encode(hashlib.sha1(key + _GUID).digest())
        conn.sendall(b"HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\n"
                     b"Sec-WebSocket-Accept: " + accept + b"\r\n\r\n")
        conn.settimeout(None)
        return _Peer(conn, rest)

    def _serve(self, conn):
        game = up = None
        try:
            game = self._handshake(conn)
            if game is None:  # not a WebSocket (e.g. a TLS attempt): close so the game tries plain ws
                conn.close()
                return
            up = self._connect(self.host, self.port)
        except Exception:
            for s in (game, up):
                if s:
                    s.close()
            if game is None:
                try:
                    conn.close()
                except OSError:
                    pass
            return
        with self.lock:
            self.clients += 1
        done = threading.Event()

        def down():  # server -> game, untouched
            try:
                while not done.is_set():
                    game.send_text(up.recv_text())
            except Exception:
                pass
            done.set()
            game.close()

        threading.Thread(target=down, daemon=True).start()
        try:
            while not done.is_set():
                out = self.filter(game.recv_text())
                if out is not None:
                    up.send_text(out)
        except Exception:
            pass
        finally:
            done.set()
            up.close()
            game.close()
            with self.lock:
                self.clients -= 1

    def filter(self, text: str):
        """game -> server: hold back free deaths; everything else goes on as it came."""
        try:
            packets = json.loads(text)
        except ValueError:
            return text
        if not isinstance(packets, list):
            return text
        out, held = [], False
        for p in packets:
            if isinstance(p, dict) and p.get("cmd") == "Bounce" and "DeathLink" in (p.get("tags") or []):
                with self.lock:
                    self.deaths += 1
                    self.last_death_at = time.time()
                    send = self.deaths % (self.free + 1) == 0
                    if send:
                        self.sent += 1
                    total = self.deaths
                data = p.get("data") if isinstance(p.get("data"), dict) else {}
                cause = data.get("cause") if isinstance(data.get("cause"), str) else ""
                try:
                    self.on_death(total, send, cause)
                except Exception:
                    pass
                if not send:
                    held = True
                    continue
            out.append(p)
        if not held:
            return text  # nothing changed: pass the exact bytes on
        return json.dumps(out) if out else None


ACTIVE = {"proxy": None}


def start(host: str, port: int, free: int, on_death=None) -> DeathLinkProxy:
    """One relay at a time (one game per player). The same room and setting keep the running one."""
    old = ACTIVE["proxy"]
    if old and (old.host, old.port, old.free) == (host, int(port), int(free)) and not old.stopped.is_set():
        old.on_death = on_death or old.on_death
        return old
    if old:
        old.stop()
    ACTIVE["proxy"] = DeathLinkProxy(host, port, free, on_death).start()
    return ACTIVE["proxy"]


def stop():
    if ACTIVE["proxy"]:
        ACTIVE["proxy"].stop()
        ACTIVE["proxy"] = None


def status(my_death_heard_at: float = 0.0):
    """For the page: free deaths left, the address to type in the game, whether a game is connected
    through the relay, and whether a death of mine reached the room WITHOUT passing the relay (the game
    is connected straight to the room, so the free deaths can't work)."""
    p = ACTIVE["proxy"]
    if not p:
        return None
    bypass = bool(my_death_heard_at) and my_death_heard_at - p.last_death_at > 5
    return {"left": p.free_left(), "of": p.free, "address": f"127.0.0.1:{p.local_port}",
            "connected": p.clients > 0, "bypass": bypass}


def busy() -> bool:
    """A game is connected through the relay right now (closing the window must not cut it off)."""
    p = ACTIVE["proxy"]
    return bool(p and p.clients > 0)
