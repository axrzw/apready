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

from . import host, recipes as rec, runner, steam, updates
from .paths import base_dir, data_dir, load_settings, players_dir, save_settings

TASKS = {}
RECIPES = {}
UPDATE = {}  # result of the last recipe update, shown once in the UI


def parse_room(text: str) -> dict:
    """Accept 'archipelago.gg:38281', '/connect archipelago.gg:38281' or a room URL with a port."""
    text = (text or "").strip()
    m = re.search(r"([A-Za-z0-9.\-]+):(\d{2,5})", text)
    if m:
        return {"host": m.group(1), "port": m.group(2)}
    m = re.fullmatch(r"\d{2,5}", text)
    if m:
        return {"host": "archipelago.gg", "port": text}
    raise ValueError("ما فهمت عنوان الروم. لازم يكون مثل archipelago.gg:38281")


def game_list():
    s = load_settings()
    out = []
    for r in RECIPES.values():
        out.append({
            "id": r["id"], "name": r["name"], "name_ar": r.get("name_ar", r["name"]),
            "installed": bool(steam.game_dir(r["steam_appid"])) if r.get("steam_appid") else True,
            "verified": r.get("verified", False), "notes_ar": r.get("notes_ar", ""),
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
        if self.path == "/api/state":
            s = load_settings()
            return self.send(200, {"player_name": s.get("player_name", ""), "games": game_list(),
                                   "players": host.scan_players(RECIPES),
                                   "last": s.get("last", {}), "update": UPDATE})
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
                return self.send(200, {"task": self._keep(t)})
            if p == "/api/done":
                runner.mark_done(b["game"], b["step"])
                return self.send(200, {"ok": True})
            if p == "/api/host/generate":
                t = runner.start(host.generate, RECIPES)
                return self.send(200, {"task": self._keep(t)})
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


def main(open_browser=True, port=0):
    reload_recipes()
    update_recipes_in_background()
    srv = ThreadingHTTPServer(("127.0.0.1", port), Handler)
    url = f"http://127.0.0.1:{srv.server_address[1]}/"
    print("APReady:", url)
    if open_browser:
        webbrowser.open(url)
    try:
        srv.serve_forever()
    except KeyboardInterrupt:
        pass


if __name__ == "__main__":
    main()
