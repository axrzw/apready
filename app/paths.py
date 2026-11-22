"""Shared paths and settings storage."""
import json
import os
import sys
from pathlib import Path

APP_NAME = "APReady"


def base_dir() -> Path:
    """Folder that holds recipes/ and ui/ (works both from source and from a PyInstaller exe)."""
    if getattr(sys, "frozen", False):
        return Path(getattr(sys, "_MEIPASS", Path(sys.executable).parent))
    return Path(__file__).resolve().parent.parent


def data_dir() -> Path:
    root = os.environ.get("APPDATA") or str(Path.home() / ".config")
    d = Path(root) / APP_NAME
    d.mkdir(parents=True, exist_ok=True)
    return d


def tools_dir() -> Path:
    d = data_dir() / "tools"
    d.mkdir(parents=True, exist_ok=True)
    return d


def players_dir() -> Path:
    """Host drops friends' YAML files here."""
    d = data_dir() / "players"
    d.mkdir(parents=True, exist_ok=True)
    return d


def default_ap_dir() -> Path:
    return Path(os.environ.get("PROGRAMDATA", "C:/ProgramData")) / "Archipelago"


SETTINGS_FILE = "settings.json"


def load_settings() -> dict:
    f = data_dir() / SETTINGS_FILE
    if f.exists():
        try:
            return json.loads(f.read_text(encoding="utf-8"))
        except Exception:
            pass
    return {"player_name": "", "done_steps": {}, "installed": {}, "ap_dir": ""}


def save_settings(s: dict) -> None:
    f = data_dir() / SETTINGS_FILE
    f.write_text(json.dumps(s, ensure_ascii=False, indent=2), encoding="utf-8")


def documents_dir() -> Path:
    """The real Documents folder (it can be moved, e.g. into OneDrive)."""
    if sys.platform == "win32":
        try:
            import winreg
            key = r"Software\Microsoft\Windows\CurrentVersion\Explorer\User Shell Folders"
            with winreg.OpenKey(winreg.HKEY_CURRENT_USER, key) as k:
                p = Path(os.path.expandvars(winreg.QueryValueEx(k, "Personal")[0]))
                if p.exists():
                    return p
        except OSError:
            pass
    return Path.home() / "Documents"


def ap_dir(settings: dict) -> Path:
    return Path(settings.get("ap_dir") or default_ap_dir())
