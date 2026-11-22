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
    assert {"terraria", "elden_ring", "sekiro", "hitman", "re2", "re3", "re4r", "re4_classic", "re7", "re8", "cuphead", "portal2"} <= set(all_recipes)


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
