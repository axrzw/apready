"""Dry run of recipes with the REAL downloads, on a fake Steam layout (dev tool, not in the exe).

Every step runs for real (GitHub releases, Thunderstore, raw files, extraction, config writing) except
that nothing is started: launches and installers are recorded instead. Each recipe runs twice; the second
run must download nothing new and ask nothing. Used by CI (dry-run.yml) and by hand:

    python -m tools.dry_run <work folder> [recipe ids...]

GITHUB_TOKEN (if set) is sent to api.github.com so CI is not rate limited.
"""
import json
import os
import sys
import types
import urllib.request
from pathlib import Path

# files a real game folder has and that recipes read or start (fake Steam has empty game folders)
GAME_FILES = {
    "portal2": ["portal2.exe"],
    "buckshot": ["Buckshot Roulette_windows/Buckshot Roulette.exe"],
    "doom_1993": ["base/DOOM.WAD"],
    "doom_ii": ["base/DOOM2.WAD"],
    "heretic": ["base/HERETIC.WAD"],
}


def main(argv):
    repo = Path(__file__).resolve().parents[1]
    root = Path(argv[0]).resolve()
    root.mkdir(parents=True, exist_ok=True)
    os.environ["APPDATA"] = str(root / "appdata")
    os.environ["LOCALAPPDATA"] = str(root / "localappdata")
    sys.path.insert(0, str(repo))
    from app import paths, recipes as rec, runner, steam

    token = os.environ.get("GITHUB_TOKEN")
    real_json = runner.http_json

    def http_json(url):
        if token and "api.github.com" in url:
            req = urllib.request.Request(url, headers={**runner.UA, "Authorization": f"Bearer {token}"})
            with urllib.request.urlopen(req, timeout=30) as r:
                return json.loads(r.read().decode("utf-8"))
        return real_json(url)

    runner.http_json = http_json

    all_r = rec.load_all(repo / "recipes")
    only = argv[1:] or sorted(all_r)

    # fake Steam with every game installed
    steam_root = root / "Steam"
    apps = steam_root / "steamapps"
    (apps / "sourcemods").mkdir(parents=True, exist_ok=True)
    folders = {}  # appid -> game folder (DOOM and DOOM II are one Steam game)
    for r in all_r.values():
        if not r.get("steam_appid"):
            continue
        if r["steam_appid"] not in folders:
            name = r["name"].replace(":", "")
            (apps / f"appmanifest_{r['steam_appid']}.acf").write_text(f'"AppState"\n{{\n "installdir" "{name}"\n}}')
            folders[r["steam_appid"]] = apps / "common" / name
        game = folders[r["steam_appid"]]
        game.mkdir(parents=True, exist_ok=True)
        for rel in GAME_FILES.get(r["id"], []):
            (game / rel).parent.mkdir(parents=True, exist_ok=True)
            (game / rel).write_text("")
        for phase in ("apworld", "install", "connect", "launch"):
            for s in r.get(phase, []):
                if s["type"] == "workshop":  # Steam already downloaded the subscribed item
                    w = apps / "workshop" / "content" / str(s.get("appid", r["steam_appid"])) / str(s["workshop_id"])
                    w.mkdir(parents=True, exist_ok=True)
                    (w / "x").write_text("")
    steam.steam_root = lambda: steam_root

    apd = root / "Archipelago"
    apd.mkdir(exist_ok=True)
    (apd / "ArchipelagoLauncher.exe").write_text("")
    paths.default_ap_dir = lambda: apd
    runner.ap_dir = lambda s: apd
    runner.documents_dir = lambda: root / "Documents"

    downloads = []
    real_download = runner.download
    runner.download = lambda url, dest, task: (downloads.append(url), real_download(url, dest, task))[1]

    opened, ran = [], []
    runner.webbrowser.open = lambda u: opened.append(u)

    def fake_run(cmd, cwd=None, check=None):
        ran.append(["WAIT"] + list(cmd))
        if str(cmd[0]).endswith("SMAPI.Installer.exe"):  # what the real installer leaves behind
            Path(cmd[cmd.index("--game-path") + 1], "StardewModdingAPI.exe").write_text("")
        if "mod_loader_setup.gd" in " ".join(map(str, cmd)):
            Path(cmd[0]).with_name("Buckshot Roulette-vanilla.exe").write_text("")
        if str(cmd[0]).endswith("MiniInstaller-win64.exe"):  # Everest's installer leaves everest-lib behind
            Path(cmd[0]).with_name("everest-lib").mkdir(exist_ok=True)

    runner.subprocess = types.SimpleNamespace(Popen=lambda cmd, cwd=None: ran.append(list(cmd)), run=fake_run)

    session = {"slot": "Mishal", "host": "archipelago.gg", "port": "38281", "password": "pw"}
    failed = []
    for rid in only:
        r = all_r[rid]
        for attempt in (1, 2):
            opened.clear(), ran.clear(), downloads.clear()
            task = runner.Task()
            prompts, err = [], None
            for _ in range(10):
                try:
                    runner.run_phases(task, r, ["apworld", "install", "connect", "launch"], session)
                    break
                except runner.NeedsUser as e:
                    prompts.append(e.step["id"])
                    runner.mark_done(rid, e.step["id"])
                except Exception as e:  # noqa: BLE001 - report every failure
                    err = f"{type(e).__name__}: {e}"
                    break
            print(f"\n===== {rid} (run {attempt})  prompts={prompts}  downloads={len(downloads)}  ERROR={err}")
            for line in task.log:
                print("  ", line)
            for c in ran:
                print("   RUN", c)
            for u in opened:
                print("   OPEN", u)
            if err or (attempt == 2 and (prompts or downloads)):
                failed.append(f"{rid} (run {attempt}): {err or 'second run asked/downloaded again'}")
                break
    for rid in only:  # map packs: the uid and variant PopTracker is started with must be in the pack
        mt = all_r[rid].get("map_tracker")
        if mt:
            problem = check_pack(mt)
            print(f"MAP {rid}: {problem or 'ok'}")
            if problem:
                failed.append(f"{rid} map: {problem}")
    print("\n" + ("FAILED:\n  " + "\n  ".join(failed) if failed else f"OK: {len(only)} recipes"))
    return 1 if failed else 0


def check_pack(mt: dict) -> str:
    """'' when the pack zip has a manifest.json (root or one folder down) with this uid and variant(s)."""
    import io
    import zipfile
    from app import maptracker
    req = urllib.request.Request(mt["download"], headers={"User-Agent": "APReady"})
    with urllib.request.urlopen(req, timeout=120) as r:
        z = zipfile.ZipFile(io.BytesIO(r.read()))
    names = [n for n in z.namelist() if n.endswith("manifest.json") and n.count("/") <= 1]
    if not names:
        return "no manifest.json at the top of the zip"
    m = json.loads(z.read(sorted(names, key=len)[0]).decode("utf-8-sig"))
    if m.get("package_uid") != mt["uid"]:
        return f"uid is {m.get('package_uid')!r}, recipe says {mt['uid']!r}"
    variants = set((m.get("variants") or {}).keys())
    wanted = {mt.get("variant")} | {v["variant"] for v in mt.get("variant_if", [])}
    wanted.discard("")
    wanted.discard(None)
    missing = wanted - variants
    return f"variants {sorted(missing)} not in {sorted(variants)}" if missing else ""


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
