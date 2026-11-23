"""The app's own window: Edge (or Chrome) in app mode, so friends get a normal program window with
our icon and no address bar, and the app quits when that window is closed.

Edge ships with every Windows 10/11, so nothing extra is bundled (the exe stays small). If no such
browser is found, the page opens in the default browser like before. The window uses its own
profile under %APPDATA%/APReady/window, so it is its own process and we can tell when it closes.
"""
import json
import os
import subprocess
import time
import urllib.request
import webbrowser
from pathlib import Path

from .paths import data_dir

NO_WINDOW = 0x08000000  # CREATE_NO_WINDOW: no black console box for helper commands
HEARTBEAT_TIMEOUT = 150  # the page pings every 5 s; browsers can slow a minimized page to once a minute

_last_ping = [0.0]


def ping():
    _last_ping[0] = time.time()


def find_browser():
    """Edge first (always there on Windows 10/11), then Chrome, then Brave."""
    roots = [os.environ.get(k) for k in ("ProgramFiles(x86)", "ProgramFiles", "LOCALAPPDATA")]
    names = ["Microsoft/Edge/Application/msedge.exe", "Google/Chrome/Application/chrome.exe",
             "BraveSoftware/Brave-Browser/Application/brave.exe"]
    for name in names:
        for root in roots:
            if root and (Path(root) / name).is_file():
                return str(Path(root) / name)
    return None


def browser_args(exe: str, url: str) -> list:
    return [exe, f"--app={url}", f"--user-data-dir={data_dir() / 'window'}", "--window-size=1150,950",
            "--no-first-run", "--no-default-browser-check", "--disable-sync", "--lang=ar"]


def open_window(url: str):
    """Open the app window. Returns the browser process, or None when it fell back to a browser tab."""
    exe = find_browser()
    if exe:
        try:
            return subprocess.Popen(browser_args(exe, url))
        except OSError:
            pass
    webbrowser.open(url)
    return None


def wait_until_closed(proc, stop):
    """Block until the user is done, then call stop(). With our own window: when its process ends.
    Otherwise (a normal browser tab): when the page stops pinging for a while."""
    started = time.time()
    if proc is not None:
        proc.wait()
        if time.time() - started > 10:  # a real window that was used and closed
            return stop()
        # it ended at once: it handed the page to a window of ours that was already open; use pings
    while True:
        time.sleep(5)
        seen = _last_ping[0]
        if seen and time.time() - seen > HEARTBEAT_TIMEOUT:
            return stop()
        if not seen and time.time() - started > 600:  # the page never came up
            return stop()


# ---------- one copy at a time ----------

def _running_file() -> Path:
    return data_dir() / "running.json"


def already_running():
    """URL of a copy of the app that is already running, else None."""
    try:
        url = json.loads(_running_file().read_text(encoding="utf-8"))["url"]
        with urllib.request.urlopen(url + "api/ping", timeout=2) as r:
            if json.loads(r.read()).get("app") == "MyReadyAP":
                return url
    except Exception:
        pass
    return None


def mark_running(url: str):
    _running_file().write_text(json.dumps({"url": url, "pid": os.getpid()}), encoding="utf-8")


def clear_running():
    try:
        _running_file().unlink()
    except OSError:
        pass


# ---------- shortcuts on the desktop and in the Start menu ----------

def make_shortcuts(exe: str) -> bool:
    """Create (or repoint) the 'My Ready AP' shortcuts on the Desktop and in the Start menu."""
    if os.name != "nt" or not exe.lower().endswith(".exe"):
        return False
    ps = ("$s=New-Object -ComObject WScript.Shell;"
          "foreach($d in @([Environment]::GetFolderPath('Desktop'),[Environment]::GetFolderPath('Programs'))){"
          "$l=$s.CreateShortcut((Join-Path $d 'My Ready AP.lnk'));"
          "$l.TargetPath=$env:MRAP_EXE;$l.WorkingDirectory=(Split-Path $env:MRAP_EXE);"
          "$l.IconLocation=$env:MRAP_EXE+',0';$l.Save()}")
    try:
        subprocess.run(["powershell", "-NoProfile", "-NonInteractive", "-Command", ps],
                       env={**os.environ, "MRAP_EXE": exe}, creationflags=NO_WINDOW, timeout=30, check=False)
    except Exception:
        return False
    return True
