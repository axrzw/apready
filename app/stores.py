"""Where is the game installed? Steam first, but also a folder the player picked themselves, GOG Galaxy and
the Epic Games launcher, for recipes whose mod works with those copies ("stores": ["steam", "gog", "epic"]).

    locate(recipe, settings) -> {"dir": Path, "store": "folder"|"steam"|"gog"|"epic", "epic_app": str} or None

A picked folder wins (the player said so). GOG games are found in the registry (GOG.com\\Games\\<id>), Epic games
in the launcher's manifests (ProgramData\\Epic\\EpicGamesLauncher\\Data\\Manifests\\*.item), matched by name.
"""
import json
import os
import re
import sys
from pathlib import Path
from typing import Optional

from . import steam

STORE_AR = {"steam": "ستيم", "gog": "GOG", "epic": "Epic", "folder": "مجلد اخترته"}


def _norm(name: str) -> str:
    return re.sub(r"[^a-z0-9]", "", (name or "").lower())


def names(recipe: dict) -> set:
    return {_norm(n) for n in (recipe.get("store_names") or [recipe.get("name", ""), recipe.get("game", "")]) if n}


def stores(recipe: dict) -> list:
    """The stores whose copy of the game this recipe's mod supports."""
    return recipe.get("stores") or (["steam"] if recipe.get("steam_appid") else [])


def epic_manifest_dir() -> Path:
    return Path(os.environ.get("PROGRAMDATA", "C:/ProgramData")) / "Epic" / "EpicGamesLauncher" / "Data" / "Manifests"


def epic_games(folder: Path = None) -> list:
    """[{"name", "dir", "app", "exe"}] from the Epic launcher's install manifests."""
    out = []
    folder = folder or epic_manifest_dir()
    try:
        files = sorted(folder.glob("*.item"))
    except OSError:
        return out
    for f in files:
        try:
            m = json.loads(f.read_text(encoding="utf-8", errors="ignore"))
        except (OSError, ValueError):
            continue
        if isinstance(m, dict) and m.get("InstallLocation"):
            out.append({"name": m.get("DisplayName", ""), "dir": Path(m["InstallLocation"]),
                        "app": m.get("AppName", ""), "exe": m.get("LaunchExecutable", "")})
    return out


def gog_games() -> list:
    """[{"name", "dir", "exe"}] from GOG's registry keys (GOG Galaxy and the offline installers write them)."""
    out = []
    if sys.platform != "win32":
        return out
    try:
        import winreg
    except ImportError:
        return out
    for base in (r"SOFTWARE\WOW6432Node\GOG.com\Games", r"SOFTWARE\GOG.com\Games"):
        try:
            root = winreg.OpenKey(winreg.HKEY_LOCAL_MACHINE, base)
        except OSError:
            continue
        with root:
            i = 0
            while True:
                try:
                    sub = winreg.EnumKey(root, i)
                except OSError:
                    break
                i += 1
                try:
                    with winreg.OpenKey(root, sub) as k:
                        vals = {}
                        for v in ("gameName", "path", "PATH", "exe", "EXE"):
                            try:
                                vals[v.lower()] = winreg.QueryValueEx(k, v)[0]
                            except OSError:
                                pass
                except OSError:
                    continue
                if vals.get("path"):
                    out.append({"name": vals.get("gamename", ""), "dir": Path(vals["path"]), "exe": vals.get("exe", "")})
    return out


def folder_ok(recipe: dict, d: Path) -> bool:
    """A picked folder is right when the game's exe is in it (when the recipe names one)."""
    if not d or not d.is_dir():
        return False
    exe = recipe.get("exe")
    return not exe or any(d.glob(exe))


def locate(recipe: dict, settings: dict = None) -> Optional[dict]:
    rid = recipe.get("id", "")
    picked = ((settings or {}).get("game_dirs") or {}).get(rid)
    if picked and folder_ok(recipe, Path(picked)):
        return {"dir": Path(picked), "store": "folder", "epic_app": ""}
    st = stores(recipe)
    if recipe.get("steam_appid") and "steam" in st:
        d = steam.game_dir(recipe["steam_appid"])
        if d:
            return {"dir": d, "store": "steam", "epic_app": ""}
    want = names(recipe)
    if "gog" in st:
        for g in gog_games():
            if _norm(g["name"]) in want and g["dir"].is_dir():
                return {"dir": g["dir"], "store": "gog", "epic_app": ""}
    if "epic" in st:
        for g in epic_games():
            if _norm(g["name"]) in want and g["dir"].is_dir():
                return {"dir": g["dir"], "store": "epic", "epic_app": g["app"]}
    return None


def pick_folder() -> str:
    """Windows' own folder picker (no extra libraries). '' when cancelled or not on Windows."""
    if sys.platform != "win32":
        return ""
    import subprocess
    ps = ("Add-Type -AssemblyName System.Windows.Forms;"
          "$f = New-Object System.Windows.Forms.FolderBrowserDialog;"
          "$f.Description = 'مجلد اللعبة (اللي فيه ملف تشغيلها)';"
          "$f.ShowNewFolderButton = $false;"
          "if ($f.ShowDialog() -eq 'OK') { [Console]::OutputEncoding = [Text.Encoding]::UTF8; $f.SelectedPath }")
    try:
        r = subprocess.run(["powershell", "-NoProfile", "-STA", "-Command", ps], capture_output=True, timeout=600,
                           creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0))
    except (OSError, subprocess.SubprocessError):
        return ""
    return r.stdout.decode("utf-8", errors="ignore").strip()
