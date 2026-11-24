"""Map trackers: PopTracker opened with the game's pack, already connected to the room."""
import pytest

from app import maptracker, recipes as rec, roomfeed


def test_every_map_pack_is_a_github_release_or_tag_zip():
    R = rec.load_all()
    with_map = sorted(rid for rid, r in R.items() if r.get("map_tracker"))
    assert with_map == ["balatro", "cuphead", "hitman", "re2", "re3", "sekiro", "terraria", "tunic"]
    for rid in with_map:
        maptracker.validate(R[rid]["map_tracker"], rid)
    bad = dict(R["tunic"], map_tracker={"uid": "x", "download": "https://evil.example/pack.zip"})
    with pytest.raises(rec.RecipeError):
        rec.validate(bad)


def test_command_opens_the_pack_connected_to_the_room(tmp_path):
    R = rec.load_all()
    exe = tmp_path / "poptracker.exe"
    cmd = maptracker.command(exe, R["re2"], {}, "archipelago.gg", 38281, "Mishal", "pw")
    assert cmd == [str(exe), "--load-pack", "resident evil 2 remake_ap", "--pack-variant", "Map Tracker",
                   "--ap-host", "archipelago.gg:38281", "--ap-slot", "Mishal", "--ap-password", "pw"]
    cup = R["cuphead"]
    assert "var_dlc" in maptracker.command(exe, cup, rec.effective_options(cup, {"use_dlc": True}), "h", 1, "M")
    assert "standard" in maptracker.command(exe, cup, rec.effective_options(cup, {}), "h", 1, "M")
    assert "--ap-password" not in maptracker.command(exe, cup, {}, "h", 1, "M")


def test_pack_and_poptracker_download_once(tmp_path, monkeypatch):
    monkeypatch.setenv("APPDATA", str(tmp_path))
    got = []
    monkeypatch.setattr(maptracker.runner, "download", lambda url, dest, task: got.append(url) or dest.parent.mkdir(parents=True, exist_ok=True) or dest.write_bytes(b"zip"))
    r = rec.load_all()["tunic"]
    t = maptracker.runner.Task()
    maptracker.ensure_pack(r, t)
    maptracker.ensure_pack(r, t)
    assert got == [r["map_tracker"]["download"]]


def test_room_trackers_links():
    f = roomfeed.RoomFeed("archipelago.gg", 1, "Mishal", tracker="TrK9")
    assert f.trackers() == {}
    f.my_slot, f.team = 3, 0
    assert f.trackers() == {"mine": "https://archipelago.gg/tracker/TrK9/0/3", "all": "https://archipelago.gg/tracker/TrK9"}


def test_first_run_question_is_answered(tmp_path, monkeypatch):
    """PopTracker waits on 'Check for updates on start?' until answered: the app answers it in its config."""
    import json
    monkeypatch.setenv("APPDATA", str(tmp_path))
    cfg = maptracker.home() / "portable-config" / "PopTracker" / "PopTracker.json"
    cfg.parent.mkdir(parents=True)
    cfg.write_text('{"at_uri": "keep me"}')
    maptracker.quiet_first_run()
    assert json.loads(cfg.read_text()) == {"at_uri": "keep me", "check_for_updates": False}
