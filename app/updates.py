"""Keep the game list fresh: download the recipes from the project's own GitHub repo.

Only this one repo (the owner's) is ever used, so friends get new games without a new exe
and nobody can point the app at random code. Each downloaded recipe is validated before it
is used; anything this app version can't read is ignored and the shipped recipe stays.
"""
import json
import urllib.request
from pathlib import Path

from . import recipes as rec
from .paths import data_dir, load_settings
from .runner import http_json

DEFAULT_REPO = "axrzw/apready"
DEFAULT_BRANCH = "main"
LISTING = "https://api.github.com/repos/{repo}/contents/recipes?ref={branch}"


def remote_dir() -> Path:
    d = data_dir() / "recipes_remote"
    d.mkdir(parents=True, exist_ok=True)
    return d


def source() -> tuple:
    s = load_settings()
    return s.get("recipes_repo") or DEFAULT_REPO, s.get("recipes_branch") or DEFAULT_BRANCH


def _get(url: str) -> bytes:
    req = urllib.request.Request(url, headers={"User-Agent": "APReady"})
    with urllib.request.urlopen(req, timeout=30) as r:
        return r.read()


def update(listing_fn=http_json, get_fn=_get) -> dict:
    """Sync %APPDATA%/APReady/recipes_remote with the repo. Returns {"new": [...], "updated": [...],
    "skipped": [...]}; raises on network errors (the caller just keeps the old list)."""
    repo, branch = source()
    folder = remote_dir()
    index_file = folder / "_index.json"
    try:
        index = json.loads(index_file.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        index = {}
    listing = [e for e in listing_fn(LISTING.format(repo=repo, branch=branch))
               if e.get("type") == "file" and e.get("name", "").endswith(".json")]
    result = {"new": [], "updated": [], "skipped": []}
    keep = set()
    for e in listing:
        name = e["name"]
        if "/" in name or "\\" in name or name.startswith("."):
            continue
        keep.add(name)
        target = folder / name
        if index.get(name) == e.get("sha") and target.exists():
            continue
        try:
            raw = get_fn(e["download_url"])
            r = rec.validate(json.loads(raw.decode("utf-8")), name)
        except Exception:
            result["skipped"].append(name)  # broken, or uses something this app version doesn't know
            continue
        (result["updated"] if target.exists() else result["new"]).append(r["name"])  # games keep their own name
        target.write_bytes(raw)
        index[name] = e.get("sha")
    for f in folder.glob("*.json"):
        if f.name != "_index.json" and f.name not in keep:  # removed from the repo
            f.unlink()
            index.pop(f.name, None)
    index_file.write_text(json.dumps(index, indent=1), encoding="utf-8")
    return result


# ---------- the app itself: a newer release downloads quietly, the player presses one button to switch ----------

RELEASES = "https://api.github.com/repos/{repo}/releases/latest"
APP_ASSET = "MyReadyAP.exe"


def version_tuple(v: str):
    """'v1.0.1' -> (1, 0, 1); anything else (dev builds, test tags) -> None (never compared)."""
    import re
    m = re.fullmatch(r"v?(\d+)\.(\d+)\.(\d+)", (v or "").strip())
    return tuple(int(x) for x in m.groups()) if m else None


def check_app_update(current: str, listing_fn=http_json, get_fn=_get):
    """Download the latest release's exe when it is newer than this one. Only the project's own repo
    (DEFAULT_REPO, never a setting). Returns {"tag", "path"} or None."""
    cur = version_tuple(current)
    if not cur:
        return None
    rel = listing_fn(RELEASES.format(repo=DEFAULT_REPO))
    tag = rel.get("tag_name", "")
    new = version_tuple(tag)
    if not new or new <= cur or rel.get("prerelease") or rel.get("draft"):
        return None
    asset = next((a for a in rel.get("assets", []) if a.get("name") == APP_ASSET), None)
    if not asset:
        return None
    dest = data_dir() / "update" / f"MyReadyAP-{tag}.exe"
    if not dest.exists():
        data = get_fn(asset["browser_download_url"])
        if not data.startswith(b"MZ") or len(data) < 1_000_000:  # a Windows program, not an error page
            return None
        dest.parent.mkdir(parents=True, exist_ok=True)
        tmp = dest.with_suffix(".part")
        tmp.write_bytes(data)
        tmp.replace(dest)
        for old in dest.parent.glob("MyReadyAP-*.exe"):  # keep only the newest download
            if old != dest:
                try:
                    old.unlink()
                except OSError:
                    pass
    return {"tag": tag, "path": str(dest)}
