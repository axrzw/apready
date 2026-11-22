"""Find Steam and installed Steam games (Windows registry + libraryfolders.vdf)."""
import re
import sys
from pathlib import Path
from typing import Optional


def steam_root() -> Optional[Path]:
    if sys.platform == "win32":
        try:
            import winreg
            for hive, key in (
                (winreg.HKEY_CURRENT_USER, r"Software\Valve\Steam"),
                (winreg.HKEY_LOCAL_MACHINE, r"SOFTWARE\WOW6432Node\Valve\Steam"),
            ):
                try:
                    with winreg.OpenKey(hive, key) as k:
                        for name in ("SteamPath", "InstallPath"):
                            try:
                                p = Path(winreg.QueryValueEx(k, name)[0])
                                if p.exists():
                                    return p
                            except OSError:
                                pass
                except OSError:
                    pass
        except ImportError:
            pass
    for p in (Path("C:/Program Files (x86)/Steam"), Path.home() / ".steam/steam",
              Path.home() / ".local/share/Steam"):
        if p.exists():
            return p
    return None


def parse_library_folders(vdf_text: str) -> list:
    """Return library paths from libraryfolders.vdf content."""
    paths = re.findall(r'"path"\s+"([^"]+)"', vdf_text)
    return [Path(p.replace("\\\\", "\\")) for p in paths]


def library_folders(root: Optional[Path] = None) -> list:
    root = root or steam_root()
    if not root:
        return []
    libs = [root]
    vdf = root / "steamapps" / "libraryfolders.vdf"
    if vdf.exists():
        for p in parse_library_folders(vdf.read_text(encoding="utf-8", errors="ignore")):
            if p not in libs:
                libs.append(p)
    return libs


def parse_install_dir(acf_text: str) -> Optional[str]:
    m = re.search(r'"installdir"\s+"([^"]+)"', acf_text)
    return m.group(1) if m else None


def game_dir(appid: int) -> Optional[Path]:
    """Install folder of a Steam game, or None if not installed."""
    for lib in library_folders():
        acf = lib / "steamapps" / f"appmanifest_{appid}.acf"
        if acf.exists():
            name = parse_install_dir(acf.read_text(encoding="utf-8", errors="ignore"))
            if name:
                d = lib / "steamapps" / "common" / name
                if d.exists():
                    return d
    return None


def workshop_item_dir(appid: int, workshop_id: str) -> Optional[Path]:
    """Folder of a subscribed Workshop item, or None if Steam hasn't downloaded it yet."""
    for lib in library_folders():
        d = lib / "steamapps" / "workshop" / "content" / str(appid) / str(workshop_id)
        if d.exists() and any(d.iterdir()):
            return d
    return None
