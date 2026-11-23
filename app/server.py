"""Tiny local web server: the UI runs in the browser at http://127.0.0.1:PORT."""
import json
import os
import re
import subprocess
import sys
import threading
import uuid
import webbrowser
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

from . import host, install, recipes as rec, roomfeed, runner, steam, updates, window
from .paths import base_dir, data_dir, load_settings, players_dir, save_settings

TASKS = {}
RECIPES = {}
UPDATE = {}  # result of the last recipe update, shown once in the UI
FEED = {"feed": None}  # the room being watched (one at a time)


def parse_room(text: str, resolve=None) -> dict:
    """Accept the archipelago.gg room link (port looked up, room woken), 'archipelago.gg:38281',
    '/connect archipelago.gg:38281' or just the port."""
    text = (text or "").strip()
    if "archipelago.gg/room/" in text:
        return (resolve or roomfeed.resolve_room_link)(text)
    m = re.search(r"([A-Za-z0-9.\-]+):(\d{2,5})", text)
    if m:
        return {"host": m.group(1), "port": m.group(2)}
    m = re.fullmatch(r"\d{2,5}", text)
    if m:
        return {"host": "archipelago.gg", "port": text}
    raise ValueError("ما فهمت عنوان الروم. الصق رابط الروم من archipelago.gg، أو العنوان مثل archipelago.gg:38281")


def watch_room(room: dict, slot: str, password: str = ""):
    """Start (or restart) the read-only room watcher for the 📡 tab."""
    old = FEED["feed"]
    if old and (old.host, old.port, old.slot) == (room["host"], int(room["port"]), slot):
        return old
    if old:
        old.stop()
    FEED["feed"] = roomfeed.RoomFeed(room["host"], room["port"], slot, password, tracker=room.get("tracker", "")).start()
    return FEED["feed"]


def game_list():
    s = load_settings()
    out = []
    for r in sorted(RECIPES.values(), key=lambda r: r["name"].lower()):  # A to Z by the game's own name
        out.append({
            "id": r["id"], "name": r["name"], "name_ar": r.get("name_ar", r["name"]),
            "installed": bool(steam.game_dir(r["steam_appid"])) if r.get("steam_appid") else True,
            "verified": r.get("verified", False), "notes_ar": r.get("notes_ar", ""),
            "guide_ar": r.get("guide_ar", []), "checks_ar": r.get("checks_ar", ""), "checks_count_ar": r.get("checks_count_ar", ""), "avoid_ar": r.get("avoid_ar", []),
            "options": r.get("options", []),
            # the toggle is live when the apworld has the option or the mod itself has Death Link
            "death_link": bool(r.get("death_link_key", "death_link")) or bool(r.get("death_link_in_mod")),
            "ready": all(s["done_steps"].get(f"{r['id']}:{st['id']}") for st in r.get("install", [])
                         if st["type"] in ("manual", "workshop") and not st.get("every_time")),
        })
    return out


class Handler(BaseHTTPRequestHandler):
    def log_message(self, *a):
        pass

    def send(self, code, body, ctype="application/json"):
        data = body if isinstance(body, bytes) else json.dumps(body, ensure_ascii=False).encode("utf-8")
        self.send_response(code)
        self.send_header("Content-Type", ctype + "; charset=utf-8")
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def body(self):
        n = int(self.headers.get("Content-Length") or 0)
        return json.loads(self.rfile.read(n) or b"{}")

    def do_GET(self):
        if self.path in ("/", "/index.html"):
            return self.send(200, (base_dir() / "ui" / "index.html").read_bytes(), "text/html")
        if self.path == "/api/ping":  # the page says it is still open; also how a second copy finds this one
            window.ping()
            return self.send(200, {"app": "MyReadyAP"})
        if self.path == "/icon.png":
            return self.send(200, (base_dir() / "ui" / "icon.png").read_bytes(), "image/png")
        if self.path == "/api/state":
            s = load_settings()
            return self.send(200, {"player_name": s.get("player_name", ""), "games": game_list(),
                                   "players": host.scan_players(RECIPES),
                                   "last": s.get("last", {}), "update": UPDATE})
        if self.path.startswith("/api/feed"):
            since = int((re.search(r"since=(\d+)", self.path) or [0, 0])[1])
            f = FEED["feed"]
            return self.send(200, f.snapshot(since) if f else {"status": "off", "events": [], "progress": {}, "deaths": {}})
        if self.path.startswith("/api/task/"):
            t = TASKS.get(self.path.rsplit("/", 1)[1])
            return self.send(200 if t else 404, t.to_json() if t else {"error": "no task"})
        self.send(404, {"error": "not found"})

    def do_POST(self):
        # only accept requests from our own page (blocks other websites poking the local server)
        origin = self.headers.get("Origin")
        if origin and not re.fullmatch(r"http://(127\.0\.0\.1|localhost):\d+", origin):
            return self.send(403, {"error": "forbidden"})
        try:
            b = self.body()
            p = self.path
            if p == "/api/quit":  # a newer exe is installing itself over this one
                if SERVER["srv"]:
                    threading.Thread(target=SERVER["srv"].shutdown, daemon=True).start()
                return self.send(200, {})
            if p == "/api/open":  # links open in the player's own browser, not inside the app window
                if not re.match(r"(https?|steam)://", b.get("url", "")):
                    return self.send(400, {"error": "bad url"})
                webbrowser.open(b["url"])
                return self.send(200, {})
            if p == "/api/name":
                s = load_settings()
                s["player_name"] = rec.safe_slot(b["name"])
                save_settings(s)
                return self.send(200, {"name": s["player_name"]})
            if p == "/api/yaml":
                r = RECIPES[b["game"]]
                s = load_settings()
                text = rec.build_yaml(r, s.get("player_name") or "Player", b.get("options", {}),
                                      bool(b.get("death_link", True)), b.get("extra", ""))
                s.setdefault("last", {})[r["id"]] = {"options": b.get("options", {}),
                                                     "death_link": bool(b.get("death_link", True)),
                                                     "extra": b.get("extra", "")}
                s.setdefault("new_game", {})[r["id"]] = True  # a new YAML = a new multiworld: next Play takes a fresh save slot
                save_settings(s)
                out = data_dir() / "my_yaml" / f"{rec.safe_slot(s.get('player_name') or 'Player')}_{r['id']}.yaml"
                out.parent.mkdir(parents=True, exist_ok=True)
                out.write_text(text, encoding="utf-8")
                return self.send(200, {"yaml": text, "file": str(out)})
            if p == "/api/setup":
                t = runner.start(runner.run_phases, RECIPES[b["game"]], ["apworld", "install"])
                return self.send(200, {"task": self._keep(t)})
            if p == "/api/play":
                room = parse_room(b["room"])
                s = load_settings()
                session = {**room, "slot": rec.safe_slot(s.get("player_name") or "Player"),
                           "password": b.get("password", ""),
                           "death_link": s.get("last", {}).get(b["game"], {}).get("death_link", True)}
                t = runner.start(runner.run_phases, RECIPES[b["game"]], ["apworld", "install", "connect", "launch"], session)
                watch_room(room, session["slot"], session["password"])  # the 📡 tab follows the same room
                return self.send(200, {"task": self._keep(t)})
            if p == "/api/watch":
                s = load_settings()
                f = watch_room(parse_room(b["room"]), rec.safe_slot(s.get("player_name") or "Player"), b.get("password", ""))
                return self.send(200, {"ok": True, "room": f"{f.host}:{f.port}"})
            if p == "/api/watch/release":  # the UI asks twice before calling this
                if not FEED["feed"]:
                    raise ValueError("تابع الروم أول (اضغط العب أو تابع الروم)")
                FEED["feed"].say("!release")
                return self.send(200, {"ok": True})
            if p == "/api/watch/stop":
                if FEED["feed"]:
                    FEED["feed"].stop()
                FEED["feed"] = None
                return self.send(200, {"ok": True})
            if p == "/api/done":
                runner.mark_done(b["game"], b["step"])
                return self.send(200, {"ok": True})
            if p == "/api/host/generate":
                t = runner.start(host.generate, RECIPES)
                return self.send(200, {"task": self._keep(t)})
            if p == "/api/quit":  # a newer exe is installing itself over this one
                if SERVER["srv"]:
                    threading.Thread(target=SERVER["srv"].shutdown, daemon=True).start()
                return self.send(200, {})
            if p == "/api/open":
                folder = {"players": players_dir(), "mine": data_dir() / "my_yaml"}[b["what"]]
                folder.mkdir(parents=True, exist_ok=True)
                if sys.platform == "win32":
                    os.startfile(str(folder))  # noqa
                else:
                    subprocess.Popen(["xdg-open", str(folder)])
                return self.send(200, {"ok": True})
            self.send(404, {"error": "not found"})
        except (ValueError, KeyError, rec.RecipeError) as e:
            self.send(400, {"error": str(e)})

    def _keep(self, t):
        tid = uuid.uuid4().hex[:8]
        TASKS[tid] = t
        return tid


def reload_recipes():
    fresh = rec.load_all(extra=updates.remote_dir())
    RECIPES.clear()
    RECIPES.update(fresh)


def update_recipes_in_background():
    """New games from the owner's repo, without a new exe. Offline? Keep what we have."""
    def run():
        try:
            res = updates.update()
        except Exception:
            return
        if res["new"] or res["updated"]:
            reload_recipes()
            UPDATE.update(res)
    threading.Thread(target=run, daemon=True).start()


SERVER = {"srv": None, "window": None}


def main(open_browser=True, port=0):
    """open_browser: run as the app (own window, one copy at a time, quits when the window closes)."""
    frozen = getattr(sys, "frozen", False) and sys.platform == "win32"
    if open_browser and frozen and install.relocate():
        return  # this was the downloaded copy: the installed one (with desktop shortcut) is starting
    if open_browser:
        running = window.already_running()
        if running:  # double-clicked again: show the window of the copy that is already running
            window.open_window(running)
            return
    reload_recipes()
    update_recipes_in_background()
    srv = SERVER["srv"] = ThreadingHTTPServer(("127.0.0.1", port), Handler)
    url = f"http://127.0.0.1:{srv.server_address[1]}/"
    print("My Ready AP:", url)
    if open_browser:
        window.mark_running(url)
        if frozen:  # e.g. installing failed and it runs from Downloads: still give a shortcut
            threading.Thread(target=install.ensure_shortcuts, args=(sys.executable,), daemon=True).start()
        proc = SERVER["window"] = window.open_window(url)
        threading.Thread(target=window.wait_until_closed, args=(proc, srv.shutdown), daemon=True).start()
    try:
        srv.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        if open_browser:
            window.clear_running()
            w = SERVER.get("window")
            if w is not None and w.poll() is None:  # told to quit (a newer exe is installing): close our window too
                w.terminate()


if __name__ == "__main__":
    main()
