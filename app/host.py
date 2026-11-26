"""Host side: install every needed apworld, generate the seed, open the upload page."""
import re
import shutil
import subprocess
import sys
import webbrowser

from . import recipes as rec
from .paths import ap_dir, load_settings, players_dir
from .runner import Task, context, ensure_archipelago, run_step

UPLOAD_URL = "https://archipelago.gg/uploads"
WEBHOST = "https://archipelago.gg"


def scan_players(all_recipes: dict) -> list:
    by_game = {r["game"]: r for r in all_recipes.values()}
    out = []
    for f in sorted(players_dir().glob("*.y*ml")):
        text = f.read_text(encoding="utf-8", errors="ignore")
        game = rec.game_of_yaml(text)
        r = by_game.get(game)
        out.append({"file": f.name, "game": game, "recipe": r["id"] if r else None,
                    "name": _yaml_field(text, "name"),
                    # Death Link as written for this game (our files say `true`/`false`; weights count as on if `true` is there)
                    "death_link": _dl_on(text, (r or {}).get("death_link_key", "death_link")),
                    "calamity": bool(re.search(r"^\s+calamity:\s*['\"]?(true|on)\b", text, re.M))})
    return out


def _yaml_field(text: str, key: str):
    m = re.search(rf"^{re.escape(key)}:\s*['\"]?([^'\"\n]+?)['\"]?\s*$", text, re.M)
    return m.group(1).strip() if m else None


def _dl_on(text: str, key) -> bool:
    if not key:
        return False
    m = re.search(rf"^\s+{re.escape(key)}:\s*(.*)$", text, re.M)
    if not m:
        return False
    v = m.group(1).strip().strip("'\"").lower()
    if v in ("true", "on", "1", "yes"):
        return True
    if v == "":  # weights on the next lines: on if any truthy choice has weight
        tail = text[m.end():].splitlines()[:4]
        return any(re.match(r"\s+['\"]?(true|on)['\"]?:\s*[1-9]", t) for t in tail)
    return False


def explain_failure(output: str, players: list) -> str:
    """Generation failed: say whose file it is (Archipelago names the player or the file) and keep the tail."""
    lines = [l for l in output.splitlines() if l.strip()]
    tail = "\n".join(lines[-12:])
    text = output.lower()
    guilty = [p for p in players
              if (p.get("name") and re.search(rf"\b{re.escape(p['name'].lower())}\b", text)) or p["file"].lower() in text]
    hint = ""
    if "already registered" in text:
        hint = "لعبة مركّب لها ملف apworld مرتين (في custom_worlds وفي worlds). احذف النسخة القديمة من custom_worlds."
    elif "no world found" in text or "game" in text and "not found" in text:
        hint = "لعبة في ملفات الشباب ما لها apworld عندك. اضغط ولّد مرة ثانية (البرنامج يركّبه) أو شيك اسم اللعبة."
    elif "version" in text and ("requires" in text or "newer" in text):
        hint = "نسخة Archipelago أو apworld مختلفة عن اللي سوّى الملف. خل الكل يحدّث البرنامج."
    who = ""
    if len(guilty) == 1:
        g = guilty[0]
        who = f"المشكلة في ملف {g.get('name') or g['file']} ({g.get('game') or '؟'}). خله يغيّر خياراته ويرسله مرة ثانية، أو احذفه وولّد بدونه."
    elif guilty:
        who = "المشكلة في ملفات: " + "، ".join(g.get("name") or g["file"] for g in guilty)
    head = "التوليد فشل. " + " ".join(x for x in (who, hint) if x)
    return head + "\n\n" + tail


def generate(task: Task, all_recipes: dict):
    settings = load_settings()
    ensure_archipelago(task, settings)
    players = scan_players(all_recipes)
    if not players:
        raise RuntimeError("ما فيه ملفات YAML. حط ملفات الشباب في مجلد اللاعبين أول")
    unknown = [p["file"] for p in players if not p["recipe"]]
    if unknown:
        task.say("⚠ ألعاب ما عندنا لها وصفة (لازم الـ apworld حقها يكون مثبت يدوي): " + ", ".join(unknown))

    # every game in the seed needs its apworld on the host PC
    for rid in sorted({p["recipe"] for p in players if p["recipe"]}):
        r = all_recipes[rid]
        task.say(f"— apworld حق {r['name']}")
        ctx = context(r, settings)
        for step in r.get("apworld", []):
            run_step(step, ctx, settings, r, task)

    apd = ap_dir(settings)
    pdir = apd / "Players"
    pdir.mkdir(parents=True, exist_ok=True)
    for old in pdir.glob("*.y*ml"):
        old.unlink()
    for f in players_dir().glob("*.y*ml"):
        shutil.copy2(f, pdir / f.name)
    task.say(f"✔ نسخت {len(players)} ملف للاعبين")

    exe = apd / ("ArchipelagoGenerate.exe" if sys.platform == "win32" else "ArchipelagoGenerate")
    out = apd / "output"
    before = set(out.glob("*.zip")) if out.exists() else set()
    task.say("… أولّد السيد")
    # output is shown in the app, so no console box; stdin closed so a "press enter" can't hang it
    proc = subprocess.run([str(exe)], cwd=str(apd), capture_output=True, text=True, stdin=subprocess.DEVNULL,
                          creationflags=0x08000000 if sys.platform == "win32" else 0)
    after = set(out.glob("*.zip")) if out.exists() else set()
    new = sorted(after - before, key=lambda p: p.stat().st_mtime)
    if proc.returncode != 0 or not new:
        raise RuntimeError(explain_failure(proc.stdout + proc.stderr, players))
    zipf = new[-1]
    task.say(f"✔ العالم جاهز: {zipf.name}")
    # upload it and open a room, the same two requests the website makes when you press its buttons
    try:
        task.say("… أرفعه في archipelago.gg وأفتح الروم")
        room = upload_and_open_room(zipf)
    except Exception as e:  # the website said no or is down: the old way still works
        task.say(f"⚠ ما قدرت أرفعه لحالي ({e}). ارفع الملف في الصفحة اللي انفتحت، وانسخ رابط الروم وارسله للشباب")
        if sys.platform == "win32":
            subprocess.Popen(["explorer", "/select,", str(zipf)])
        webbrowser.open(UPLOAD_URL)
        return {"zip": str(zipf), "room": ""}
    task.say(f"✔ الروم جاهز: {room}")
    task.say("👉 انسخ الرابط وارسله للشباب. كل واحد يلصقه في البرنامج ويضغط يلا.")
    return {"zip": str(zipf), "room": room}


class _NoRedirect(__import__("urllib.request").request.HTTPRedirectHandler):
    def redirect_request(self, *a, **k):
        return None


def _multipart(field: str, path) -> tuple:
    import uuid
    boundary = "----MyReadyAP" + uuid.uuid4().hex
    data = path.read_bytes()
    body = (f"--{boundary}\r\nContent-Disposition: form-data; name=\"{field}\"; filename=\"{path.name}\"\r\n"
            "Content-Type: application/zip\r\n\r\n").encode() + data + f"\r\n--{boundary}--\r\n".encode()
    return body, f"multipart/form-data; boundary={boundary}"


def upload_and_open_room(zipf, opener=None) -> str:
    """POST the seed to archipelago.gg/uploads (-> 302 /seed/<id>), then /new_room/<id> (-> 302 /room/<id>).
    Same session cookie for both, like a browser. Returns the room link."""
    import http.cookiejar
    import urllib.error
    import urllib.request
    opener = opener or urllib.request.build_opener(urllib.request.HTTPCookieProcessor(http.cookiejar.CookieJar()), _NoRedirect)
    headers = {"User-Agent": "MyReadyAP"}

    def location(req):
        try:
            r = opener.open(req, timeout=120)
            body = r.read().decode("utf-8", "ignore")
        except urllib.error.HTTPError as e:
            if e.code in (301, 302, 303, 307, 308):
                return e.headers.get("Location", "")
            raise
        # no redirect: the page shows why (flash message), e.g. "Wrong Version detected"
        m = re.search(r'class="[^"]*flash[^"]*"[^>]*>\s*([^<]+)', body) or re.search(r"(Could not load multidata[^<]*)", body)
        raise RuntimeError(m.group(1).strip() if m else "الموقع ما قبل الملف")

    body, ctype = _multipart("file", zipf)
    seed = location(urllib.request.Request(UPLOAD_URL, data=body, headers={**headers, "Content-Type": ctype}))
    m = re.search(r"/seed/([A-Za-z0-9_\-]+)", seed)
    if not m:
        raise RuntimeError(f"رد غريب من الموقع: {seed}")
    room = location(urllib.request.Request(f"{WEBHOST}/new_room/{m.group(1)}", headers=headers))
    m = re.search(r"/room/([A-Za-z0-9_\-]+)", room)
    if not m:
        raise RuntimeError(f"رد غريب من الموقع: {room}")
    return f"{WEBHOST}/room/{m.group(1)}"
