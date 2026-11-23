"""First run of a downloaded exe: put the app in a fixed place and on the desktop.

Friends download MyReadyAP.exe into Downloads (or anywhere) and double-click it. That copy installs
itself to %LOCALAPPDATA%/Programs/MyReadyAP (no admin needed), makes "My Ready AP" shortcuts on the
Desktop and in the Start menu that point there, and reopens from there. A newer exe run the same way
replaces the installed one (a running copy is asked to quit first), so updating is: download, run.
"""
import hashlib
import os
import shutil
import subprocess
import sys
import time
import urllib.request
from pathlib import Path

from . import window
from .paths import load_settings, save_settings

DETACHED = 0x00000008 | 0x00000200  # DETACHED_PROCESS | CREATE_NEW_PROCESS_GROUP


def install_target() -> Path:
    local = os.environ.get("LOCALAPPDATA") or str(Path.home() / "AppData" / "Local")
    return Path(local) / "Programs" / "MyReadyAP" / "MyReadyAP.exe"


def _same(a, b) -> bool:
    return os.path.normcase(os.path.abspath(str(a))) == os.path.normcase(os.path.abspath(str(b)))


def _same_file(a, b) -> bool:
    try:
        pa, pb = Path(a), Path(b)
        if not pb.exists() or pa.stat().st_size != pb.stat().st_size:
            return False
        return hashlib.sha256(pa.read_bytes()).digest() == hashlib.sha256(pb.read_bytes()).digest()
    except OSError:
        return False


def ensure_shortcuts(exe: str) -> bool:
    """Shortcuts for this exe path, once per path: a shortcut the user deleted stays deleted,
    but moving the app (or installing it) points them at the new place."""
    s = load_settings()
    if s.get("shortcuts_for") == exe:
        return False
    if not window.make_shortcuts(exe):
        return False
    s = load_settings()
    s["shortcuts_for"] = exe
    save_settings(s)
    return True


def quit_running_copy():
    url = window.already_running()
    if not url:
        return
    try:
        req = urllib.request.Request(url + "api/quit", data=b"{}", headers={"Content-Type": "application/json"})
        urllib.request.urlopen(req, timeout=3).read()
    except Exception:
        pass
    for _ in range(20):
        if not window.already_running():
            break
        time.sleep(0.5)
    time.sleep(1)  # let the old exe file be released


def relocate(exe: str = None) -> bool:
    """Running from somewhere else (Downloads...): install to the fixed place, make shortcuts, start
    that copy. True means the installed copy was started and this one should just exit."""
    exe = exe or sys.executable
    target = install_target()
    if _same(exe, target):
        return False
    env = {k: v for k, v in os.environ.items() if not k.startswith("_PYI") and k != "_MEIPASS2"}
    env["PYINSTALLER_RESET_ENVIRONMENT"] = "1"  # the new copy unpacks itself, not using this one's temp files
    if _same_file(exe, target):  # same version opened from Downloads again: just open the installed one
        ensure_shortcuts(str(target))
        subprocess.Popen([str(target)], cwd=str(target.parent), env=env, close_fds=True,
                         creationflags=DETACHED if os.name == "nt" else 0)
        return True
    quit_running_copy()
    try:
        target.parent.mkdir(parents=True, exist_ok=True)
        for attempt in range(5):
            try:
                shutil.copyfile(exe, target)  # the program itself, like any installer writes it
                break
            except PermissionError:  # the old copy is still closing
                if attempt == 4:
                    raise
                time.sleep(1)
    except OSError:
        return False  # can't install: just run from where it is
    s = load_settings()
    s.pop("shortcuts_for", None)  # an install always (re)makes the shortcuts
    save_settings(s)
    ensure_shortcuts(str(target))
    env["MRAP_JUST_INSTALLED"] = "1"  # the new copy must not just show an older copy's window
    subprocess.Popen([str(target)], cwd=str(target.parent), env=env, close_fds=True,
                     creationflags=DETACHED if os.name == "nt" else 0)
    return True
