"""Runs the steps of a recipe. Every step is safe to run twice."""
import fnmatch
import json
import os
import shutil
import subprocess
import sys
import threading
import urllib.request
import webbrowser
import zipfile
from pathlib import Path

from . import steam
from .paths import ap_dir, documents_dir, load_settings, save_settings, tools_dir

GITHUB_API = "https://api.github.com/repos/{repo}/releases"
UA = {"User-Agent": "APReady", "Accept": "application/vnd.github+json"}


class NeedsUser(Exception):
    """A manual step the player has to do once. Carries the text to show."""

    def __init__(self, step: dict, text: str, recipe_id: str = ""):
        super().__init__(text)
        self.step = step
        self.text = text
        self.recipe_id = recipe_id


class Task:
    """A background job the UI polls for log lines."""

    def __init__(self):
        self.log = []
        self.done = False
        self.error = None
        self.needs_user = None
        self.result = None

    def say(self, msg: str):
        self.log.append(msg)

    def to_json(self):
        return {"log": self.log, "done": self.done, "error": self.error,
                "needs_user": self.needs_user, "result": self.result}


def start(fn, *args) -> Task:
    t = Task()

    def run():
        try:
            t.result = fn(t, *args)
        except NeedsUser as e:
            t.needs_user = {"id": e.step.get("id"), "game": e.recipe_id,
                            "text": e.text, "url": e.step.get("url")}
        except Exception as e:  # shown to the player in Arabic + raw error
            t.error = f"{type(e).__name__}: {e}"
        finally:
            t.done = True

    threading.Thread(target=run, daemon=True).start()
    return t


# ---------- helpers ----------

def context(recipe: dict, settings: dict, session: dict = None) -> dict:
    gd = steam.game_dir(recipe["steam_appid"]) if recipe.get("steam_appid") else None
    apd = ap_dir(settings)
    session = session or {}
    host = session.get("host", "archipelago.gg")
    port = str(session.get("port", ""))
    sr = steam.steam_root()
    lib_apps = gd.parent.parent if gd else None  # <library>/steamapps
    appid = str(recipe.get("steam_appid", ""))
    return {
        "steam": str(sr) if sr else "",
        "sourcemods": str(sr / "steamapps" / "sourcemods") if sr else "",
        "game_dir": str(gd) if gd else "",
        "ap_dir": str(apd),
        "custom_worlds": str(apd / "custom_worlds"),
        "tools": str(tools_dir() / recipe["id"]),
        "documents": str(documents_dir()),
        "appdata": os.environ.get("APPDATA", ""),
        "locallow": str(Path(os.environ.get("USERPROFILE") or Path.home()) / "AppData" / "LocalLow"),
        "workshop": str(lib_apps / "workshop" / "content" / appid) if lib_apps else "",
        "has_password": "1" if session.get("password") else "0",
        "slot": session.get("slot", ""),
        "host": host,
        "port": port,
        "address": f"{host}:{port}" if port else host,
        "password": session.get("password", ""),
    }


def fill(s, ctx: dict):
    if isinstance(s, str):
        for k, v in ctx.items():
            s = s.replace("{" + k + "}", v)
        return s
    if isinstance(s, list):
        return [fill(x, ctx) for x in s]
    if isinstance(s, dict):
        return {k: fill(v, ctx) for k, v in s.items()}
    return s


def http_json(url: str):
    req = urllib.request.Request(url, headers=UA)
    with urllib.request.urlopen(req, timeout=30) as r:
        return json.loads(r.read().decode("utf-8"))


def download(url: str, dest: Path, task: Task):
    dest.parent.mkdir(parents=True, exist_ok=True)
    tmp = dest.with_suffix(dest.suffix + ".part")
    req = urllib.request.Request(url, headers={"User-Agent": "APReady"})
    with urllib.request.urlopen(req, timeout=60) as r, open(tmp, "wb") as f:
        total = int(r.headers.get("Content-Length") or 0)
        got, last = 0, -10
        while True:
            chunk = r.read(1 << 16)
            if not chunk:
                break
            f.write(chunk)
            got += len(chunk)
            if total:
                pct = got * 100 // total
                if pct >= last + 10:
                    task.say(f"  تحميل {dest.name}: {pct}%")
                    last = pct
    tmp.replace(dest)


def extract_zip(zip_path: Path, dest_dir: Path, strip: bool = False, pick: str = None) -> int:
    """Unzip into dest_dir. strip: drop the top folder. pick: only members matching this glob,
    copied flat into dest_dir. Some zips are made on Windows with '\\' separators."""
    count = 0
    with zipfile.ZipFile(zip_path) as z:
        for m in z.infolist():
            name = m.filename.replace("\\", "/")
            if name.endswith("/"):
                continue
            if pick:
                if not fnmatch.fnmatch(name, pick):
                    continue
                name = name.rsplit("/", 1)[-1]
            elif strip:
                name = name.split("/", 1)[1] if "/" in name else ""
            name = name.lstrip("/")
            if not name or ".." in name.split("/") or ":" in name:  # never write outside dest_dir
                continue
            target = dest_dir / name
            target.parent.mkdir(parents=True, exist_ok=True)
            with z.open(m) as src, open(target, "wb") as out:
                shutil.copyfileobj(src, out)
            count += 1
    return count


def resolve_path(p: str) -> Path:
    """A path that may contain a glob (e.g. a launcher exe inside a versioned folder)."""
    if not any(c in p for c in "*?["):
        return Path(p)
    anchor = Path(p)
    parts = anchor.parts
    i = next(i for i, part in enumerate(parts) if any(c in part for c in "*?["))
    base = Path(*parts[:i])
    pattern = "/".join(parts[i:])
    hits = sorted(base.glob(pattern)) if base.exists() else []
    return hits[0] if hits else anchor


def coerce_ints(d: dict, keys) -> dict:
    for k in keys or []:
        v = d.get(k)
        if isinstance(v, str) and v.strip().lstrip("-").isdigit():
            d[k] = int(v)
    return d


def deep_merge(old: dict, new: dict) -> dict:
    out = dict(old)
    for k, v in new.items():
        out[k] = deep_merge(out[k], v) if isinstance(v, dict) and isinstance(out.get(k), dict) else v
    return out


def ini_set(text: str, section: str, values: dict, quote: bool = False) -> str:
    """Set keys inside one [section] of an INI / BepInEx .cfg / MelonPreferences TOML file,
    keeping everything else as it is. Section headers may be written [Name] or ["Name"]."""
    def fmt(v):
        if isinstance(v, bool):
            return "true" if v else "false"
        if isinstance(v, (int, float)) or not quote:
            return str(v)
        return json.dumps(str(v), ensure_ascii=False)

    lines = text.splitlines()
    norm = lambda h: h.strip()[1:-1].strip().strip('"') if h.strip().startswith("[") and h.strip().endswith("]") else None
    start = next((i for i, l in enumerate(lines) if norm(l) == section), None)
    if start is None:
        head = f'["{section}"]' if quote and " " in section else f"[{section}]"
        if lines and lines[-1].strip():
            lines.append("")
        lines += [head] + [f"{k} = {fmt(v)}" for k, v in values.items()]
        return "\n".join(lines) + "\n"
    end = next((i for i in range(start + 1, len(lines)) if norm(lines[i]) is not None), len(lines))
    todo = dict(values)
    for i in range(start + 1, end):
        key = lines[i].split("=", 1)[0].strip() if "=" in lines[i] and not lines[i].lstrip().startswith(("#", ";")) else None
        if key in todo:
            lines[i] = f"{key} = {fmt(todo.pop(key))}"
    insert_at = end
    while insert_at > start + 1 and not lines[insert_at - 1].strip():
        insert_at -= 1
    lines[insert_at:insert_at] = [f"{k} = {fmt(v)}" for k, v in todo.items()]
    return "\n".join(lines) + "\n"


def read_json(p: Path, default):
    try:
        return json.loads(p.read_text(encoding="utf-8-sig"))
    except (OSError, ValueError):
        return default


def pick_release(repo: str, tag: str = None, prerelease: bool = False) -> dict:
    if tag:
        return http_json(GITHUB_API.format(repo=repo) + f"/tags/{tag}")
    releases = http_json(GITHUB_API.format(repo=repo))
    for rel in releases:
        if rel.get("draft"):
            continue
        if rel.get("prerelease") and not prerelease:
            continue
        return rel
    raise RuntimeError(f"ما لقيت إصدار في {repo}")


# ---------- Archipelago itself ----------

def ensure_archipelago(task: Task, settings: dict):
    apd = ap_dir(settings)
    if (apd / "ArchipelagoLauncher.exe").exists() or (apd / "ArchipelagoGenerate.exe").exists():
        task.say("✔ Archipelago موجود")
        return
    if sys.platform != "win32":
        raise RuntimeError("تثبيت Archipelago التلقائي يشتغل على ويندوز بس")
    task.say("… أنزّل Archipelago")
    rel = pick_release("ArchipelagoMW/Archipelago")
    asset = next((a for a in rel["assets"] if fnmatch.fnmatch(a["name"], "Setup.Archipelago.*.exe")), None)
    if not asset:
        raise RuntimeError("ما لقيت ملف تثبيت Archipelago في آخر إصدار")
    exe = tools_dir() / asset["name"]
    download(asset["browser_download_url"], exe, task)
    task.say("… أثبّت Archipelago (ممكن يطلب صلاحية)")
    subprocess.run([str(exe), "/VERYSILENT", "/SUPPRESSMSGBOXES", "/NORESTART"], check=True)
    task.say("✔ تم تثبيت Archipelago")


# ---------- steps ----------

def run_step(step: dict, ctx: dict, settings: dict, recipe: dict, task: Task):
    t = step["type"]
    s = fill(step, ctx)
    key = f"{recipe['id']}:{step.get('id') or step.get('repo') or t}"
    if t == "github_release":  # one repo can feed several steps (apworld + mod)
        key += f":{step.get('asset')}:{step.get('pick') or step.get('to')}"

    if s.get("skip_if_exists") and resolve_path(s["skip_if_exists"]).exists():
        task.say(f"✔ {s.get('label', step.get('id') or t)}")
        return

    if t == "apworld_builtin":
        task.say("✔ اللعبة مدعومة رسمياً في Archipelago")

    elif t == "github_release":
        rel = pick_release(s["repo"], s.get("tag"), s.get("prerelease", False))
        version = rel.get("tag_name", "")
        dest_dir = Path(s["to"])
        check = Path(s["check"]) if s.get("check") else dest_dir
        if settings["installed"].get(key) == version and check.exists() and not s.get("always"):
            task.say(f"✔ {s.get('label', s['repo'])} محدث ({version})")
            return
        if s["asset"] == "__source__":  # repos that ship "Source code (zip)" only
            asset = {"name": f"{s['repo'].replace('/', '_')}_{version}.zip", "browser_download_url": rel["zipball_url"]}
        else:
            asset = next((a for a in rel["assets"] if fnmatch.fnmatch(a["name"], s["asset"])), None)
        if not asset:
            names = ", ".join(a["name"] for a in rel["assets"])
            raise RuntimeError(f"ما لقيت ملف يطابق '{s['asset']}' في {s['repo']} {version}. الموجود: {names}")
        task.say(f"… {s.get('label', s['repo'])} {version}")
        cache = tools_dir() / "_downloads" / asset["name"]
        download(asset["browser_download_url"], cache, task)
        dest_dir.mkdir(parents=True, exist_ok=True)
        if s.get("extract") and cache.suffix.lower() == ".zip":
            n = extract_zip(cache, dest_dir, s.get("strip_top_folder", False), s.get("pick"))
            if s.get("pick") and not n:
                raise RuntimeError(f"ما لقيت '{s['pick']}' داخل {asset['name']}")
        else:
            shutil.copy2(cache, dest_dir / (s.get("rename") or asset["name"]))
        settings["installed"][key] = version
        save_settings(settings)
        task.say(f"✔ {s.get('label', s['repo'])} جاهز")

    elif t == "workshop":
        sid = step["id"]
        appid = s.get("appid", recipe["steam_appid"])
        if steam.workshop_item_dir(appid, s["workshop_id"]):
            settings["done_steps"][f"{recipe['id']}:{sid}"] = True
            save_settings(settings)
        if not settings["done_steps"].get(f"{recipe['id']}:{sid}"):
            webbrowser.open(f"steam://url/CommunityFilePage/{s['workshop_id']}")
            raise NeedsUser(step, s.get("text_ar", "اضغط Subscribe في صفحة الورشة اللي انفتحت، وبعدها ارجع واضغط سويتها"), recipe["id"])
        task.say(f"✔ {s.get('label', 'مود الورشة')}")

    elif t == "manual" and step.get("every_time"):
        task.say("👉 " + s["text_ar"])

    elif t == "manual":
        if s.get("done_if_exists") and resolve_path(s["done_if_exists"]).exists():
            settings["done_steps"][f"{recipe['id']}:{step['id']}"] = True
            save_settings(settings)
        if not settings["done_steps"].get(f"{recipe['id']}:{step['id']}"):
            if s.get("url"):
                webbrowser.open(s["url"])
            if s.get("open_folder"):  # show the folder instead of printing its path
                folder = Path(s["open_folder"])
                folder.mkdir(parents=True, exist_ok=True)
                webbrowser.open(folder.as_uri())
            if s.get("open_exe"):  # open the mod's own launcher so the player only has to click in it
                exe = resolve_path(s["open_exe"])
                if exe.exists():
                    subprocess.Popen([str(exe)], cwd=str(exe.parent))
            raise NeedsUser(step, s["text_ar"], recipe["id"])
        task.say(f"✔ {s.get('label', step['id'])}")

    elif t == "copy":
        src, dst = Path(s["from"]), Path(s["to"])
        dst.parent.mkdir(parents=True, exist_ok=True)
        if src.is_dir():
            shutil.copytree(src, dst, dirs_exist_ok=True)
        else:
            shutil.copy2(src, dst)
        task.say(f"✔ نسخت {src.name}")

    elif t == "write_file":
        p = Path(s["path"])
        p.parent.mkdir(parents=True, exist_ok=True)
        content = s["content"]
        if isinstance(content, dict):
            content = coerce_ints(dict(content), s.get("ints"))
            for k, v in list(content.items()):  # ints inside nested sections too
                if isinstance(v, dict):
                    content[k] = coerce_ints(dict(v), s.get("ints"))
            if s.get("merge"):  # keep the other settings the game/mod already wrote
                old = read_json(p, {})
                content = deep_merge(old if isinstance(old, dict) else {}, content)
        if isinstance(content, (dict, list)):
            content = json.dumps(content, ensure_ascii=False, indent=2)
        p.write_text(content, encoding="utf-8")
        task.say(f"✔ كتبت إعدادات {p.name}")

    elif t == "ini_set":  # BepInEx .cfg, MelonPreferences.cfg
        p = Path(s["path"])
        old = p.read_text(encoding="utf-8-sig") if p.exists() else ""
        values = coerce_ints(dict(s["values"]), s.get("ints"))
        p.parent.mkdir(parents=True, exist_ok=True)
        p.write_text(ini_set(old, s["section"], values, s.get("quote", False)), encoding="utf-8")
        task.say(f"✔ كتبت إعدادات {p.name}")

    elif t == "json_list_add":  # e.g. tModLoader's Mods/enabled.json
        p = Path(s["path"])
        items = read_json(p, [])
        items = items if isinstance(items, list) else []
        added = [x for x in s["items"] if x not in items]
        if added:
            p.parent.mkdir(parents=True, exist_ok=True)
            p.write_text(json.dumps(items + added, indent=2), encoding="utf-8")
        task.say(f"✔ فعّلت {', '.join(s['items'])}")

    elif t == "open_url":
        webbrowser.open(s["url"])
        task.say(f"✔ فتحت {s['url']}")

    elif t == "steam_launch":
        args = " ".join(s.get("args", []))
        url = f"steam://run/{s.get('appid', recipe['steam_appid'])}" + (f"//{args}" if args else "")
        webbrowser.open(url)
        task.say("✔ شغّلت اللعبة من ستيم")

    elif t == "run":
        exe = resolve_path(s["exe"])
        if not exe.exists():
            raise RuntimeError(f"ما لقيت {exe}")
        args = list(s.get("args", []))
        for flag, val in s.get("optional_args", {}).items():  # e.g. --password only if there is one
            if val:
                args += [flag, val]
        cmd = [str(exe)] + args
        if exe.suffix.lower() in (".cmd", ".bat"):
            cmd = ["cmd", "/c", "start", "", str(exe)] + args
        cwd = s.get("cwd") or str(exe.parent)
        if s.get("wait"):
            subprocess.run(cmd, cwd=cwd, check=True)
        else:
            subprocess.Popen(cmd, cwd=cwd)
        task.say(f"✔ شغّلت {exe.name}")


def run_phases(task: Task, recipe: dict, phases: list, session: dict = None):
    settings = load_settings()
    if recipe.get("steam_appid") and not steam.game_dir(recipe["steam_appid"]):
        webbrowser.open(f"steam://install/{recipe['steam_appid']}")
        raise RuntimeError(f"ما لقيت {recipe['name']} في ستيم. ثبّتها من ستيم أول (لو بالفاميلي: من مكتبة العائلة)")
    ensure_archipelago(task, settings)
    ctx = context(recipe, settings, session)
    for phase in phases:
        for step in recipe.get(phase, []):
            run_step(step, ctx, settings, recipe, task)
    return "ok"


def mark_done(recipe_id: str, step_id: str):
    s = load_settings()
    s["done_steps"][f"{recipe_id}:{step_id}"] = True
    save_settings(s)
