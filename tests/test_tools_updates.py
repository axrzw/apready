import io
import json
import zipfile

import pytest

from app import recipes as rec, updates
from tools import new_recipe as nr


def _apworld(files: dict) -> bytes:
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w") as z:
        for n, s in files.items():
            z.writestr(n, s)
    return buf.getvalue()


OPTIONS_PY = '''
from dataclasses import dataclass
from Options import Choice, Toggle, Range, DeathLink, PerGameCommonOptions

class Goal(Choice):
    """What to beat."""
    display_name = "Goal"
    option_boss = 1
    option_everything = 2
    default = 2

class Hard(Toggle):
    display_name = "Hard Mode"

class Count(Range):
    range_start = 1
    range_end = 9
    default = 3

class SpireDeath(Range):
    range_start = 0
    range_end = 100
    default = 0

@dataclass
class MyOptions(PerGameCommonOptions):
    goal: Goal
    hard: Hard
    count: Count
    death_link: DeathLink
'''


def test_analyze_apworld_reads_without_running():
    data = _apworld({"mygame/archipelago.json": '{"game": "My Game"}',
                     "mygame/Options.py": OPTIONS_PY + "\nraise SystemExit('never executed')\n",
                     "mygame/__init__.py": 'from worlds.LauncherComponents import Component\n'
                                           'components.append(Component("My Client", func=None))\n'})
    info = nr.analyze_apworld(data)
    assert info["game"] == "My Game"
    assert info["death_link"] == {"key": "death_link", "kind": "DeathLink", "true_works": True}
    assert info["components"] == ["My Client"]
    goal = next(o for o in info["options"] if o["key"] == "goal")
    assert goal["options"] == [("boss", 1), ("everything", 2)] and goal["default"] == 2


def test_analyze_flags_range_death_link():
    src = OPTIONS_PY.replace("death_link: DeathLink", "death_link: SpireDeath")
    info = nr.analyze_apworld(_apworld({"g/Options.py": src}))
    assert info["death_link"]["true_works"] is False


def test_build_draft_is_a_valid_recipe():
    info = nr.analyze_apworld(_apworld({"g/archipelago.json": '{"game": "My Game"}', "g/Options.py": OPTIONS_PY}))
    release = {"tag_name": "1.2.0", "assets": [{"name": "mygame.apworld"}, {"name": "MyMod-1.2.0.zip"}, {"name": "MyMod-1.2.0-linux.zip"}]}
    mods = [("MyMod-1.2.0.zip", nr.classify_zip(["MyMod/MyMod.dll", "MyMod/"]))]
    r, todo = nr.build("My Game", "me/mygame", release, info, 123, "My Game", mods)
    rec.validate(dict(r), "draft")
    assert r["id"] == "my_game" and r["steam_appid"] == 123 and "death_link_key" not in r
    goal = next(o for o in r["options"] if o["key"] == "goal")
    assert goal["default"] == "everything" and "advanced" not in goal       # goal stays a basic option
    assert next(o for o in r["options"] if o["key"] == "hard").get("advanced")
    assert any(s.get("asset") == "MyMod-*[0-9].zip" for s in r["install"])  # not the linux build
    assert any("BepInEx" in t for t in todo)


def test_glob_for_keeps_extension_and_is_unique():
    assert nr.glob_for("asdfwyay-APBuckshot-0.4.1-hotfix.1.zip", ["asdfwyay-APBuckshot-0.4.1-hotfix.1.zip"]) == "asdfwyay-APBuckshot-*.zip"
    names = ["X-1.0-win.zip", "X-1.0-linux.zip"]
    assert nr.glob_for("X-1.0-win.zip", names) == "X-*-win.zip"


def test_classify_zip():
    assert nr.classify_zip(["BepInEx/plugins/A/a.dll"])["loader"] == "bepinex"
    assert nr.classify_zip(["Mods/a.dll", "Mods/"])["loader"] == "melonloader"
    assert nr.classify_zip(["reframework/autorun/a.lua"])["loader"] == "reframework"
    assert nr.classify_zip(["mods-unpacked/a/mod_main.gd"])["loader"] == "godot"


def test_updates_only_use_valid_recipes(tmp_path, monkeypatch):
    monkeypatch.setenv("APPDATA", str(tmp_path))
    good = json.dumps({"id": "newgame", "name": "New Game", "name_ar": "جديدة", "game": "New", "steam_appid": 1}).encode()
    bad_step = json.dumps({"id": "future", "name": "F", "game": "F", "steam_appid": 2,
                           "install": [{"type": "teleport"}]}).encode()
    bad_id = json.dumps({"id": "../evil", "name": "E", "game": "E", "steam_appid": 3}).encode()
    files = {"newgame.json": good, "future.json": bad_step, "evil.json": bad_id}
    listing = [{"type": "file", "name": n, "sha": n + "1", "download_url": "u/" + n} for n in files]
    calls = []

    def get(url):
        calls.append(url)
        return files[url.split("/")[-1]]
    res = updates.update(lambda url: listing, get)
    assert res["new"] == ["New Game"] and sorted(res["skipped"]) == ["evil.json", "future.json"]
    shipped = rec.load_all(extra=updates.remote_dir())
    assert "newgame" in shipped and "future" not in shipped and "terraria" in shipped
    calls.clear()
    assert updates.update(lambda url: listing, get)["new"] == [] and calls == ["u/future.json", "u/evil.json"]
    updates.update(lambda url: [], get)  # removed upstream -> removed here
    assert "newgame" not in rec.load_all(extra=updates.remote_dir())
