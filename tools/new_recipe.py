"""Make a recipe draft for a game, the way the Nov 2026 review did it by hand.

    python -m tools.new_recipe --sheet "Lethal Company"
    python -m tools.new_recipe --repo T0r1nn/APLC --thunderstore APLC-APLC
    python -m tools.new_recipe --repo owner/repo --apworld path/to/local.apworld   (offline)

What it does:
  1. finds the game's GitHub repo (from the Archipelago games sheet, or --repo),
  2. reads the latest release's assets and downloads the .apworld,
  3. reads the apworld's Python WITHOUT running it (ast): game name, options, Death Link
     key and type, client components,
  4. looks inside the other release zips to guess the mod loader and where files go,
  5. finds the Steam appid with Steam's store search,
  6. writes recipes/<id>.json ("verified": false) and prints what a human still has to check.

It never installs anything. The draft only points at the repo it found, so review it before
committing: an .apworld is code that will run on your friends' PCs.
"""
import argparse
import ast
import fnmatch
import io
import json
import re
import sys
import tempfile
import urllib.parse
import urllib.request
import xml.etree.ElementTree as ET
import zipfile
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

from app import recipes as rec  # noqa: E402
from app import runner  # noqa: E402

SHEET_XLSX = "https://docs.google.com/spreadsheets/d/1iuzDTOAvdoNe8Ne8i461qGNucg5OuEoF-Ikqs8aUQZw/export?format=xlsx"
STEAM_SEARCH = "https://store.steampowered.com/api/storesearch/?term={q}&l=english&cc=US"
NS = {"m": "http://schemas.openxmlformats.org/spreadsheetml/2006/main",
      "r": "http://schemas.openxmlformats.org/officeDocument/2006/relationships",
      "rel": "http://schemas.openxmlformats.org/package/2006/relationships"}

DEATH_LINK_OK = {"DeathLink", "Toggle", "DefaultOnToggle"}  # true/false works as the YAML value


def fetch(url: str) -> bytes:
    req = urllib.request.Request(url, headers={"User-Agent": "APReady-recipe-tool"})
    with urllib.request.urlopen(req, timeout=60) as r:
        return r.read()


# ---------- the Archipelago games sheet (xlsx export keeps the links) ----------

def sheet_rows(xlsx: bytes, tab: str = "Playable Worlds") -> list:
    z = zipfile.ZipFile(io.BytesIO(xlsx))
    wb = ET.fromstring(z.read("xl/workbook.xml"))
    wb_rels = ET.fromstring(z.read("xl/_rels/workbook.xml.rels"))
    rid = next(s.get(f"{{{NS['r']}}}id") for s in wb.find("m:sheets", NS) if s.get("name") == tab)
    target = next(r.get("Target") for r in wb_rels if r.get("Id") == rid)
    path = "xl/" + target.lstrip("/").replace("xl/", "")
    shared = []
    if "xl/sharedStrings.xml" in z.namelist():
        for si in ET.fromstring(z.read("xl/sharedStrings.xml")).findall("m:si", NS):
            shared.append("".join(t.text or "" for t in si.iter(f"{{{NS['m']}}}t")))
    sheet = ET.fromstring(z.read(path))
    rels_path = path.replace("worksheets/", "worksheets/_rels/") + ".rels"
    links = {}
    if rels_path in z.namelist():
        rels = {r.get("Id"): r.get("Target") for r in ET.fromstring(z.read(rels_path))}
        hl = sheet.find("m:hyperlinks", NS)
        for h in (hl if hl is not None else []):
            links[h.get("ref")] = rels.get(h.get(f"{{{NS['r']}}}id"))
    rows = []
    for row in sheet.find("m:sheetData", NS):
        cells = {}
        for c in row:
            ref = c.get("r")
            col = re.match(r"[A-Z]+", ref).group(0)
            v = c.find("m:v", NS)
            text = ""
            if c.get("t") == "s" and v is not None:
                text = shared[int(v.text)]
            elif c.get("t") == "inlineStr":
                text = "".join(t.text or "" for t in c.iter(f"{{{NS['m']}}}t"))
            elif v is not None:
                text = v.text or ""
            cells[col] = {"text": text, "link": links.get(ref)}
        rows.append(cells)
    return rows


def find_in_sheet(rows: list, game: str) -> dict:
    header = next(i for i, r in enumerate(rows) if r.get("A", {}).get("text") == "Game")
    names = {r.get("A", {}).get("text", "").strip().lower(): r for r in rows[header + 1:]}
    row = names.get(game.strip().lower())
    if not row:
        close = [n for n in names if game.lower() in n]
        raise SystemExit(f"'{game}' is not in the sheet. Close matches: {close[:10]}")
    get = lambda col: row.get(col, {})
    return {"game": get("A").get("text"), "stability": get("B").get("text"),
            "links": get("E").get("text"), "links_url": get("E").get("link"),
            "guide_url": get("F").get("link"), "notes": get("I").get("text")}


def repo_from_url(url: str):
    m = re.match(r"https?://(?:www\.)?github\.com/([^/]+)/([^/?#]+)", url or "")
    return f"{m.group(1)}/{m.group(2)}" if m else None


# ---------- reading an apworld without running it ----------

def _const(node):
    try:
        return ast.literal_eval(node)
    except Exception:
        return None


def analyze_apworld(data: bytes) -> dict:
    z = zipfile.ZipFile(io.BytesIO(data))
    sources = {n: z.read(n).decode("utf-8-sig", "ignore") for n in z.namelist() if n.endswith(".py")}
    game = None
    for n in z.namelist():
        if n.endswith("archipelago.json"):
            game = json.loads(z.read(n).decode("utf-8-sig")).get("game") or game
    classes, fields, components, uses_parser, mixin = {}, {}, [], False, False
    for name, src in sources.items():
        try:
            tree = ast.parse(src)
        except SyntaxError:
            continue
        uses_parser |= "get_base_parser" in src
        for node in ast.walk(tree):
            if isinstance(node, ast.ClassDef):
                bases = [getattr(b, "id", getattr(b, "attr", "")) for b in node.bases]
                if "DeathLinkMixin" in bases:
                    mixin = True
                info = {"bases": bases, "options": [], "aliases": [], "default": None, "display": None,
                        "range": [None, None], "doc": ast.get_docstring(node) or ""}
                for st in node.body:
                    if isinstance(st, ast.Assign) and len(st.targets) == 1 and isinstance(st.targets[0], ast.Name):
                        k, v = st.targets[0].id, _const(st.value)
                        if k.startswith("option_"):
                            info["options"].append((k[len("option_"):], v))
                        elif k.startswith("alias_"):
                            info["aliases"].append(k[len("alias_"):])
                        elif k == "default":
                            info["default"] = v if v is not None else getattr(st.value, "attr", None)
                        elif k == "display_name":
                            info["display"] = v
                        elif k == "range_start":
                            info["range"][0] = v
                        elif k == "range_end":
                            info["range"][1] = v
                        elif k == "game" and isinstance(v, str):
                            game = game or v
                    if isinstance(st, ast.AnnAssign) and isinstance(st.target, ast.Name):
                        ann = getattr(st.annotation, "id", getattr(st.annotation, "attr", None))
                        if ann:
                            fields.setdefault(node.name, {})[st.target.id] = ann
                        if st.target.id == "game" and st.value is not None and isinstance(_const(st.value), str):
                            game = game or _const(st.value)
                classes[node.name] = info
            if isinstance(node, ast.Call) and getattr(node.func, "id", "") == "Component" and node.args:
                v = _const(node.args[0])
                if isinstance(v, str):
                    components.append(v)
    # the options dataclass: the class whose fields reference option classes and that subclasses PerGameCommonOptions
    opt_fields = {}
    for cname, f in fields.items():
        if any("PerGameCommonOptions" in b or b.endswith("Options") for b in classes.get(cname, {}).get("bases", [])):
            opt_fields.update(f)
    if mixin:
        opt_fields.setdefault("death_link", "DeathLink")
    options = []
    for key, cls in opt_fields.items():
        if key in ("start_inventory_from_pool", "start_inventory", "local_items", "non_local_items",
                   "exclude_locations", "priority_locations", "start_hints", "start_location_hints",
                   "item_links", "plando_items", "progression_balancing", "accessibility"):
            continue
        c = classes.get(cls, {"bases": [cls], "options": [], "aliases": [], "default": None, "display": None, "range": [None, None], "doc": ""})
        kind = next((b for b in c["bases"] + [cls] if b in ("Choice", "TextChoice", "Toggle", "DefaultOnToggle",
                     "Range", "NamedRange", "DeathLink", "OptionSet", "OptionList", "OptionDict", "FreeText",
                     "OptionCounter", "ItemSet", "LocationSet", "ItemDict")), c["bases"][0] if c["bases"] else cls)
        options.append({"key": key, "class": cls, "kind": kind, **{k: c[k] for k in ("options", "aliases", "default", "display", "range", "doc")}})
    dl = [o for o in options if re.fullmatch(r"death_?link(_enabled)?", o["key"], re.I)]
    death = None
    if dl:
        o = dl[0]
        names = [n for n, _ in o["options"]] + o["aliases"]
        works = o["kind"] in DEATH_LINK_OK or (o["kind"] in ("Choice", "TextChoice") and "true" in names)
        death = {"key": o["key"], "kind": o["kind"], "true_works": works}
    return {"game": game, "options": options, "death_link": death, "components": components,
            "uses_base_parser": uses_parser, "mentions_deathlink": any("deathlink" in s.lower() for s in sources.values())}


# ---------- guessing how the mod installs ----------

def classify_zip(names: list) -> dict:
    names = [n.replace("\\", "/") for n in names]
    tops = {n.split("/")[0] for n in names if n}
    single_top = len(tops) == 1 and all("/" in n or n.endswith("/") for n in names)
    has = lambda pat: any(fnmatch.fnmatch(n, pat) for n in names)
    if has("BepInEx/plugins/*"):
        return {"loader": "bepinex", "to": "{game_dir}", "strip": False}
    if has("reframework/*") or has("*/reframework/*"):
        return {"loader": "reframework", "to": "{game_dir}", "strip": not has("reframework/*")}
    if has("Mods/*.dll") or has("*/Mods/*.dll"):
        return {"loader": "melonloader", "to": "{game_dir}", "strip": not has("Mods/*.dll")}
    if has("mods-unpacked/*"):
        return {"loader": "godot", "to": "{game_dir}/mods", "strip": False, "no_extract": True}
    if has("*.dll") or (single_top and has("*/*.dll")):
        return {"loader": "bepinex-plugin?", "to": "{game_dir}/BepInEx/plugins", "strip": False}
    return {"loader": "unknown", "to": "{game_dir}", "strip": single_top}


def steam_lookup(name: str):
    try:
        items = json.loads(fetch(STEAM_SEARCH.format(q=urllib.parse.quote(name))))["items"]
    except Exception:
        return None, None
    exact = [i for i in items if i["name"].lower() == name.lower()]
    best = (exact or items or [None])[0]
    return (best["id"], best["name"]) if best else (None, None)


def glob_for(name: str, all_names: list) -> str:
    """A glob that matches this asset across versions and nothing else in the release
    (CLAUDE.md: asset globs must match exactly one file). Falls back to the exact name."""
    ext = next((e for e in (".tar.gz", ".apworld", ".zip", ".dll", ".exe", ".7z") if name.endswith(e)), "")
    stem = name[: len(name) - len(ext)] if ext else name
    candidates = [
        re.sub(r"v?\d+(\.\d+)+(-[A-Za-z0-9.]+)?", "*", stem) + ext,   # Mod-1.2.0-hotfix.1.zip -> Mod-*.zip
        re.sub(r"v?\d+(\.\d+)+", "*", stem) + ext,                   # X-1.0-win.zip -> X-*-win.zip
    ]
    if re.search(r"\d$", stem):                                        # Mod-1.2.0.zip next to Mod-1.2.0-linux.zip
        candidates.append(re.sub(r"v?\d+(\.\d+)+$", "*[0-9]", stem) + ext)
    for g in candidates:
        g = re.sub(r"\*+", "*", g)
        if "*" in g and [n for n in all_names if fnmatch.fnmatch(n, g)] == [name]:
            return g
    return name


def slug(s: str) -> str:
    return re.sub(r"[^a-z0-9]+", "_", s.lower()).strip("_")[:40] or "game"


# ---------- building the draft ----------

def build(game_name, repo, release, apworld_info, appid, steam_name, mod_zips, thunderstore=None, sheet=None):
    todo = []
    rid = slug(apworld_info["game"] or game_name)
    names = [a["name"] for a in release["assets"]]
    apw = next(a["name"] for a in release["assets"] if a["name"].endswith(".apworld"))
    pre = bool(release.get("prerelease"))
    gh = lambda asset, **kw: {"type": "github_release", "repo": repo, "asset": glob_for(asset, names), **({"prerelease": True} if pre else {}), **kw}

    r = {
        "id": rid, "name": steam_name or apworld_info["game"] or game_name, "name_ar": steam_name or game_name,
        "game": apworld_info["game"], "steam_appid": appid, "verified": False,
        "notes_ar": ("⚠ في جدول ألعاب Archipelago مكتوبة غير مستقرة، توقعوا مشاكل. " if sheet and sheet.get("stability") != "Stable" else "")
        + "وصفة جديدة ما انجربت.",
        "sources": [u for u in (f"https://github.com/{repo}", f"https://github.com/{repo}/releases",
                                (sheet or {}).get("guide_url")) if u],
    }
    # Death Link
    d = apworld_info["death_link"]
    if d and d["key"] != "death_link":
        r["death_link_key"] = d["key"]
    if d and not d["true_works"]:
        todo.append(f"Death Link option '{d['key']}' is a {d['kind']}: 'true' is not a valid value. Ask the owner (see Slay the Spire).")
    if not d:
        r["death_link_key"] = None
        todo.append("The apworld has no Death Link option. Check the MOD: if it has Death Link itself, set death_link_in_mod "
                    "(like TUNIC / Buckshot); if not, leave the toggle greyed out." + (" (the apworld mentions deathlink somewhere)" if apworld_info["mentions_deathlink"] else ""))

    r["apworld"] = [gh(apw, to="{custom_worlds}", label=f"{r['name']} apworld")]
    install = []
    if thunderstore:
        install.append({"type": "thunderstore", "packages": [thunderstore], "label": "مودات Thunderstore"})
    for name, info in mod_zips:
        if info["loader"] in ("bepinex", "bepinex-plugin?") and not thunderstore:
            install.append({"type": "github_release", "repo": "BepInEx/BepInEx", "asset": "BepInEx_win_x64_5.*.zip",
                            "extract": True, "to": "{game_dir}", "check": "{game_dir}/winhttp.dll", "label": "BepInEx 5"})
            todo.append("Added BepInEx 5 (x64). If the game is IL2CPP or needs BepInEx 6 / a game-specific pack, change it.")
        step = gh(name, to=info["to"], label=f"{r['name']} mod")
        if name.endswith(".zip") and not info.get("no_extract"):
            step["extract"] = True
            if info["strip"]:
                step["strip_top_folder"] = True
        install.append(step)
        if info["loader"] in ("unknown", "bepinex-plugin?", "reframework", "melonloader"):
            todo.append(f"{name}: looks like '{info['loader']}'. Check where the setup guide puts it (target: {info['to']}).")
        if info["loader"] == "melonloader":
            todo.append("Add MelonLoader (LavaGang/MelonLoader, MelonLoader.x64.zip) like pvz_replanted.")
        if info["loader"] == "reframework":
            todo.append("Add the right REFramework zip (praydog/REFramework) like re2.")
        if info["loader"] == "godot":
            todo.append("Godot Mod Loader needs its own setup step (see buckshot).")
    if not install:
        install.append({"type": "manual", "id": "install_mod", "url": (sheet or {}).get("guide_url") or f"https://github.com/{repo}",
                        "text_ar": "ثبّت مود اللعبة من صفحة الشرح اللي انفتحت. سويتها؟"})
        todo.append("No mod zip in the release: write the install steps by hand (Thunderstore? Workshop? Nexus?).")
    r["install"] = install
    r["connect"] = []
    todo.append("Connect: find where the mod saves host/slot (json/cfg/MelonPreferences) and add a connect step if it can be written.")

    launch = []
    comp = next((c for c in apworld_info["components"] if "tracker" not in c.lower()), None)
    if comp:
        launch.append({"type": "run", "exe": "{ap_dir}/ArchipelagoLauncher.exe", "label": comp,
                       "args": [comp, "--", "--connect", "{address}", "--name", "{slot}"], "optional_args": {"--password": "{password}"}})
        if not apworld_info["uses_base_parser"]:
            todo.append(f"Client '{comp}' may not accept --connect/--name: check its launch function.")
    launch.append({"type": "steam_launch", "appid": appid or 0})
    launch.append({"type": "manual", "id": f"connect_{rid}", "every_time": True,
                   "text_ar": "في اللعبة افتح نافذة Archipelago واكتب العنوان {address} والاسم {slot}."})
    r["launch"] = launch
    r["guide_ar"] = [
        "اضغط «جهّز اللعبة» أول مرة.",
        "اضغط ▶ العب، وفي اللعبة افتح نافذة Archipelago واكتب عنوان الروم واسمك.",
    ]
    todo.append("Write guide_ar from the setup guide: the steps the player does in the game after pressing Play.")

    opts = []
    for o in apworld_info["options"]:
        if d and o["key"] == d["key"]:
            continue
        basic = bool(re.search(r"goal|difficult|character|scenario", o["key"]))
        label = o["display"] or o["key"]
        if o["kind"] in ("Choice", "TextChoice") and o["options"]:
            by_value = {v: n for n, v in o["options"]}
            default = o["default"] if isinstance(o["default"], str) else by_value.get(o["default"])
            if default is None and isinstance(o["default"], str) is False and o["default"] is not None:
                default = by_value.get(o["default"])
            default = default or o["options"][0][0]
            if default.startswith("option_"):  # default = option_x
                default = default[len("option_"):]
            opts.append({"key": o["key"], "label_ar": label, "help_ar": "", "default": default,
                         "choices": [{"value": n, "label_ar": n} for n, _ in o["options"]], **({} if basic else {"advanced": True})})
        elif o["kind"] in ("Toggle", "DefaultOnToggle"):
            opts.append({"key": o["key"], "label_ar": label, "help_ar": "", "default": o["kind"] == "DefaultOnToggle" or bool(o["default"]),
                         **({} if basic else {"advanced": True})})
        elif o["kind"] in ("Range", "NamedRange") and None not in o["range"]:
            opts.append({"key": o["key"], "label_ar": label, "help_ar": "", "default": o["default"] if isinstance(o["default"], int) else o["range"][0],
                         "min": o["range"][0], "max": o["range"][1], **({} if basic else {"advanced": True})})
    r["options"] = opts[:16]
    if opts:
        todo.append("Option labels are in English: translate label_ar / help_ar, and keep only the options friends care about.")
    if not appid:
        todo.append("Steam appid not found: set steam_appid and the steam_launch appid.")
    return r, todo


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--sheet", help="game name as written in the Archipelago games sheet")
    ap.add_argument("--repo", help="owner/repo on GitHub (skips the sheet)")
    ap.add_argument("--thunderstore", help="Thunderstore package Namespace-Name of the mod")
    ap.add_argument("--apworld", help="use this local .apworld instead of downloading it")
    ap.add_argument("--appid", type=int)
    ap.add_argument("--out", help="output file (default recipes/<id>.json)")
    ap.add_argument("--force", action="store_true", help="overwrite an existing recipe")
    a = ap.parse_args(argv)

    sheet = None
    repo = a.repo
    if a.sheet:
        sheet = find_in_sheet(sheet_rows(fetch(SHEET_XLSX)), a.sheet)
        repo = repo or repo_from_url(sheet["links_url"]) or repo_from_url(sheet["guide_url"])
        print(f"sheet: {sheet['game']} | {sheet['stability']} | {sheet['links']} -> {sheet['links_url']}")
    if not repo:
        raise SystemExit("No GitHub repo found. Pass --repo owner/name (Discord / Nexus downloads need a manual recipe).")

    try:
        release = runner.pick_release(repo)
    except RuntimeError:
        release = runner.pick_release(repo, prerelease=True)
    names = [x["name"] for x in release["assets"]]
    print(f"release {release.get('tag_name')} ({'pre-release' if release.get('prerelease') else 'release'}): {names}")
    apws = [x for x in release["assets"] if x["name"].endswith(".apworld")]
    if a.apworld:
        data = Path(a.apworld).read_bytes()
    elif len(apws) == 1:
        data = fetch(apws[0]["browser_download_url"])
    else:
        raise SystemExit(f"Expected one .apworld in the release, found {[x['name'] for x in apws]}. Use --apworld.")
    info = analyze_apworld(data)
    print(f"apworld: game={info['game']!r} death_link={info['death_link']} components={info['components']}")

    mod_zips = []
    for x in release["assets"]:
        n = x["name"]
        if n.endswith(".zip") and x.get("size", 0) < 80_000_000 and not re.search(r"linux|mac|osx|source", n, re.I):
            with tempfile.TemporaryDirectory() as td:
                p = Path(td) / n
                p.write_bytes(fetch(x["browser_download_url"]))
                with zipfile.ZipFile(p) as z:
                    mod_zips.append((n, classify_zip(z.namelist())))
        elif n.endswith(".dll"):
            mod_zips.append((n, {"loader": "bepinex-plugin?", "to": "{game_dir}/BepInEx/plugins", "strip": False}))
    appid, steam_name = (a.appid, None) if a.appid else steam_lookup(info["game"] or (sheet or {}).get("game") or repo)
    print(f"steam: {appid} {steam_name or ''}")

    recipe, todo = build((sheet or {}).get("game") or info["game"], repo, release, info, appid, steam_name, mod_zips,
                         a.thunderstore, sheet)
    rec.validate(dict(recipe), "draft")
    out = Path(a.out) if a.out else ROOT / "recipes" / f"{recipe['id']}.json"
    if out.exists() and not a.force:
        raise SystemExit(f"{out} exists. Use --force or --out.")
    out.write_text(json.dumps(recipe, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(f"\nwrote {out}\n\nCHECK BEFORE COMMITTING:")
    for t in todo:
        print(" -", t)
    print(" - Run the app on Windows and play a few checks, then set \"verified\": true.")
    return recipe, todo


if __name__ == "__main__":
    main()
