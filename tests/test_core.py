import json
import threading
import urllib.request
from pathlib import Path
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
        texts = ([r.get("notes_ar", ""), r.get("checks_ar", "")] + r.get("guide_ar", []) + r.get("avoid_ar", [])
                 + [s.get("text_ar", "") for ph in rec.PHASES for s in r.get(ph, [])])
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


def test_cuphead_save_slot_enabled_without_touching_played_slots(tmp_path, monkeypatch):
    monkeypatch.setattr(runner, "save_settings", lambda s: None)
    r = rec.load_all()["cuphead"]
    step = dict(r["connect"][0], dir=str(tmp_path))
    # slot 0 was played (game save exists); slot 1 already has an old Archipelago game
    (tmp_path / "cuphead_player_data_v1_ap_slot_0.sav").write_text("{}")
    (tmp_path / "cuphead_player_data_v1_ap_slot_1_apdata.sav").write_text('{"enabled": true, "seed": "old"}')
    (tmp_path / "cuphead_player_data_v1_ap_slot_1.sav").write_text("{}")
    s = _settings()
    s["new_game"] = {"cuphead": True}
    ctx = {"appdata": str(tmp_path), "host": "archipelago.gg", "port": "38281", "slot": "Mishal", "password": ""}
    runner.run_step(step, dict(ctx), s, r, _T())
    data = json.loads((tmp_path / "cuphead_player_data_v1_ap_slot_2_apdata.sav").read_text())
    assert data == {"address": "archipelago.gg", "port": 38281, "player": "Mishal", "password": "", "enabled": True}
    assert s["save_slots"]["cuphead"] == 2 and s["new_game"]["cuphead"] is False
    assert json.loads((tmp_path / "cuphead_player_data_v1_ap_slot_1_apdata.sav").read_text())["seed"] == "old"
    # same multiworld, room came back on another port: same slot, seed kept
    (tmp_path / "cuphead_player_data_v1_ap_slot_2_apdata.sav").write_text(json.dumps(dict(data, seed="S1")))
    c2 = dict(ctx, port="40000")
    runner.run_step(step, c2, s, r, _T())
    d2 = json.loads((tmp_path / "cuphead_player_data_v1_ap_slot_2_apdata.sav").read_text())
    assert d2["port"] == 40000 and d2["seed"] == "S1" and c2["save_slot"] == "3"
    # a new multiworld with no free slot left: clear error, nothing overwritten
    (tmp_path / "cuphead_player_data_v1_ap_slot_2.sav").write_text("{}")
    s["new_game"]["cuphead"] = True
    with pytest.raises(RuntimeError):
        runner.run_step(step, dict(ctx), s, r, _T())


def test_every_game_has_a_how_to_guide(all_recipes):
    for r in all_recipes.values():
        assert 2 <= len(r.get("guide_ar", [])) <= 8, r["id"]


def test_every_game_explains_checks_and_what_to_avoid(all_recipes):
    for r in all_recipes.values():
        assert r.get("checks_ar") and r.get("avoid_ar"), r["id"]


def test_death_link_settings_only_where_the_game_has_death_link(all_recipes):
    for r in all_recipes.values():
        dl_opts = [o for o in r["options"] if o.get("deathlink")]
        if dl_opts:
            assert rec.death_link_live(r), r["id"]
    y = rec.build_yaml(all_recipes["cuphead"], "M", {"deathlink_grace_count": 2}, True)
    assert "  deathlink_grace_count: 2" in y and "  deathlink: true" in y


def test_multi_select_options_and_bo3_maps(all_recipes):
    bo3 = all_recipes["bo3_zombies"]
    y = rec.build_yaml(bo3, "M", {"maps": ["map_origins_enabled", "map_moon_enabled"], "goal_condition": "goal_round"}, True)
    assert "  map_origins_enabled: true" in y and "  map_moon_enabled: true" in y and "  map_shadows_enabled: false" in y
    assert "  maps:" not in y and "  goal_condition: goal_round" in y
    y = rec.build_yaml(all_recipes["re4r"], "M", {"included_content": ["Main Campaign", "Mercenaries"]}, True)
    assert '  included_content: ["Main Campaign", "Mercenaries"]' in y
    y = rec.build_yaml(all_recipes["hitman"], "M", {}, False)
    assert '  included_s2_dlc_locations: []' in y


def test_every_game_says_how_many_checks(all_recipes):
    for r in all_recipes.values():
        assert r.get("checks_count_ar"), r["id"]


def test_multi_default_must_come_from_choices():
    with pytest.raises(rec.RecipeError):
        rec.validate({"id": "x", "name": "x", "game": "x", "steam_appid": 1,
                      "options": [{"key": "k", "default": ["zzz"], "multi": True, "choices": ["a"]}]}, "t")


def test_choice_defaults_are_valid(all_recipes):
    for r in all_recipes.values():
        for o in r["options"]:
            if o.get("choices") and not o.get("multi"):
                vals = [c["value"] if isinstance(c, dict) else c for c in o["choices"]]
                assert o["default"] in vals, (r["id"], o["key"])


def test_pick_release_tag_prefix(monkeypatch):
    rels = [{"tag_name": "ds3-1.0"}, {"tag_name": "eldenring-ap-0.2.0", "prerelease": True}, {"tag_name": "eldenring-ap-0.1.4"}]
    monkeypatch.setattr(runner, "http_json", lambda url: rels)
    assert runner.pick_release("o/r", tag_prefix="eldenring-ap")["tag_name"] == "eldenring-ap-0.1.4"
    assert runner.pick_release("o/r", prerelease=True, tag_prefix="eldenring-ap")["tag_name"] == "eldenring-ap-0.2.0"
    assert runner.pick_release("o/r")["tag_name"] == "ds3-1.0"


def test_dlc_question_excludes_its_locations_and_is_not_written():
    r = rec.load_all()["re4r"]
    off = rec.build_yaml(r, "Leon", {}, True)
    assert 'exclude_locations: ["T.DLC"]' in off and "has_treasure_map" not in off
    on = rec.build_yaml(r, "Leon", {"has_treasure_map": True}, True)
    assert "exclude_locations" not in on and "has_treasure_map" not in on
    typed = rec.build_yaml(r, "Leon", {}, True, 'exclude_locations: ["Chapter 1 - X"]')
    assert 'exclude_locations: ["T.DLC", "Chapter 1 - X"]' in typed


def test_calamity_goal_switches_calamity_on():
    r = rec.load_all()["terraria"]
    assert "calamity: false" in rec.build_yaml(r, "P", {}, True)
    y = rec.build_yaml(r, "P", {"goal": "yharon_dragon_of_rebirth", "calamity": False}, True)
    assert "goal: yharon_dragon_of_rebirth" in y and "calamity: true" in y
    assert "calamity: true" in rec.build_yaml(r, "P", {"calamity": True}, True)


def _steps_run(monkeypatch, recipe, options):
    from app import runner
    ran = []
    monkeypatch.setattr(runner.steam, "game_dir", lambda appid: Path("/lib/steamapps/common/x"))
    monkeypatch.setattr(runner, "ensure_archipelago", lambda task, s: None)
    monkeypatch.setattr(runner, "run_step", lambda step, ctx, s, r, t: ran.append(step))
    runner.run_phases(runner.Task(), recipe, ["install"], None, rec.effective_options(recipe, options))
    return ran


def test_calamity_mods_installed_only_when_on(monkeypatch, tmp_path):
    monkeypatch.setenv("APPDATA", str(tmp_path))
    r = rec.load_all()["terraria"]
    on = _steps_run(monkeypatch, r, {"calamity": True})
    off = _steps_run(monkeypatch, r, {})
    ids = lambda steps: [s.get("workshop_id") or s["type"] for s in steps]
    assert ids(on) == ["2922217554", "json_list_add", "2824688266", "2824688072", "json_list_add"]
    assert ids(off) == ["2922217554", "json_list_add", "json_list_remove"]


def test_json_list_remove_turns_mods_off(tmp_path):
    from app import runner
    f = tmp_path / "enabled.json"
    f.write_text('["SeldomArchipelago", "CalamityMod", "CalamityModMusic", "BossChecklist"]')
    step = {"type": "json_list_remove", "path": str(f), "items": ["CalamityMod", "CalamityModMusic"]}
    runner.run_step(step, {}, {"installed": {}, "done_steps": {}}, {"id": "terraria"}, runner.Task())
    assert json.loads(f.read_text()) == ["SeldomArchipelago", "BossChecklist"]
    runner.run_step(step, {}, {"installed": {}, "done_steps": {}}, {"id": "terraria"}, runner.Task())  # again: no change
    assert json.loads(f.read_text()) == ["SeldomArchipelago", "BossChecklist"]


def test_when_must_name_a_real_option():
    bad = {"id": "x", "name": "X", "game": "X", "steam_appid": 1, "options": [],
           "install": [{"type": "open_url", "url": "https://a", "when": {"nope": True}}]}
    with pytest.raises(rec.RecipeError):
        rec.validate(bad)


def test_cuphead_dlc_goal_switches_the_dlc_on():
    r = rec.load_all()["cuphead"]
    base = rec.build_yaml(r, "P", {}, True)
    assert "mode: beat_devil" in base and "use_dlc: false" in base and "deathlink: true" in base
    y = rec.build_yaml(r, "P", {"mode": "dlc_beat_saltbaker", "use_dlc": False}, False)
    assert "use_dlc: true" in y and "deathlink: false" in y


def test_free_deaths_offered_for_every_death_link_game(all_recipes):
    for rid, r in all_recipes.items():
        has = any(o["key"] == "free_deaths" for o in r["options"])
        expected = rec.death_link_live(r) and not r.get("free_deaths_native")  # Cuphead, Celeste...: their own setting
        assert has == expected, rid
    tunic = all_recipes["tunic"]
    assert "free_deaths" not in rec.build_yaml(tunic, "M", {"free_deaths": 3}, True)  # app-only, never in the YAML
    assert not any(o["key"] == "free_deaths" for o in all_recipes["hitman"]["options"])


def test_numbers_are_kept_inside_their_range(all_recipes):
    """An emptied number box reached the YAML as 0 (goal_round minimum 2): generation failed."""
    bo3 = all_recipes["bo3_zombies"]
    y = rec.build_yaml(bo3, "M", {"goal_condition": "easter_egg_hunt", "goal_round": 0}, True)
    assert "  goal_round: 2" in y
    assert "  goal_round: 25" in rec.build_yaml(bo3, "M", {"goal_round": None}, True)   # empty box: default
    assert "  goal_round: 100" in rec.build_yaml(bo3, "M", {"goal_round": 5000}, True)
    assert "  goal_condition: easter_egg_hunt" in rec.build_yaml(bo3, "M", {"goal_condition": "nope"}, True)
    # every option of every game, fed junk, still gives values the recipe allows
    for r in all_recipes.values():
        for o in r["options"]:
            for junk in (None, "", -999, 10 ** 9, "x", []):
                v = rec.clean_value(o, junk)
                if "min" in o:
                    assert o["min"] <= v <= o["max"], (r["id"], o["key"], junk, v)
                elif o.get("choices") and not (o.get("multi") or o.get("as_toggles")):
                    assert v in [c["value"] if isinstance(c, dict) else c for c in o["choices"]], (r["id"], o["key"])


def test_re4r_no_separate_ways_yet(all_recipes):
    """The RE4R apworld refuses Separate Ways ('coming in a later release'); an old saved choice is dropped."""
    r = all_recipes["re4r"]
    inc = next(o for o in r["options"] if o["key"] == "included_content")
    assert "Separate Ways" not in [c["value"] for c in inc["choices"]]
    assert 'included_content: ["Main Campaign"]' in rec.build_yaml(r, "M", {"included_content": ["Main Campaign", "Separate Ways"]}, True)
    assert 'included_content: ["Main Campaign"]' in rec.build_yaml(r, "M", {"included_content": ["Separate Ways"]}, True)



def test_hitman_default_goal_is_not_the_starting_level(all_recipes):
    """The apworld refuses goal_level == starting_level; the defaults used to be both ICA Facility."""
    h = all_recipes["hitman"]
    y = rec.build_yaml(h, "M", {}, False)
    assert "goal_level: carpathian_mountains" in y and "starting_location: ica_facility" in y
    y = rec.build_yaml(h, "M", {"goal_level": "paris", "starting_location": "paris"}, False)
    assert "starting_location: paris" in y and "goal_level: paris" not in y


def test_elden_ring_dlc_goal_switches_dlc_on(all_recipes):
    er = all_recipes["elden_ring"]
    assert "enable_dlc: false" in rec.build_yaml(er, "M", {"goal": ["Final Boss"]}, True)
    assert "enable_dlc: true" in rec.build_yaml(er, "M", {"goal": ["Final Boss", "DLC Final Boss"], "enable_dlc": False}, True)


def test_dst_boss_goal_keeps_the_caves(all_recipes):
    """DST refuses a boss goal when the boss's region (caves, Ancient Guardian) is turned off."""
    d = all_recipes["dst"]
    assert "cave_regions: auto" in rec.build_yaml(d, "M", {"goal": "bosses_any", "cave_regions": "none"}, True)
    assert "cave_regions: none" in rec.build_yaml(d, "M", {"goal": "survival", "cave_regions": "none"}, True)


def test_re3_only_standard_difficulty(all_recipes):
    """RE3R 0.2.99 accepts only 'standard' (the others are commented out): a saved harder choice is ignored."""
    r = all_recipes["re3"]
    assert not any(o["key"] == "difficulty" for o in r["options"])
    y = rec.build_yaml(r, "M", {"difficulty": "inferno"}, True)
    assert "difficulty: standard" in y and "inferno" not in y


def test_slot_hex_survives_any_letters(monkeypatch, tmp_path):
    monkeypatch.setenv("APPDATA", str(tmp_path))
    ctx = runner.context({"id": "doom_1993", "steam_appid": None}, _settings(), {"slot": "مشعل 1"})
    assert bytes.fromhex(ctx["slot_hex"]).decode("utf-8") == "مشعل 1"


def test_copy_of_a_missing_game_file_says_so(tmp_path):
    step = {"type": "copy", "from": str(tmp_path / "base" / "DOOM.WAD"), "to": str(tmp_path / "t" / "DOOM.WAD"),
            "missing_ar": "ما لقيت DOOM.WAD"}
    with pytest.raises(RuntimeError, match="DOOM.WAD"):
        runner.run_step(step, {}, _settings(), {"id": "t", "steam_appid": 1}, _T())


def test_run_after_process_waits_for_the_game(monkeypatch):
    started, seen = [], iter([False, False, True])
    monkeypatch.setattr(runner, "process_running", lambda name: next(seen))
    monkeypatch.setattr(runner.subprocess, "Popen", lambda cmd, cwd=None: started.append(cmd))
    assert runner._start_after("witness64_d3d11.exe", ["tool.exe"], ".", timeout=60, poll=1, sleep=lambda s: None)
    assert started == [["tool.exe"]]
    started.clear()
    monkeypatch.setattr(runner, "process_running", lambda name: False)
    assert not runner._start_after("x.exe", ["tool.exe"], ".", timeout=3, poll=1, sleep=lambda s: None)
    assert started == []


def test_new_famous_games_death_link():
    R = rec.load_all()
    assert R["hollow_knight"]["death_link_key"] == "DeathLink"                     # HK's options are class names
    y = rec.build_yaml(R["hollow_knight"], "P", {}, True)
    assert "DeathLink: true" in y and "Goal: any" in y
    for rid in ("celeste", "the_witness", "a_hat_in_time"):                        # their own amnesty, no relay
        assert R[rid]["free_deaths_native"] and not any(o["key"] == "free_deaths" for o in R[rid]["options"])
    assert R["minecraft"]["steam_appid"] is None
    y = rec.build_yaml(R["a_hat_in_time"], "P", {"EndGoal": "rush_hour"}, True)
    assert "EnableDLC2: true" in y                                                   # the DLC goal turns its DLC on


def test_group_check_warns_about_a_bad_mix(tmp_path, monkeypatch):
    from app import groupcheck, host
    monkeypatch.setenv("APPDATA", str(tmp_path))
    R = rec.load_all()
    pdir = host.players_dir()
    pdir.mkdir(parents=True, exist_ok=True)
    for name, rid, dl in (("Mishal", "celeste", True), ("Fahad", "doom_1993", True), ("Saad", "stardew", False),
                          ("Nasser", "minecraft", True), ("Ali", "minecraft", True)):
        (pdir / f"{name}.yaml").write_text(rec.build_yaml(R[rid], name, {}, dl), encoding="utf-8")
    players = host.scan_players(R)
    assert {p["name"]: p["death_link"] for p in players} == {"Ali": True, "Fahad": True, "Mishal": True, "Nasser": True, "Saad": False}
    advice = groupcheck.check(players, R)
    titles = [a["title"] for a in advice]
    assert "Death Link بيتعب الشباب" in titles and "Mishal" in advice[titles.index("Death Link بيتعب الشباب")]["text"]
    assert "أطوال مختلفة كثير" in titles and "أكثر من ماين كرافت" in titles and "مو الكل في Death Link" in titles
    assert "المجموعة حلوة" not in titles
    ok = groupcheck.check([p for p in players if p["name"] == "Fahad"], R)
    assert ok[0]["title"] == "المجموعة حلوة"


def test_room_commands_are_whitelisted(tmp_path, monkeypatch):
    import threading
    import urllib.error
    import urllib.request
    from http.server import ThreadingHTTPServer
    from app import server
    monkeypatch.setenv("APPDATA", str(tmp_path))
    said = []

    class F:
        def say(self, t):
            said.append(t)
    monkeypatch.setitem(server.FEED, "feed", F())
    srv = ThreadingHTTPServer(("127.0.0.1", 0), server.Handler)
    threading.Thread(target=srv.serve_forever, daemon=True).start()

    def post(text):
        req = urllib.request.Request(f"http://127.0.0.1:{srv.server_address[1]}/api/say", json.dumps({"text": text}).encode(),
                                     {"Content-Type": "application/json"})
        try:
            return urllib.request.urlopen(req).status
        except urllib.error.HTTPError as e:
            return e.code
    try:
        assert post("hello all") == 200 and post("!missing") == 200 and post("!hint_location Big Chest") == 200
        assert post("!admin /forfeit") == 400 and post("!getitem Sword") == 400 and post("   ") == 400
        assert said == ["hello all", "!missing", "!hint_location Big Chest"]
    finally:
        srv.shutdown()


def test_join_by_link_and_quick_session(tmp_path, monkeypatch):
    """A friend pastes the room link: the app finds their slot and game. The host picks everyone's game."""
    import threading
    import urllib.error
    import urllib.request
    from http.server import ThreadingHTTPServer
    from app import host, server
    monkeypatch.setenv("APPDATA", str(tmp_path))
    server.reload_recipes()
    room = {"host": "archipelago.gg", "port": "40000", "tracker": "T",
            "players": [{"name": "Mishal", "game": "Celeste (Open World)"}, {"name": "Fahad", "game": "DOOM 1993"}]}
    monkeypatch.setattr(server.roomfeed, "resolve_room_link", lambda text: room)
    srv = ThreadingHTTPServer(("127.0.0.1", 0), server.Handler)
    threading.Thread(target=srv.serve_forever, daemon=True).start()

    def post(path, body):
        req = urllib.request.Request(f"http://127.0.0.1:{srv.server_address[1]}{path}", json.dumps(body).encode(),
                                     {"Content-Type": "application/json"})
        try:
            return json.loads(urllib.request.urlopen(req).read())
        except urllib.error.HTTPError as e:
            return {"status": e.code, **json.loads(e.read())}
    link = "https://archipelago.gg/room/abc"
    try:
        assert post("/api/join", {"room": link}) == {"choose": ["Mishal", "Fahad"]}          # no name yet: pick yours
        j = post("/api/join", {"room": link, "slot": "fahad"})
        assert j["game"] == "doom_1993" and j["slot"] == "Fahad"
        assert post("/api/join", {"room": link})["game"] == "doom_1993"                     # remembered
        r = post("/api/host/quick", {"players": [{"name": "Mishal", "game": "celeste"}, {"name": "Saad", "game": "stardew"}]})
        assert r == {"ok": True, "count": 2}
        players = host.scan_players(server.RECIPES)
        assert {(p["name"], p["recipe"], p["death_link"]) for p in players} == {("Mishal", "celeste", True), ("Saad", "stardew", True)}
        assert post("/api/host/quick", {"players": [{"name": "A", "game": "celeste"}, {"name": "a", "game": "doom_1993"}]})["status"] == 400
    finally:
        srv.shutdown()


def test_mod_load_watch(tmp_path, monkeypatch):
    """After Play: a game folder with BepInEx must get a fresh LogOutput.log, else the page warns."""
    import time as _t
    from app import server, stores
    gd = tmp_path / "Game"
    (gd / "BepInEx").mkdir(parents=True)
    monkeypatch.setattr(server.stores, "locate", lambda r, s: {"dir": gd, "store": "steam", "epic_app": ""})
    monkeypatch.setattr(server, "load_settings", lambda: {})
    r = {"id": "x", "name": "Game"}
    server.watch_mod_load(r, _t.time(), wait=10, poll=5, sleep=lambda s: None)
    assert server.MOD_CHECK["state"] == "missing" and server.MOD_CHECK["loader"] == "BepInEx"
    (gd / "BepInEx" / "LogOutput.log").write_text("Chainloader ready")
    server.watch_mod_load(r, _t.time() - 1, wait=10, poll=5, sleep=lambda s: None)
    assert server.MOD_CHECK["state"] == "ok"
    server.MOD_CHECK.clear()
    server.watch_mod_load(r, _t.time(), wait=10, poll=5, sleep=lambda s: (gd / "BepInEx" / "LogOutput.log").touch())
    assert server.MOD_CHECK["state"] == "ok"                                     # written while we waited
