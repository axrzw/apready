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
        (result["updated"] if target.exists() else result["new"]).append(r.get("name_ar") or r["name"])
        target.write_bytes(raw)
        index[name] = e.get("sha")
    for f in folder.glob("*.json"):
        if f.name != "_index.json" and f.name not in keep:  # removed from the repo
            f.unlink()
            index.pop(f.name, None)
    index_file.write_text(json.dumps(index, indent=1), encoding="utf-8")
    return result
