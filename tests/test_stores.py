"""Games outside Steam: a folder the player picked, copies with no launcher (GOG installs found in the registry) and Epic."""
import json
from pathlib import Path

import pytest

from app import recipes as rec, runner, stores


class _T:
    def __init__(self):
        self.log = []

    def say(self, m):
        self.log.append(m)


def _game(tmp_path, name, exe):
    d = tmp_path / name
    d.mkdir(parents=True)
    (d / exe).write_text("")
    return d


def test_picked_folder_wins_and_must_hold_the_game(tmp_path, monkeypatch):
    monkeypatch.setattr(stores.steam, "game_dir", lambda appid: None)
    r = rec.load_all()["hollow_knight"]
    good = _game(tmp_path, "HK", "hollow_knight.exe")
    assert stores.locate(r, {"game_dirs": {"hollow_knight": str(good)}}) == {"dir": good, "store": "folder", "epic_app": ""}
    assert stores.locate(r, {"game_dirs": {"hollow_knight": str(tmp_path)}}) is None  # no exe there: not the game
    assert not stores.folder_ok(r, tmp_path) and stores.folder_ok(r, good)


def test_epic_and_gog_copies_are_found_by_name(tmp_path, monkeypatch):
    monkeypatch.setattr(stores.steam, "game_dir", lambda appid: None)
    sub = _game(tmp_path, "Subnautica", "Subnautica.exe")
    man = tmp_path / "Manifests"
    man.mkdir()
    (man / "abc.item").write_text(json.dumps({"DisplayName": "Subnautica", "InstallLocation": str(sub), "AppName": "Jaguar",
                                              "LaunchExecutable": "Subnautica.exe"}), encoding="utf-8")
    monkeypatch.setattr(stores, "epic_manifest_dir", lambda: man)
    R = rec.load_all()
    assert stores.locate(R["subnautica"]) == {"dir": sub, "store": "epic", "epic_app": "Jaguar"}
    assert stores.locate(R["lethal_company"]) is None                      # a Steam-only mod never looks at Epic
    hk = _game(tmp_path, "GOG HK", "hollow_knight.exe")
    monkeypatch.setattr(stores, "gog_games", lambda: [{"name": "Hollow Knight", "dir": hk, "exe": "hollow_knight.exe"}])
    assert stores.locate(R["hollow_knight"])["store"] == "standalone"


def test_launch_from_other_stores(tmp_path, monkeypatch):
    opened, ran = [], []
    monkeypatch.setattr(runner.webbrowser, "open", lambda u: opened.append(u))
    monkeypatch.setattr(runner.subprocess, "Popen", lambda cmd, cwd=None: ran.append(cmd))
    gd = _game(tmp_path, "Celeste", "Celeste.exe")
    r = rec.load_all()["celeste"]
    step = {"type": "steam_launch", "appid": 504230}
    runner.run_step(step, {"store": "epic", "epic_app": "Salt", "game_dir": str(gd)}, {"installed": {}, "done_steps": {}}, r, _T())
    assert opened == ["com.epicgames.launcher://apps/Salt?action=launch&silent=true"]
    runner.run_step(step, {"store": "standalone", "epic_app": "", "game_dir": str(gd)}, {"installed": {}, "done_steps": {}}, r, _T())
    assert ran == [[str(gd / "Celeste.exe")]]
    runner.run_step(step, {"store": "steam", "epic_app": "", "game_dir": str(gd)}, {"installed": {}, "done_steps": {}}, r, _T())
    assert opened[-1] == "steam://run/504230"
    with pytest.raises(RuntimeError, match="ورشة ستيم"):
        runner.run_step({"type": "workshop", "id": "w", "workshop_id": "1"}, {"store": "standalone"},
                        {"installed": {}, "done_steps": {}}, rec.load_all()["a_hat_in_time"], _T())


def test_not_found_asks_for_the_folder(tmp_path, monkeypatch):
    monkeypatch.setenv("APPDATA", str(tmp_path))
    monkeypatch.setattr(stores.steam, "game_dir", lambda appid: None)
    monkeypatch.setattr(stores, "gog_games", lambda: [])
    monkeypatch.setattr(stores, "epic_manifest_dir", lambda: tmp_path / "none")
    with pytest.raises(runner.NeedsUser) as e:
        runner.run_phases(_T(), rec.load_all()["celeste"], ["install"])
    assert e.value.step["kind"] == "folder" and "بدون لانشر" in e.value.text and "Epic" in e.value.text
