"""Tiny local web server: the UI runs in the browser at http://127.0.0.1:PORT."""
import json
import os
import re
import subprocess
import sys
import threading
import time
import uuid
import webbrowser
from pathlib import Path
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

from ._version import VERSION
from . import groupcheck, stores, dlproxy, host, install, maptracker, recipes as rec, roomfeed, runner, steam, updates, window
from .paths import base_dir, data_dir, load_settings, players_dir, save_settings

TASKS = {}
RECIPES = {}
UPDATE = {}  # result of the last recipe update, shown once in the UI
RECIPES_REV = {"n": 0}  # goes up when the recipes change, so the open page can redraw
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


def _room_moved(old: int, new: int):
    """The room came back on another port: the free-deaths relay sends the next game connection there."""
    p = dlproxy.ACTIVE["proxy"]
    if p and p.port == int(old):
        p.port = int(new)


def watch_room(room: dict, slot: str, password: str = ""):
    """Start (or restart) the read-only room watcher for the 📡 tab."""
    old = FEED["feed"]
    if old and (old.host, old.port, old.slot) == (room["host"], int(room["port"]), slot):
        return old
    if old:
        old.stop()
    FEED["feed"] = roomfeed.RoomFeed(room["host"], room["port"], slot, password, tracker=room.get("tracker", ""),
                                     store=data_dir() / "deaths.json", room_id=room.get("room", ""),
                                     on_port=_room_moved).start()
    return FEED["feed"]


def game_list():
    s = load_settings()
    out = []
    for r in sorted(RECIPES.values(), key=lambda r: r["name"].lower()):  # A to Z by the game's own name
        loc = stores.locate(r, s)
        out.append({
            "id": r["id"], "name": r["name"], "name_ar": r.get("name_ar", r["name"]),
            "installed": bool(loc) or not stores.stores(r),
            "store": loc["store"] if loc else "", "stores": stores.stores(r),
            "steam": bool(r.get("steam_appid")),  # Minecraft: not a Steam game
            # the page's art (official store images) and library filters
            "steam_appid": r.get("steam_appid"), "art_appid": r.get("art_appid"),
            "length": r.get("length", ""), "genres": r.get("genres", []), "beginner": bool(r.get("beginner")),
            "tips_ar": r.get("tips_ar", []), "dl_fit": r.get("dl_fit"), "dl_fit_ar": r.get("dl_fit_ar", ""),
            "verified": r.get("verified", False), "notes_ar": r.get("notes_ar", ""),
            "guide_ar": r.get("guide_ar", []), "checks_ar": r.get("checks_ar", ""), "checks_count_ar": r.get("checks_count_ar", ""), "avoid_ar": r.get("avoid_ar", []),
            "options": r.get("options", []), "game": r.get("game", ""), "has_map": bool(r.get("map_tracker")),
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
            f, relay = FEED["feed"], dlproxy.ACTIVE["proxy"]
            return self.send(200, {"app": "MyReadyAP", "version": VERSION, "recipes": RECIPES_REV["n"],
                                   "app_update": APP_UPDATE.get("tag", ""), "mod_check": dict(MOD_CHECK),
                                   "deaths": f.death_counts() if f else {}, "me": f.slot if f else "",
                                   "free": dlproxy.status(f.my_death_heard_at if f else 0.0) if relay else None})
        if self.path == "/icon.png":
            return self.send(200, (base_dir() / "ui" / "icon.png").read_bytes(), "image/png")
        if self.path == "/api/state":
            s = load_settings()
            players = host.scan_players(RECIPES)
            return self.send(200, {"player_name": s.get("player_name", ""), "games": game_list(), "version": VERSION,
                                   "players": players, "group": groupcheck.check(players, RECIPES),
                                   "last": s.get("last", {}), "update": UPDATE,
                                   "recipes_rev": RECIPES_REV["n"]})
        if self.path.startswith("/api/feed"):
            since = int((re.search(r"since=(\d+)", self.path) or [0, 0])[1])
            f = FEED["feed"]
            return self.send(200, f.snapshot(since) if f else {"status": "off", "events": [], "progress": {}, "deaths": {}})
        if self.path == "/api/report":  # «وش خرب؟»: one text to paste in Discord (never passwords)
            return self.send(200, {"text": problem_report()})
        if self.path == "/api/hint_items":  # my game's item names, for the hint box's suggestions
            f = FEED["feed"]
            return self.send(200, {"items": f.hint_items() if f else []})
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
            if p == "/api/link":  # links open in the player's own browser, not inside the app window
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
                r = RECIPES[b["game"]]
                t = runner.start(runner.run_phases, r, ["apworld", "install"], None, _options(r, b))
                return self.send(200, {"task": self._keep(t)})
            if p == "/api/play":
                room = parse_room(b["room"])
                s = load_settings()
                session = {**room, "slot": rec.safe_slot(s.get("player_name") or "Player"),
                           "password": b.get("password", ""),
                           "death_link": s.get("last", {}).get(b["game"], {}).get("death_link", True)}
                r = RECIPES[b["game"]]
                watch_room(room, session["slot"], session["password"])  # the 📡 tab follows the same room
                free = _free_deaths(r, b, session["death_link"])
                if free:  # the game talks to our relay, which holds back the free deaths (app/dlproxy.py)
                    relay = dlproxy.start(room["host"], room["port"], free, on_death=_my_death)
                    session = {**session, "host": "127.0.0.1", "port": str(relay.local_port)}
                else:
                    dlproxy.stop()
                t = runner.start(runner.run_phases, r, ["apworld", "install", "connect", "launch"], session,
                                 _options(r, b, yaml_first=True))
                threading.Thread(target=watch_mod_load, args=(r, time.time()), daemon=True).start()
                return self.send(200, {"task": self._keep(t)})
            if p == "/api/app_update":  # start the downloaded exe: it closes this copy, installs itself, opens again
                path = APP_UPDATE.get("path")
                if not path or not Path(path).exists():
                    raise ValueError("ما فيه تحديث جاهز")
                env = {k: v for k, v in os.environ.items() if not k.startswith("_PYI") and k != "_MEIPASS2"}
                env["PYINSTALLER_RESET_ENVIRONMENT"] = "1"
                subprocess.Popen([path], cwd=str(Path(path).parent), env=env, close_fds=True,
                                 creationflags=0x00000008 if os.name == "nt" else 0)
                return self.send(200, {"ok": True})
            if p == "/api/join":  # paste the room link, the app finds your slot and your game in it
                room = parse_room(b["room"])
                slots = room.get("players") or []
                if not slots:
                    raise ValueError("الصق رابط الروم الكامل من archipelago.gg (مو العنوان والبورت بس)، عشان البرنامج يعرف لعبتك.")
                s = load_settings()
                want = (b.get("slot") or s.get("player_name") or "").strip()
                me = next((x for x in slots if x["name"].lower() == want.lower()), None) if want else None
                if not me:  # not sure who you are in this room: let the player pick their name
                    return self.send(200, {"choose": [x["name"] for x in slots]})
                if b.get("slot"):
                    s["player_name"] = rec.safe_slot(me["name"])
                    save_settings(s)
                r = next((x for x in RECIPES.values() if x.get("game") == me["game"]), None)
                if not r:
                    raise ValueError(f"لعبتك في هذا الروم ({me['game']}) ما لها وصفة في البرنامج.")
                return self.send(200, {"game": r["id"], "slot": me["name"],
                                       "others": [x for x in slots if x["name"] != me["name"]]})
            if p == "/api/host/quick":  # the host picks everyone's game: no settings files to send around
                rows = [x for x in b.get("players", []) if str(x.get("name", "")).strip() and x.get("game") in RECIPES]
                if not rows:
                    raise ValueError("اكتب اسم كل واحد واختار لعبته")
                names = [rec.safe_slot(x["name"]).lower() for x in rows]
                if len(set(names)) != len(names):
                    raise ValueError("فيه اسمين متشابهين: كل واحد لازم يكون له اسم مختلف")
                pdir = players_dir()
                pdir.mkdir(parents=True, exist_ok=True)
                if b.get("replace", True):
                    for old in pdir.glob("*.y*ml"):
                        old.unlink()
                for x in rows:
                    name = rec.safe_slot(x["name"])
                    text = rec.build_yaml(RECIPES[x["game"]], name, {}, bool(x.get("death_link", True)))
                    (pdir / f"{name}.yaml").write_text(text, encoding="utf-8")
                return self.send(200, {"ok": True, "count": len(rows)})
            if p == "/api/watch":
                s = load_settings()
                f = watch_room(parse_room(b["room"]), rec.safe_slot(s.get("player_name") or "Player"), b.get("password", ""))
                return self.send(200, {"ok": True, "room": f"{f.host}:{f.port}"})
            if p == "/api/map":  # PopTracker with this game's map pack, connected to the room I'm watching
                f = FEED["feed"]
                if not f or f.status != "connected":
                    return self.send(400, {"error": "تابع الروم أول (اضغط العب أو تابع الروم)"})
                r = next((x for x in RECIPES.values() if x.get("game") == f.my_game()), None)
                if not r or not r.get("map_tracker"):
                    return self.send(400, {"error": "لعبتك ما لها خريطة تراكر للحين"})
                t = runner.start(maptracker.open_map, r, _options(r, {}, yaml_first=True),
                                 f.host, f.port, f.slot, f.password)
                return self.send(200, {"task": self._keep(t)})
            if p == "/api/hint":  # ask the room where one of my items is (costs hint points)
                item = " ".join(str(b.get("item", "")).split())[:100]
                if not item:
                    return self.send(400, {"error": "اكتب اسم الغرض"})
                f = FEED["feed"]
                if not f:
                    return self.send(400, {"error": "تابع الروم أول"})
                f.say("!hint " + item)
                return self.send(200, {"ok": True})
            if p == "/api/say":  # chat, or one of the room commands the page offers (never !admin and the like)
                text = " ".join(str(b.get("text", "")).split())[:300]
                if not text:
                    return self.send(400, {"error": "اكتب شي"})
                if text.startswith("!") and text.split()[0].lower() not in SAFE_COMMANDS:
                    return self.send(400, {"error": "هذا الأمر مو متاح من هنا"})
                f = FEED["feed"]
                if not f:
                    return self.send(400, {"error": "تابع الروم أول"})
                f.say(text)
                return self.send(200, {"ok": True})
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
            if p == "/api/game_folder":  # the game is somewhere we don't look: the player shows us the folder
                r = RECIPES[b["game"]]
                s = load_settings()
                if b.get("clear"):
                    s.setdefault("game_dirs", {}).pop(r["id"], None)
                    save_settings(s)
                    return self.send(200, {"ok": True})
                path = b.get("path") or stores.pick_folder()
                if not path:
                    return self.send(200, {"ok": False})
                if not stores.folder_ok(r, Path(path)):
                    return self.send(400, {"error": f"هذا مو مجلد {r['name']}: ما فيه {r.get('exe', 'ملف اللعبة')}. اختر المجلد اللي فيه ملف تشغيل اللعبة."})
                s.setdefault("game_dirs", {})[r["id"]] = str(path)
                save_settings(s)
                return self.send(200, {"ok": True, "path": str(path)})
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
        except Exception as e:  # anything else: a clear message in the page, never a dropped request
            self.send(500, {"error": f"صار خطأ: {e}"})

    def _keep(self, t):
        tid = uuid.uuid4().hex[:8]
        TASKS[tid] = t
        return tid


def problem_report() -> str:
    import platform
    s = load_settings()
    lines = [f"My Ready AP {VERSION} | {platform.platform()} | name: {s.get('player_name', '')}",
             f"installed: {', '.join(sorted(s.get('installed', {}))[-30:])}",
             f"game folders picked: {', '.join(s.get('game_dirs', {}))}"]
    for tid, t in list(TASKS.items())[-3:]:
        lines.append(f"--- task {tid}: done={t.done} error={t.error} needs={(t.needs_user or {}).get('id')}")
        lines += [str(x) for x in t.log[-25:] if "تحميل" not in str(x)]
    f = FEED["feed"]
    if f:
        snap = f.snapshot(max(0, f.seq - 30))
        lines.append(f"--- room {f.host}:{f.port} slot={f.slot} status={snap['status']} error={snap['error']} "
                     f"game={snap['game_link']} game_name={f.my_game()} why={snap.get('progress_why')}")
        lines += [f"{e['t']} {e['kind']}: {e['text']}" for e in snap["events"]]
    log = data_dir() / "error.log"
    if log.exists():
        lines.append("--- error.log")
        lines += log.read_text(encoding="utf-8", errors="ignore").splitlines()[-30:]
    text = "\n".join(lines)
    pw = f.password if f else ""
    return text.replace(pw, "***") if pw else text


# room commands the page can send for the player (release has its own endpoint, asked twice)
SAFE_COMMANDS = {"!hint", "!hint_location", "!missing", "!checked", "!status", "!players", "!remaining",
                 "!collect", "!countdown", "!help"}


def reload_recipes():
    fresh = rec.load_all(extra=updates.remote_dir())
    changed = fresh != RECIPES
    RECIPES.clear()
    RECIPES.update(fresh)
    if changed:
        RECIPES_REV["n"] += 1


APP_UPDATE = {}
MOD_CHECK = {}   # did the mod load after Play? {"game", "state": waiting|ok|missing, "log"}

# where mod loaders write their log when the game starts with them
MOD_LOGS = ("BepInEx/LogOutput.log", "BepInEx/LogOutput.txt", "MelonLoader/Latest.log", "MelonLoader/Logs/Latest.log")


def watch_mod_load(recipe: dict, started: float, wait: float = 180, poll: float = 5, sleep=time.sleep):
    """After Play: if the game folder has a mod loader, its log must be written within a few minutes.
    Not written = the game started without the mod (an antivirus took winhttp.dll / the loader, or the
    game was started some other way). Only games whose folder has a loader are watched."""
    loc = stores.locate(recipe, load_settings())
    if not loc:
        return
    gd = loc["dir"]
    logs = [gd / x for x in MOD_LOGS if (gd / x.split("/")[0]).is_dir()]
    if not logs:
        return
    MOD_CHECK.clear()
    MOD_CHECK.update({"game": recipe["name"], "state": "waiting", "since": started})
    waited = 0.0
    while waited < wait:
        if any(l.exists() and l.stat().st_mtime >= started - 2 for l in logs):
            MOD_CHECK["state"] = "ok"
            return
        sleep(poll)
        waited += poll
    MOD_CHECK["state"] = "missing"
    MOD_CHECK["loader"] = "BepInEx" if (gd / "BepInEx").is_dir() else "MelonLoader"


def update_app_in_background():
    """A newer My Ready AP: download it quietly; the page offers «حدّث الحين» (never in the middle of a game)."""
    def run():
        try:
            res = updates.check_app_update(VERSION)
        except Exception:
            return
        if res:
            APP_UPDATE.update(res)
    threading.Thread(target=run, daemon=True).start()


def update_recipes_in_background():
    """New games from the owner's repo, without a new exe. Offline? Keep what we have."""
    def run():
        try:
            res = updates.update()
        except Exception:
            return
        if res["new"] or res["updated"]:
            before = {k: json.dumps(v, sort_keys=True) for k, v in RECIPES.items()}
            reload_recipes()
            # tell the player only what really changed for them (a first sync re-downloads every game
            # that already came with the app: those are not new)
            UPDATE.update({
                "new": [r["name"] for k, r in RECIPES.items() if k not in before],
                "updated": [r["name"] for k, r in RECIPES.items()
                            if k in before and before[k] != json.dumps(r, sort_keys=True)],
                "skipped": res.get("skipped", []),
            })
    threading.Thread(target=run, daemon=True).start()


SERVER = {"srv": None, "window": None}


def _free_deaths(recipe: dict, body: dict, death_link: bool) -> int:
    """Free deaths for this Play: only with Death Link on, in a game the relay handles. It is the app's
    own setting (not in the YAML), so the page's current value counts, else the last one used."""
    if not death_link or not rec.death_link_live(recipe) or recipe.get("free_deaths_native"):
        return 0
    page = (body.get("options") or {}).get("free_deaths")
    last = load_settings().get("last", {}).get(recipe["id"], {}).get("options", {}).get("free_deaths", 0)
    try:
        return max(0, min(25, int(page if page is not None else last)))
    except (TypeError, ValueError):
        return 0


def _my_death(total: int, sent: bool, cause: str = ""):
    f = FEED["feed"]
    if f:
        f.record_my_death(sent, cause)


def _options(recipe: dict, body: dict, yaml_first: bool = False) -> dict:
    """What the player picked. Play follows their last YAML (that is what the host generated with);
    setup follows the page. Either falls back to the other, then to the defaults."""
    last = load_settings().get("last", {}).get(recipe["id"], {}).get("options")
    page = body.get("options")
    chosen = (last if last is not None else page) if yaml_first else (page if page is not None else last)
    return rec.effective_options(recipe, chosen or {})


def main(open_browser=True, port=0):
    """open_browser: run as the app (own window, one copy at a time, quits when the window closes)."""
    frozen = getattr(sys, "frozen", False) and sys.platform == "win32"
    if open_browser and frozen and install.relocate():
        return  # this was the downloaded copy: the installed one (with desktop shortcut) is starting
    if open_browser:
        running = window.already_running()
        if running and os.environ.pop("MRAP_JUST_INSTALLED", None):
            install.quit_running_copy()  # a new version was just installed: the old one makes way
            running = window.already_running()
            if running:  # too old to be asked (before v0.5.1)
                window.message("نسخة قديمة من البرنامج مفتوحة.\nسكّر نافذتها، وبعدها افتح My Ready AP من سطح المكتب.")
                return
        if running:  # double-clicked again: show the window of the copy that is already running
            window.open_window(running)
            return
    reload_recipes()
    update_recipes_in_background()
    if getattr(sys, "frozen", False):  # the exe checks for a newer exe; running from source never does
        update_app_in_background()
    srv = SERVER["srv"] = ThreadingHTTPServer(("127.0.0.1", port), Handler)
    url = f"http://127.0.0.1:{srv.server_address[1]}/"
    print("My Ready AP:", url)
    if open_browser:
        window.mark_running(url)
        if frozen:  # e.g. installing failed and it runs from Downloads: still give a shortcut
            threading.Thread(target=install.ensure_shortcuts, args=(sys.executable,), daemon=True).start()
        proc = SERVER["window"] = window.open_window(url)
        def quit_when_free():
            while dlproxy.busy():  # a game still plays through the relay: closing the window must not cut it off
                time.sleep(10)
            srv.shutdown()
        threading.Thread(target=window.wait_until_closed, args=(proc, quit_when_free), daemon=True).start()
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
