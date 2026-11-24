"""Map trackers: PopTracker plus the game's map pack, opened already connected to the room.

PopTracker (black-sliver/PopTracker) is the tracker most Archipelago map packs are made for. It takes
`--load-pack <uid> --pack-variant <v> --ap-host <host:port> --ap-slot <name> [--ap-password <pw>]`, so one
button opens the right map and it follows the player's checks by itself. Recipes carry the pack:

    "map_tracker": {"uid": "...", "variant": "standard", "download": "https://github.com/<o>/<r>/...zip",
                    "variant_if": [{"if": {"use_dlc": [true]}, "variant": "var_dlc"}]}

`download` is a release asset or a tag's source zip of the pack's own GitHub repo (PopTracker reads a zip
with the pack at the root or in one top folder). Only github.com links are accepted. Everything lives in
%APPDATA%/APReady/tools/poptracker (portable: packs go in its own packs folder).
"""
import os
import re
import subprocess
from pathlib import Path

from . import runner
from .paths import load_settings, save_settings, tools_dir

POPTRACKER_REPO = "black-sliver/PopTracker"
POPTRACKER_ASSET = "poptracker_*_win64.zip"
PACK_URL = re.compile(r"https://github\.com/[\w.-]+/[\w.-]+/(releases/download/[^\s]+|archive/refs/tags/[^\s/]+)\.zip")


def home() -> Path:
    return tools_dir() / "poptracker"


def validate(mt: dict, source: str = ""):
    if not isinstance(mt, dict) or not mt.get("uid") or not isinstance(mt.get("uid"), str):
        raise ValueError(f"{source}: map_tracker needs a uid")
    if not PACK_URL.fullmatch(str(mt.get("download", ""))):
        raise ValueError(f"{source}: map_tracker download must be a github.com release or tag zip")


def variant_for(mt: dict, options: dict) -> str:
    for rule in mt.get("variant_if", []):
        if all(options.get(k) in v for k, v in rule["if"].items()):
            return rule["variant"]
    return mt.get("variant", "")


def ensure_poptracker(task) -> Path:
    """Download PopTracker once (and again when a new release is out). Returns poptracker.exe."""
    s = load_settings()
    rel = runner.pick_release(POPTRACKER_REPO)
    version = rel.get("tag_name", "")
    exe = home() / "poptracker.exe"
    if s.get("installed", {}).get("poptracker") == version and exe.exists():
        task.say(f"✔ PopTracker محدث ({version})")
        return exe
    import fnmatch
    asset = next((a for a in rel.get("assets", []) if fnmatch.fnmatch(a["name"], POPTRACKER_ASSET)), None)
    if not asset:
        raise RuntimeError("ما لقيت ملف PopTracker حق ويندوز في آخر إصدار")
    task.say(f"… أنزّل PopTracker {version}")
    z = tools_dir() / "_downloads" / asset["name"]
    runner.download(asset["browser_download_url"], z, task)
    runner.extract_zip(z, home(), strip=True)  # the zip has one top folder "poptracker/"
    (home() / "portable.txt").write_text("", encoding="utf-8")  # packs and settings stay in its own folder
    s = load_settings()
    s.setdefault("installed", {})["poptracker"] = version
    save_settings(s)
    task.say(f"✔ PopTracker {version}")
    return exe


def quiet_first_run():
    """PopTracker asks two questions on its first run ('Check for PopTracker updates on start?' and 'Add
    Documents\\EmoTracker\\packs to the search path?') and loads nothing until someone answers. Answer them
    in its own (portable) config: the app keeps PopTracker up to date itself."""
    import json
    cfg = home() / "portable-config" / "PopTracker" / "PopTracker.json"
    try:
        data = json.loads(cfg.read_text(encoding="utf-8")) if cfg.exists() else {}
    except ValueError:
        data = {}
    # its two first-run questions: updates on start, and adding EmoTracker's pack folder
    first_run = {"check_for_updates": False, "add_emo_packs": False}
    if any(data.get(k) is not v for k, v in first_run.items()):
        data.update(first_run)
        cfg.parent.mkdir(parents=True, exist_ok=True)
        cfg.write_text(json.dumps(data, indent=4), encoding="utf-8")


def ensure_pack(recipe: dict, task) -> Path:
    mt = recipe["map_tracker"]
    validate(mt, recipe["id"])
    url = mt["download"]
    dest = home() / "packs" / (re.sub(r"[^\w.-]+", "_", mt["uid"]) + ".zip")
    s = load_settings()
    if s.get("installed", {}).get(f"pack:{mt['uid']}") == url and dest.exists():
        task.say(f"✔ خريطة {recipe['name']} موجودة")
        return dest
    task.say(f"… أنزّل خريطة {recipe['name']}")
    runner.download(url, dest, task)
    s = load_settings()
    s.setdefault("installed", {})[f"pack:{mt['uid']}"] = url
    save_settings(s)
    task.say(f"✔ خريطة {recipe['name']}")
    return dest


def command(exe: Path, recipe: dict, options: dict, host: str, port, slot: str, password: str = "") -> list:
    mt = recipe["map_tracker"]
    args = [str(exe), "--load-pack", mt["uid"]]
    variant = variant_for(mt, options)
    if variant:
        args += ["--pack-variant", variant]
    args += ["--ap-host", f"{host}:{port}", "--ap-slot", slot]
    if password:
        args += ["--ap-password", password]
    return args


def open_map(task, recipe: dict, options: dict, host: str, port, slot: str, password: str = ""):
    if os.name != "nt":
        raise RuntimeError("الخريطة تشتغل على ويندوز بس")
    exe = ensure_poptracker(task)
    ensure_pack(recipe, task)
    quiet_first_run()
    subprocess.Popen(command(exe, recipe, options, host, port, slot, password), cwd=str(exe.parent))
    task.say(f"✔ فتحت خريطة {recipe['name']}. تتصل بالروم لحالها وتتحدّث كل ما سويت تشيك.")
    task.say(f"👉 لو ما اتصلت خلال دقيقة: في PopTracker اضغط AP فوق يسار، واكتب {host}:{port} والاسم {slot}.")
    return "ok"
