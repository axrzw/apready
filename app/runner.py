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

from . import recipes, steam, stores
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
                            "text": e.text, "url": e.step.get("url"), "kind": e.step.get("kind", "")}
        except Exception as e:  # shown to the player in Arabic + raw error
            t.error = f"{type(e).__name__}: {e}"
        finally:
            t.done = True

    threading.Thread(target=run, daemon=True).start()
    return t


# ---------- helpers ----------

def context(recipe: dict, settings: dict, session: dict = None) -> dict:
    loc = stores.locate(recipe, settings)
    gd = loc["dir"] if loc else None
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
        "store": loc["store"] if loc else "",
        "epic_app": loc["epic_app"] if loc else "",
        "ap_dir": str(apd),
        "custom_worlds": str(apd / "custom_worlds"),
        "tools": str(tools_dir() / recipe["id"]),
        "documents": str(documents_dir()),
        "appdata": os.environ.get("APPDATA", ""),
        "locallow": str(Path(os.environ.get("USERPROFILE") or Path.home()) / "AppData" / "LocalLow"),
        "workshop": str(lib_apps / "workshop" / "content" / appid) if lib_apps else "",
        "has_password": "1" if session.get("password") else "0",
        # for mods that keep Death Link in their own settings (TUNIC, Buckshot Roulette)
        "death_link": "true" if session.get("death_link", True) else "false",
        "death_link_ar": "شغّال" if session.get("death_link", True) else "طافي",
        "slot": session.get("slot", ""),
        # the name as UTF-8 hex (APDOOM's -applayerhex): survives any letters on the command line
        "slot_hex": session.get("slot", "").encode("utf-8").hex().upper(),
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
    # GitHub wants its own Accept header; Thunderstore answers 406 to it
    headers = UA if "api.github.com" in url else {"User-Agent": "APReady", "Accept": "application/json"}
    req = urllib.request.Request(url, headers=headers)
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


def coerce_bools(d: dict, keys) -> dict:
    for k in keys or []:
        if isinstance(d.get(k), str) and d[k].lower() in ("true", "false"):
            d[k] = d[k].lower() == "true"
    return d


def read_json(p: Path, default):
    try:
        return json.loads(p.read_text(encoding="utf-8-sig"))
    except (OSError, ValueError):
        return default


THUNDERSTORE_METRICS = "https://thunderstore.io/api/v1/package-metrics/{ns}/{name}/"
THUNDERSTORE_DOWNLOAD = "https://thunderstore.io/package/download/{ns}/{name}/{version}/"


def _version_key(v: str):
    return tuple(int(x) if x.isdigit() else 0 for x in v.split("."))


def thunderstore_latest(full: str) -> str:
    ns, name = full.split("-", 1)
    return http_json(THUNDERSTORE_METRICS.format(ns=ns, name=name))["latest_version"]


def thunderstore_resolve(packages: list, fetch) -> list:
    """The packages (newest version) plus every dependency, read from each package's own
    manifest.json the way r2modman does; when two packages need different versions of the same
    dependency, the newest one wins. fetch(full, version) -> path of the downloaded zip.
    Returns [(full_name, version, zip_path)]."""
    wanted = {full: thunderstore_latest(full) for full in packages}
    done = {}
    while True:
        todo = [(f, v) for f, v in wanted.items() if done.get(f, (None,))[0] != v]
        if not todo:
            break
        for full, version in todo:
            zp = fetch(full, version)
            done[full] = (version, zp)
            with zipfile.ZipFile(zp) as z:
                try:
                    manifest = json.loads(z.read("manifest.json").decode("utf-8-sig"))
                except KeyError:
                    manifest = {}
            for dep in manifest.get("dependencies", []):
                dfull, dver = dep.rsplit("-", 1)  # "Ns-Name-1.2.3"
                if dfull not in wanted or _version_key(dver) > _version_key(wanted[dfull]):
                    wanted[dfull] = dver
    return [(f, v, zp) for f, (v, zp) in done.items()]


def thunderstore_target(full: str, member: str) -> str:
    """Where r2modman puts a file of a BepInEx package, relative to the game folder ('' = skip)."""
    if full.split("-", 1)[1].startswith("BepInExPack"):  # BepInExPack, BepInExPack_Valheim, ...: into the game folder
        top, _, rest = member.partition("/")
        return rest if top.startswith("BepInExPack") and rest else ""
    if member in ("manifest.json", "icon.png") or member.lower().startswith(("readme", "changelog", "license")):
        return ""
    if member.startswith("BepInEx/"):
        member = member[len("BepInEx/"):]
    for folder in ("plugins", "patchers"):
        if member.startswith(folder + "/"):
            return f"BepInEx/{folder}/{full}/" + member[len(folder) + 1:]
    for folder in ("config", "core"):
        if member.startswith(folder + "/"):
            return f"BepInEx/{folder}/" + member[len(folder) + 1:]
    return f"BepInEx/plugins/{full}/" + member


def thunderstore_install(zip_path: Path, full: str, game_dir: Path) -> int:
    n = 0
    with zipfile.ZipFile(zip_path) as z:
        for m in z.infolist():
            name = m.filename.replace("\\", "/").lstrip("/")
            if name.endswith("/") or ".." in name.split("/") or ":" in name:
                continue
            rel = thunderstore_target(full, name)
            if not rel:
                continue
            target = game_dir / rel
            target.parent.mkdir(parents=True, exist_ok=True)
            with z.open(m) as src, open(target, "wb") as out:
                shutil.copyfileobj(src, out)
            n += 1
    return n


def pick_release(repo: str, tag: str = None, prerelease: bool = False, tag_prefix: str = "") -> dict:
    """Newest usable release. tag_prefix: for repos that release several things (SoulsRandomizers:
    'eldenring-ap-...'), only releases whose tag starts with it."""
    if tag:
        return http_json(GITHUB_API.format(repo=repo) + f"/tags/{tag}")
    releases = http_json(GITHUB_API.format(repo=repo))
    for rel in releases:
        if rel.get("draft"):
            continue
        if tag_prefix and not rel.get("tag_name", "").startswith(tag_prefix):
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
    if t == "github_file":
        key += f":{step.get('path')}"
    if t == "github_release":  # one repo can feed several steps (apworld + mod)
        key += f":{step.get('asset')}:{step.get('pick') or step.get('to')}"

    if s.get("skip_if_exists") and resolve_path(s["skip_if_exists"]).exists():
        task.say(f"✔ {s.get('label', step.get('id') or t)}")
        return

    if t == "apworld_builtin":
        task.say("✔ اللعبة مدعومة رسمياً في Archipelago")

    elif t == "github_release":
        rel = pick_release(s["repo"], s.get("tag"), s.get("prerelease", False), s.get("tag_prefix", ""))
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
        if s.get("clean") and dest_dir.exists():  # a mod's own folder, replaced whole (an older pinned version)
            if len(dest_dir.resolve().parts) < 4 or str(dest_dir) in (ctx.get("game_dir"), ctx.get("appdata")):
                raise RuntimeError(f"ما أمسح {dest_dir}: مو مجلد مود")
            shutil.rmtree(dest_dir)
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

    elif t == "thunderstore":  # mods from thunderstore.io (the official page for these mods), with dependencies
        game = Path(s.get("to") or ctx["game_dir"])

        def fetch(full, version):
            ns, name = full.split("-", 1)
            cache = tools_dir() / "_downloads" / f"{full}-{version}.zip"
            if not cache.exists():
                task.say(f"… {full} {version}")
                download(THUNDERSTORE_DOWNLOAD.format(ns=ns, name=name, version=version), cache, task)
            return cache

        for full, version, zp in thunderstore_resolve(s["packages"], fetch):
            key = f"{recipe['id']}:ts:{full}"
            # BepInExPack lands in the game root; if Steam "verify files" removed it, install again
            present = (game / "winhttp.dll").exists() if "-BepInExPack" in full else (game / "BepInEx").exists()
            if settings["installed"].get(key) == version and present:
                task.say(f"✔ {full} محدث ({version})")
                continue
            thunderstore_install(zp, full, game)
            settings["installed"][key] = version
            save_settings(settings)
            task.say(f"✔ {full} جاهز ({version})")

    elif t == "workshop":
        if ctx.get("store") not in ("steam", "folder", ""):
            raise RuntimeError(f"مود {recipe['name']} من ورشة ستيم: يحتاج نسخة ستيم من اللعبة.")
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
        if not src.exists():  # e.g. DOOM.WAD: the game's own file, never downloaded by us
            raise RuntimeError(s.get("missing_ar") or f"ما لقيت {src.name} في ملفات اللعبة. تأكد إن اللعبة مثبتة كاملة في ستيم.")
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
            content = coerce_bools(coerce_ints(dict(content), s.get("ints")), s.get("bools"))
            for k, v in list(content.items()):  # inside nested sections too
                if isinstance(v, dict):
                    content[k] = coerce_bools(coerce_ints(dict(v), s.get("ints")), s.get("bools"))
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

    elif t == "save_slot_json":  # Cuphead: Archipelago lives inside one of the mod's own save slots
        folder = Path(s["dir"])
        rid = recipe["id"]
        slots = settings.setdefault("save_slots", {})
        new_game = settings.setdefault("new_game", {}).get(rid, False)
        apfile = lambda n: folder / s["file"].replace("{n}", str(n))
        gamefile = lambda n: folder / s["game_file"].replace("{n}", str(n))
        enabled = lambda n: read_json(apfile(n), {}).get(s.get("enabled_key", "enabled")) is True
        n = slots.get(rid)
        if new_game or n is None or not enabled(n):
            # never touch a slot that has been played: only one with no game save and Archipelago off
            free = [i for i in range(s.get("slots", 3)) if not gamefile(i).exists() and not enabled(i)]
            if not free:
                raise RuntimeError("كل سيفات Archipelago في اللعبة مستخدمة. امسح واحد من داخل اللعبة وارجع اضغط العب.")
            n = free[0]
        data = read_json(apfile(n), {})
        data = data if isinstance(data, dict) else {}
        data.update(coerce_ints(dict(s["values"]), s.get("ints")))
        data[s.get("enabled_key", "enabled")] = True
        folder.mkdir(parents=True, exist_ok=True)
        apfile(n).write_text(json.dumps(data, ensure_ascii=False), encoding="utf-8")
        slots[rid] = n
        settings["new_game"][rid] = False
        save_settings(settings)
        ctx["save_slot"] = str(n + 1)  # for the hint shown at launch
        task.say(f"✔ جهزت السيف رقم {n + 1} لـ Archipelago")

    elif t == "json_list_add":  # e.g. tModLoader's Mods/enabled.json
        p = Path(s["path"])
        items = read_json(p, [])
        items = items if isinstance(items, list) else []
        added = [x for x in s["items"] if x not in items]
        if added:
            p.parent.mkdir(parents=True, exist_ok=True)
            p.write_text(json.dumps(items + added, indent=2), encoding="utf-8")
        task.say(f"✔ فعّلت {', '.join(s['items'])}")

    elif t == "github_file":  # a file the mod's author ships inside the repo itself (A Short Hike's modding tools)
        branch = s.get("branch", "main")
        url = f"https://raw.githubusercontent.com/{s['repo']}/{branch}/{s['path']}"
        check = Path(s["check"]) if s.get("check") else None
        if settings["installed"].get(key) == url and (check is None or check.exists()):
            task.say(f"✔ {s.get('label', s['path'])}")
            return
        dest = tools_dir() / "_downloads" / (s["repo"].replace("/", "_") + "_" + Path(s["path"]).name)
        download(url, dest, task)
        if s.get("extract"):
            extract_zip(dest, Path(s["to"]), strip=s.get("strip_top_folder", False))
        else:
            Path(s["to"]).mkdir(parents=True, exist_ok=True)
            shutil.copy2(dest, Path(s["to"]) / dest.name)
        settings["installed"][key] = url
        save_settings(settings)
        task.say(f"✔ {s.get('label', s['path'])}")

    elif t == "json_list_remove":  # e.g. turn a mod off again in tModLoader's enabled.json
        p = Path(s["path"])
        items = read_json(p, [])
        if isinstance(items, list) and any(x in items for x in s["items"]):
            p.write_text(json.dumps([x for x in items if x not in s["items"]], indent=2), encoding="utf-8")
        task.say(f"✔ {s.get('label', 'طفيت ' + ', '.join(s['items']))}")

    elif t == "open_url":
        webbrowser.open(s["url"])
        task.say(f"✔ فتحت {s['url']}")

    elif t == "steam_launch" and ctx.get("store") == "epic" and ctx.get("epic_app"):
        webbrowser.open(f"com.epicgames.launcher://apps/{ctx['epic_app']}?action=launch&silent=true")
        task.say("✔ شغّلت اللعبة من Epic")

    elif t == "steam_launch" and ctx.get("store") in ("standalone", "folder", "epic") and recipe.get("exe"):
        hits = sorted(Path(ctx["game_dir"]).glob(recipe["exe"]))
        if not hits:
            raise RuntimeError(f"ما لقيت {recipe['exe']} في مجلد اللعبة")
        subprocess.Popen([str(hits[0])] + list(s.get("args", [])), cwd=str(hits[0].parent))
        task.say(f"✔ شغّلت {hits[0].name}")

    elif t == "steam_launch" and ctx.get("store") in ("standalone", "epic"):
        task.say("👉 شغّل اللعبة بنفسك من " + stores.STORE_AR[ctx["store"]])

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
        if s.get("after_process"):  # a tool that attaches to the running game (The Witness randomizer)
            name = s["after_process"]
            threading.Thread(target=_start_after, args=(name, cmd, cwd), daemon=True).start()
            task.say(f"✔ {exe.name} يشتغل لحاله أول ما تفتح اللعبة")
        elif s.get("wait"):
            subprocess.run(cmd, cwd=cwd, check=True)
        else:
            subprocess.Popen(cmd, cwd=cwd)
            task.say(f"✔ شغّلت {exe.name}")


def process_running(name: str) -> bool:
    """Is a program with this exe name running? (Windows tasklist; False elsewhere)"""
    if os.name != "nt":
        return False
    try:
        out = subprocess.run(["tasklist", "/FI", f"IMAGENAME eq {name}", "/NH"], capture_output=True,
                             text=True, timeout=15, creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0)).stdout
    except (OSError, subprocess.SubprocessError):
        return False
    return name.lower() in out.lower()


def _start_after(name: str, cmd: list, cwd: str, timeout: float = 600, poll: float = 3, sleep=None):
    """Wait (up to 10 min) for the game's process, give it a few seconds to load, then start cmd."""
    import time
    sleep = sleep or time.sleep
    waited = 0.0
    while waited < timeout:
        if process_running(name):
            sleep(8)
            subprocess.Popen(cmd, cwd=cwd)
            return True
        sleep(poll)
        waited += poll
    return False


def run_phases(task: Task, recipe: dict, phases: list, session: dict = None, options: dict = None):
    """options: the player's choices (effective_options); steps with "when" run only if they match."""
    settings = load_settings()
    if stores.stores(recipe) and not stores.locate(recipe, settings):
        # not found anywhere we look: install it, or show us the folder (another drive, GOG, Epic, Xbox...)
        where = " أو ".join(stores.STORE_AR[x] for x in stores.stores(recipe))
        text = (f"ما لقيت {recipe['name']} في جهازك. ثبّتها من {where}، "
                "ولو هي مثبتة في مكان ثاني (قرص ثاني، أو من متجر ثاني) اضغط «اختر مجلد اللعبة».")
        raise NeedsUser({"id": "_game_folder", "kind": "folder",
                         "url": f"steam://install/{recipe['steam_appid']}" if recipe.get("steam_appid") else None},
                        text, recipe["id"])
    ensure_archipelago(task, settings)
    ctx = context(recipe, settings, session)
    if options is None:
        options = recipes.effective_options(recipe, {})
    for phase in phases:
        for step in recipe.get(phase, []):
            if step.get("when") and not recipes.step_applies(step, options):
                continue
            run_step(step, ctx, settings, recipe, task)
    return "ok"


def mark_done(recipe_id: str, step_id: str):
    s = load_settings()
    s["done_steps"][f"{recipe_id}:{step_id}"] = True
    save_settings(s)
