"""Load game recipes (recipes/*.json) and build player YAML files."""
import json
import re
from pathlib import Path

from .paths import base_dir

STEP_TYPES = {
    "github_release", "workshop", "manual", "copy", "write_file",
    "steam_launch", "run", "open_url", "apworld_builtin", "json_list_add", "ini_set",
}
PHASES = ("apworld", "install", "connect", "launch")


class RecipeError(ValueError):
    pass


def validate(r: dict, source: str = "") -> dict:
    for key in ("id", "name", "game", "steam_appid"):
        if key not in r:
            raise RecipeError(f"{source}: missing '{key}'")
    for phase in PHASES:
        for i, step in enumerate(r.get(phase, [])):
            t = step.get("type")
            if t not in STEP_TYPES:
                raise RecipeError(f"{source}: {phase}[{i}] unknown type '{t}'")
            if t in ("manual",) and "id" not in step:
                raise RecipeError(f"{source}: {phase}[{i}] manual step needs an 'id'")
    for opt in r.get("options", []):
        if "key" not in opt or "default" not in opt:
            raise RecipeError(f"{source}: option needs 'key' and 'default'")
    return r


# Options every Archipelago world understands. Shown under "advanced".
COMMON_OPTIONS = [
    {"key": "progression_balancing", "label_ar": "توازن التقدم",
     "help_ar": "كل ما زاد، تجيك أغراضك المهمة أبكر وتعلق أقل (0 لين 99)",
     "default": 50, "min": 0, "max": 99, "advanced": True},
    {"key": "accessibility", "label_ar": "ضمان الوصول",
     "help_ar": "full: كل الأماكن توصل لها. minimal: بس اللي يكفي تخلص اللعبة",
     "default": "full", "choices": ["full", "minimal"], "advanced": True},
]


def load_all(folder: Path = None) -> dict:
    folder = folder or base_dir() / "recipes"
    out = {}
    for f in sorted(folder.glob("*.json")):
        r = validate(json.loads(f.read_text(encoding="utf-8")), f.name)
        keys = {o["key"] for o in r.get("options", [])}
        r["options"] = r.get("options", []) + [dict(o) for o in COMMON_OPTIONS if o["key"] not in keys]
        out[r["id"]] = r
    return out


def _yaml_value(v) -> str:
    if isinstance(v, bool):
        return "true" if v else "false"
    if isinstance(v, (int, float)):
        return str(v)
    s = str(v)
    if re.fullmatch(r"[A-Za-z0-9_\-]+", s):
        return s
    return json.dumps(s, ensure_ascii=False)


def safe_slot(name: str) -> str:
    """Archipelago slot names: max 16 chars, no spaces is safest."""
    name = re.sub(r"\s+", "_", name.strip())
    return name[:16] or "Player"


def parse_extra(text: str) -> dict:
    """Advanced box: one 'key: value' per line -> dict (values kept as typed)."""
    out = {}
    for line in (text or "").splitlines():
        line = line.strip()
        if not line or line.startswith("#") or ":" not in line:
            continue
        k, v = line.split(":", 1)
        k, v = k.strip(), v.strip()
        if not re.fullmatch(r"[A-Za-z0-9_]+", k):
            raise RecipeError(f"اسم خيار غلط: {k}")
        low = v.lower()
        if low in ("true", "false"):
            out[k] = low == "true"
        elif re.fullmatch(r"-?\d+", v):
            out[k] = int(v)
        else:
            out[k] = v.strip("'\"")
    return out


def build_yaml(recipe: dict, player_name: str, chosen: dict, death_link: bool,
               extra_text: str = "") -> str:
    game = recipe["game"]
    lines = [
        f"# made by APReady for {recipe['name']}",
        f"name: {_yaml_value(safe_slot(player_name))}",
        f"game: {_yaml_value(game)}",
        "",
        f"{_yaml_value(game)}:",
    ]
    values = {o["key"]: chosen.get(o["key"], o["default"]) for o in recipe.get("options", [])}
    dl_key = recipe.get("death_link_key", "death_link")
    if dl_key:
        values[dl_key] = death_link
    values.update(recipe.get("fixed_options", {}))
    values.update(parse_extra(extra_text))  # advanced overrides win
    if dl_key:
        values[dl_key] = death_link  # Death Link toggle always wins
    for k, v in values.items():
        lines.append(f"  {k}: {_yaml_value(v)}")
    return "\n".join(lines) + "\n"


def game_of_yaml(text: str):
    m = re.search(r"^game:\s*['\"]?([^'\"\n]+?)['\"]?\s*$", text, re.M)
    return m.group(1).strip() if m else None
