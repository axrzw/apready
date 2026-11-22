import json
import threading
import urllib.request
from http.server import ThreadingHTTPServer

import pytest

from app import recipes as rec, steam
from app.server import Handler, RECIPES, parse_room


@pytest.fixture(scope="module")
def all_recipes():
    return rec.load_all()


def test_all_recipes_load(all_recipes):
    assert {"terraria", "elden_ring", "sekiro", "hitman", "re2", "re3", "re4r", "re4_classic", "re7", "re8", "cuphead", "portal2", "re9", "bo3_zombies", "pvz_replanted", "balatro", "peak", "buckshot", "dst", "tunic", "brotato", "stardew", "repo", "lethal_company", "content_warning", "cult_of_the_lamb", "valheim", "muck"} <= set(all_recipes)


def test_common_advanced_options_added(all_recipes):
    for r in all_recipes.values():
        keys = {o["key"] for o in r["options"] if o.get("advanced")}
        assert {"progression_balancing", "accessibility"} <= keys


def test_yaml_death_link_on(all_recipes):
    y = rec.build_yaml(all_recipes["terraria"], "Mishal", {}, True)
    assert "name: Mishal" in y and "game: Terraria" in y
    assert "  death_link: true" in y
    assert "  goal: mechanical_bosses" in y


def test_death_link_toggle_beats_advanced_box(all_recipes):
    y = rec.build_yaml(all_recipes["terraria"], "Mishal", {}, False, "death_link: true\ngoal: moon_lord")
    assert "  death_link: false" in y
    assert "  goal: moon_lord" in y


def test_advanced_box_types():
    assert rec.parse_extra("a: true\nb: 12\nc: hello\n# x\n") == {"a": True, "b": 12, "c": "hello"}
    with pytest.raises(rec.RecipeError):
        rec.parse_extra("bad key: 1")


def test_slot_name_cleaned():
    assert rec.safe_slot("Abu Fahad The Great") == "Abu_Fahad_The_Gr"


def test_game_of_yaml():
    assert rec.game_of_yaml('name: x\ngame: "Sekiro: Shadows Die Twice"\n') == "Sekiro: Shadows Die Twice"


def test_parse_room():
    assert parse_room("/connect archipelago.gg:38281") == {"host": "archipelago.gg", "port": "38281"}
    assert parse_room("38281") == {"host": "archipelago.gg", "port": "38281"}
    with pytest.raises(ValueError):
        parse_room("hello")


def test_steam_vdf_parsing():
    vdf = '"libraryfolders"\n{\n "0"\n {\n  "path"  "C:\\\\Program Files (x86)\\\\Steam"\n }\n "1"\n {\n  "path" "D:\\\\SteamLibrary"\n }\n}'
    paths = [str(p) for p in steam.parse_library_folders(vdf)]
    assert paths[1].endswith("SteamLibrary")
    assert steam.parse_install_dir('"installdir"   "Sekiro"') == "Sekiro"


def test_server_endpoints(tmp_path, monkeypatch, all_recipes):
    monkeypatch.setenv("APPDATA", str(tmp_path))
    RECIPES.update(all_recipes)
    srv = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
    threading.Thread(target=srv.serve_forever, daemon=True).start()
    base = f"http://127.0.0.1:{srv.server_address[1]}"

    def post(path, body):
        req = urllib.request.Request(base + path, json.dumps(body).encode(), {"Content-Type": "application/json"})
        return json.loads(urllib.request.urlopen(req).read())

    assert "AP" in urllib.request.urlopen(base + "/").read().decode()
    post("/api/name", {"name": "Mishal"})
    out = post("/api/yaml", {"game": "re2", "options": {}, "death_link": True, "extra": "progression_balancing: 80"})
    assert "progression_balancing: 80" in out["yaml"] and "death_link: true" in out["yaml"]
    state = json.loads(urllib.request.urlopen(base + "/api/state").read())
    assert state["player_name"] == "Mishal"
    assert state["last"]["re2"]["death_link"] is True
    srv.shutdown()


# ---------- runner steps ----------
import zipfile
from app import runner


class _T:
    def __init__(self):
        self.log = []

    def say(self, m):
        self.log.append(m)


def _settings():
    return {"done_steps": {}, "installed": {}, "ap_dir": ""}


def test_extract_zip_pick_strip_and_backslashes(tmp_path):
    z = tmp_path / "a.zip"
    with zipfile.ZipFile(z, "w") as f:
        f.writestr("Top_1.0/files/apworld/en/x.apworld", b"en")
        f.writestr("Top_1.0/files/apworld/fr/x.apworld", b"fr")
        f.writestr("Top_1.0/Launcher.exe", b"exe")
        f.writestr("reframework\\autorun\\a.lua", b"lua")
    out = tmp_path / "pick"
    assert runner.extract_zip(z, out, pick="*/files/apworld/en/x.apworld") == 1
    assert (out / "x.apworld").read_bytes() == b"en"
    out2 = tmp_path / "strip"
    runner.extract_zip(z, out2, strip=True)
    assert (out2 / "Launcher.exe").exists()
    out3 = tmp_path / "plain"
    runner.extract_zip(z, out3)
    assert (out3 / "reframework" / "autorun" / "a.lua").read_bytes() == b"lua"


def test_write_file_merge_keeps_other_keys(tmp_path, monkeypatch):
    monkeypatch.setattr(runner, "save_settings", lambda s: None)
    cfg = tmp_path / "Config.json"
    cfg.write_text('{"manualFlags": ["Hardmode"], "port": 1}', encoding="utf-8")
    step = {"type": "write_file", "path": str(cfg), "merge": True, "ints": ["port"],
            "content": {"name": "{slot}", "port": "{port}", "address": "{host}"}}
    ctx = {"slot": "Mishal", "port": "38281", "host": "archipelago.gg"}
    runner.run_step(step, ctx, _settings(), {"id": "t", "steam_appid": 1}, _T())
    got = json.loads(cfg.read_text(encoding="utf-8"))
    assert got == {"manualFlags": ["Hardmode"], "port": 38281, "name": "Mishal", "address": "archipelago.gg"}


def test_json_list_add_is_idempotent(tmp_path):
    f = tmp_path / "Mods" / "enabled.json"
    step = {"type": "json_list_add", "path": str(f), "items": ["SeldomArchipelago"]}
    for _ in range(2):
        runner.run_step(step, {}, _settings(), {"id": "t", "steam_appid": 1}, _T())
    assert json.loads(f.read_text()) == ["SeldomArchipelago"]


def test_manual_done_if_exists_skips_prompt(tmp_path, monkeypatch):
    monkeypatch.setattr(runner, "save_settings", lambda s: None)
    step = {"type": "manual", "id": "setup", "text_ar": "x", "done_if_exists": str(tmp_path / "*" / "mod.lua")}
    with pytest.raises(runner.NeedsUser):
        runner.run_step(step, {}, _settings(), {"id": "t", "steam_appid": 1}, _T())
    (tmp_path / "v1").mkdir()
    (tmp_path / "v1" / "mod.lua").write_text("")
    s = _settings()
    runner.run_step(step, {}, s, {"id": "t", "steam_appid": 1}, _T())
    assert s["done_steps"]["t:setup"] is True


def test_same_repo_steps_do_not_share_install_record(tmp_path, monkeypatch):
    """Portal 2 / RE4 UHD / Village take the apworld AND the mod from one repo."""
    monkeypatch.setattr(runner, "save_settings", lambda s: None)
    monkeypatch.setattr(runner, "tools_dir", lambda: tmp_path / "tools")
    rel = {"tag_name": "1.0", "assets": [
        {"name": "w.apworld", "browser_download_url": "u1"}, {"name": "mod.zip", "browser_download_url": "u2"}]}
    monkeypatch.setattr(runner, "pick_release", lambda *a, **k: rel)
    fetched = []

    def fake_download(url, dest, task):
        fetched.append(url)
        dest.parent.mkdir(parents=True, exist_ok=True)
        if dest.suffix == ".zip":
            with zipfile.ZipFile(dest, "w") as f:
                f.writestr("Mod/a.txt", "x")
        else:
            dest.write_bytes(b"w")
    monkeypatch.setattr(runner, "download", fake_download)
    s = _settings()
    recipe = {"id": "p2", "steam_appid": 1}
    a = {"type": "github_release", "repo": "o/r", "asset": "*.apworld", "to": str(tmp_path / "cw")}
    b = {"type": "github_release", "repo": "o/r", "asset": "mod.zip", "extract": True, "to": str(tmp_path / "sm")}
    for step in (a, b, a, b):
        runner.run_step(step, {}, s, recipe, _T())
    assert fetched == ["u1", "u2"]  # each once, and the mod was not skipped
    assert (tmp_path / "sm" / "Mod" / "a.txt").exists()


def test_run_optional_args_only_when_set(tmp_path, monkeypatch):
    exe = tmp_path / "v2" / "Client.exe"
    exe.parent.mkdir()
    exe.write_text("")
    calls = []
    monkeypatch.setattr(runner.subprocess, "Popen", lambda cmd, cwd=None: calls.append(cmd))
    step = {"type": "run", "exe": str(tmp_path / "*" / "Client.exe"), "args": ["--connect", "{address}"],
            "optional_args": {"--password": "{password}"}}
    runner.run_step(step, {"address": "h:1", "password": ""}, _settings(), {"id": "t", "steam_appid": 1}, _T())
    runner.run_step(step, {"address": "h:1", "password": "pw"}, _settings(), {"id": "t", "steam_appid": 1}, _T())
    assert calls[0] == [str(exe), "--connect", "h:1"]
    assert calls[1] == [str(exe), "--connect", "h:1", "--password", "pw"]


def test_recipes_have_no_ambiguous_assets(all_recipes):
    """A bare '*.zip' grabbed the wrong file before (macOS build, DO-NOT-DOWNLOAD zip)."""
    for r in all_recipes.values():
        for phase in rec.PHASES:
            for step in r.get(phase, []):
                if step["type"] == "github_release":
                    assert step["asset"] not in ("*.zip", "*.apworld"), (r["id"], step)


def test_friends_never_see_paths_or_yaml(all_recipes):
    """CLAUDE.md: no YAML or folder paths in what players read (notes and step texts)."""
    hidden = ("{tools}", "{custom_worlds}", "{game_dir}", "{ap_dir}", "{steam}", "{sourcemods}",
              "{documents}", "{appdata}", "YAML", "yaml")
    for r in all_recipes.values():
        texts = [r.get("notes_ar", "")] + [s.get("text_ar", "") for ph in rec.PHASES for s in r.get(ph, [])]
        for t in texts:
            assert not any(h in t for h in hidden), (r["id"], t)


def test_ini_set_keeps_other_lines_and_sections():
    t = "## Settings\n\n[Connection]\n\n# Host\nServer = archipelago.gg\n\n[Other]\nX = 1\n"
    out = runner.ini_set(t, "Connection", {"Server": "h:1", "Slot": "Mishal"})
    assert "# Host\nServer = h:1\nSlot = Mishal\n\n[Other]\nX = 1" in out
    melon = '["Archipelago Connection"]\nHost = "archipelago.gg:"\n\n[MelonLoader]\nX = 1\n'
    out = runner.ini_set(melon, "Archipelago Connection", {"Host": "h:1", "Password": ""}, quote=True)
    assert out.startswith('["Archipelago Connection"]\nHost = "h:1"\nPassword = ""\n')
    assert runner.ini_set("", "A B", {"k": "v"}, quote=True) == '["A B"]\nk = "v"\n'


def test_write_file_deep_merge_and_skip_if_exists(tmp_path, monkeypatch):
    monkeypatch.setattr(runner, "save_settings", lambda s: None)
    f = tmp_path / "Settings.json"
    f.write_text('{"Mode": 2, "ConnectionSettings": {"Player": "old", "Port": "1"}}')
    step = {"type": "write_file", "path": str(f), "merge": True,
            "content": {"ConnectionSettings": {"Player": "{slot}", "Hostname": "h"}}}
    runner.run_step(step, {"slot": "Mishal"}, _settings(), {"id": "t", "steam_appid": 1}, _T())
    assert json.loads(f.read_text()) == {"Mode": 2, "ConnectionSettings": {"Player": "Mishal", "Port": "1", "Hostname": "h"}}
    marker = tmp_path / "done.exe"
    marker.write_text("")
    calls = []
    monkeypatch.setattr(runner.subprocess, "Popen", lambda *a, **k: calls.append(a))
    runner.run_step({"type": "run", "exe": str(tmp_path / "missing.exe"), "skip_if_exists": str(marker)},
                    {}, _settings(), {"id": "t", "steam_appid": 1}, _T())
    assert calls == []


def test_thunderstore_layout_matches_r2modman():
    t = runner.thunderstore_target
    assert t("BepInEx-BepInExPack", "BepInExPack/winhttp.dll") == "winhttp.dll"
    assert t("denikson-BepInExPack_Valheim", "BepInExPack_Valheim/BepInEx/core/x.dll") == "BepInEx/core/x.dll"
    assert t("BepInEx-BepInExPack", "README.md") == ""
    assert t("APLC-APLC", "APLC.dll") == "BepInEx/plugins/APLC-APLC/APLC.dll"
    assert t("APLC-APLC", "manifest.json") == ""
    assert t("Evaisa-LethalLib", "plugins/LethalLib/LethalLib.dll") == "BepInEx/plugins/Evaisa-LethalLib/LethalLib/LethalLib.dll"
    assert t("IAmBatby-LethalLevelLoader", "patchers/P.dll") == "BepInEx/patchers/IAmBatby-LethalLevelLoader/P.dll"
    assert t("Rug-Mycelium", "BepInEx/plugins/M/M.dll") == "BepInEx/plugins/Rug-Mycelium/M/M.dll"
    assert t("A-B", "config/x.cfg") == "BepInEx/config/x.cfg"


def test_thunderstore_resolve_reads_manifests_newest_wins(tmp_path, monkeypatch):
    deps = {
        "APLC-APLC": ["BepInEx-BepInExPack-5.4.2100", "Caigan-Scrap-4.1.0"],
        "Caigan-Scrap": ["BepInEx-BepInExPack-5.4.2305"],
        "BepInEx-BepInExPack": [],
    }
    monkeypatch.setattr(runner, "http_json", lambda url: {"latest_version": "0.8.0"})
    fetched = []

    def fetch(full, version):
        fetched.append(f"{full}@{version}")
        zp = tmp_path / f"{full}-{version}.zip"
        with zipfile.ZipFile(zp, "w") as z:
            z.writestr("manifest.json", json.dumps({"dependencies": deps[full]}))
        return zp
    got = {f: v for f, v, _ in runner.thunderstore_resolve(["APLC-APLC"], fetch)}
    assert got == {"APLC-APLC": "0.8.0", "Caigan-Scrap": "4.1.0", "BepInEx-BepInExPack": "5.4.2305"}
    assert "APLC-APLC@0.8.0" in fetched


def test_death_link_greyed_or_live_per_game(all_recipes):
    from app.server import game_list
    RECIPES.update(all_recipes)
    dl = {g["id"]: g["death_link"] for g in game_list()}
    assert dl["hitman"] is False and dl["valheim"] is False          # greyed out in the UI
    assert dl["tunic"] is True and dl["buckshot"] is True            # Death Link lives in the mod
    assert dl["cuphead"] is True and dl["terraria"] is True
    y = rec.build_yaml(all_recipes["tunic"], "Mishal", {}, True)
    assert "death_link" not in y                                      # not an apworld option there


def test_tunic_death_link_written_to_mod_settings(tmp_path, monkeypatch):
    monkeypatch.setattr(runner, "save_settings", lambda s: None)
    r = rec.load_all()["tunic"]
    f = tmp_path / "Settings.json"
    step = dict(r["connect"][0], path=str(f))
    for on in (True, False):
        ctx = runner.context({"id": "tunic"}, {"ap_dir": str(tmp_path)}, {"slot": "M", "port": "1", "death_link": on})
        runner.run_step(step, ctx, _settings(), r, _T())
        assert json.loads(f.read_text())["DeathLinkEnabled"] is on


def test_cuphead_death_link_uses_its_own_key(all_recipes):
    """cuphead.apworld reads `deathlink`; `death_link` left Death Link off (owner's test)."""
    y = rec.build_yaml(all_recipes["cuphead"], "Mishal", {}, True)
    assert "  deathlink: true" in y and "death_link" not in y
