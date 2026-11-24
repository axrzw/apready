"""Load game recipes (recipes/*.json) and build player YAML files."""
import json
import re
from pathlib import Path

from .paths import base_dir

STEP_TYPES = {
    "github_release", "workshop", "manual", "copy", "write_file",
    "steam_launch", "run", "open_url", "apworld_builtin", "json_list_add", "json_list_remove", "ini_set", "thunderstore", "github_file",
    "save_slot_json",
}
PHASES = ("apworld", "install", "connect", "launch")


class RecipeError(ValueError):
    pass


def validate(r: dict, source: str = "") -> dict:
    for key in ("id", "name", "game", "steam_appid"):
        if key not in r:
            raise RecipeError(f"{source}: missing '{key}'")
    if not re.fullmatch(r"[a-z0-9_]{1,40}", str(r["id"])):  # the id becomes a folder name
        raise RecipeError(f"{source}: bad id '{r['id']}'")
    for phase in PHASES:
        for i, step in enumerate(r.get(phase, [])):
            t = step.get("type")
            if t not in STEP_TYPES:
                raise RecipeError(f"{source}: {phase}[{i}] unknown type '{t}'")
            if t in ("manual",) and "id" not in step:
                raise RecipeError(f"{source}: {phase}[{i}] manual step needs an 'id'")
            if t == "github_file" and not (re.fullmatch(r"[\w.-]+/[\w.-]+", str(step.get("repo", "")))
                                          and re.fullmatch(r"[\w./ -]+", str(step.get("path", ""))) and ".." not in step["path"]):
                raise RecipeError(f"{source}: {phase}[{i}] github_file needs repo 'owner/name' and a plain path")
            if step.get("when") and phase == "apworld":  # the host installs apworlds without anyone's choices
                raise RecipeError(f"{source}: {phase}[{i}] 'when' can't be used in the apworld phase")
            for k in (step.get("when") or {}):  # a step that only runs for some choices (Terraria + Calamity)
                if k not in {o.get("key") for o in r.get("options", [])}:
                    raise RecipeError(f"{source}: {phase}[{i}] 'when' names unknown option '{k}'")
    mt = r.get("map_tracker")
    if mt is not None:  # PopTracker map pack (app/maptracker.py): only the pack's own GitHub releases/tags
        if not isinstance(mt, dict) or not isinstance(mt.get("uid"), str) or not mt["uid"] or not re.fullmatch(
                r"https://github\.com/[\w.-]+/[\w.-]+/(releases/download/\S+|archive/refs/tags/[^\s/]+)\.zip",
                str(mt.get("download", ""))):
            raise RecipeError(f"{source}: map_tracker needs a uid and a github.com release or tag zip")
    for k in ("guide_ar", "avoid_ar"):
        v = r.get(k, [])
        if not isinstance(v, list) or not all(isinstance(x, str) for x in v):
            raise RecipeError(f"{source}: {k} must be a list of strings")
    if not isinstance(r.get("checks_ar", ""), str) or not isinstance(r.get("checks_count_ar", ""), str):
        raise RecipeError(f"{source}: checks_ar must be a string")
    for opt in r.get("options", []):
        if "key" not in opt or "default" not in opt:
            raise RecipeError(f"{source}: option needs 'key' and 'default'")
        if opt.get("multi"):
            vals = {c["value"] if isinstance(c, dict) else c for c in opt.get("choices", [])}
            if not isinstance(opt["default"], list) or not set(opt["default"]) <= vals:
                raise RecipeError(f"{source}: multi option {opt['key']} needs a default list from its choices")
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


# Free deaths for every game with Death Link: the app relays the game's connection and holds back
# that many deaths before sending one (app/dlproxy.py). Never written to the YAML. Games whose mod
# already has its own setting (Cuphead: deathlink_grace_count) set "free_deaths_native": true.
FREE_DEATHS = {"key": "free_deaths", "app_only": True, "deathlink": True, "default": 0, "min": 0, "max": 25,
               "label_ar": "موتات مجانية قبل ما ترسل",
               "help_ar": "مثلاً 2: الموتة الأولى والثانية ما ترسل، والثالثة ترسل للشباب. 0 = كل موتة ترسل. "
                          "شغّل اللعبة من ▶ العب. لو تكتب العنوان في اللعبة بنفسك، اكتب العنوان اللي يطلع لك فوق "
                          "(127.0.0.1...) مو عنوان الروم"}


def death_link_live(r: dict) -> bool:
    return bool(r.get("death_link_key", "death_link")) or bool(r.get("death_link_in_mod"))


def _prepare(r: dict) -> dict:
    keys = {o["key"] for o in r.get("options", [])}
    extra = []
    if death_link_live(r) and not r.get("free_deaths_native") and "free_deaths" not in keys:
        extra.append(dict(FREE_DEATHS))
    r["options"] = r.get("options", []) + extra + [dict(o) for o in COMMON_OPTIONS if o["key"] not in keys]
    return r


def load_all(folder: Path = None, extra: Path = None) -> dict:
    """Recipes shipped with the app, then the ones downloaded from the project repo (extra),
    which replace a shipped one with the same id. A downloaded recipe this version of the
    app can't read (e.g. a newer step type) is skipped and the shipped one is kept."""
    folder = folder or base_dir() / "recipes"
    out = {}
    for f in sorted(folder.glob("*.json")):
        r = validate(json.loads(f.read_text(encoding="utf-8")), f.name)
        out[r["id"]] = _prepare(r)
    if extra and extra.exists():
        for f in sorted(extra.glob("*.json")):
            try:
                r = validate(json.loads(f.read_text(encoding="utf-8")), f.name)
            except (ValueError, OSError):
                continue
            out[r["id"]] = _prepare(r)
    return out


def _yaml_value(v) -> str:
    if isinstance(v, (list, tuple, set)):  # OptionSet / OptionList: a YAML flow list
        return json.dumps(sorted(v) if isinstance(v, set) else list(v), ensure_ascii=False)
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


def effective_options(recipe: dict, chosen: dict) -> dict:
    """The player's choices with defaults filled in, plus what a choice turns on by itself
    (a choice with "sets": Terraria's Calamity goals switch Calamity on)."""
    vals = {o["key"]: (chosen or {}).get(o["key"], o["default"]) for o in recipe.get("options", [])}
    for o in recipe.get("options", []):
        for c in o.get("choices", []):
            picked = vals.get(o["key"])
            if isinstance(c, dict) and c.get("sets") and (
                    picked == c["value"] or (isinstance(picked, list) and c["value"] in picked)):
                vals.update(c["sets"])
    return vals


def step_applies(step: dict, options: dict) -> bool:
    return all(options.get(k) == v for k, v in (step.get("when") or {}).items())


def clean_value(o: dict, v):
    """A value the apworld will accept: numbers inside min/max (an empty or broken one takes the default),
    choices from the list, on/off as a bool. Archipelago checks every option, even unused ones, so one bad
    number (an emptied field sent as 0) stops the whole generation."""
    d = o["default"]
    if o.get("multi") or o.get("as_toggles"):
        allowed = {c["value"] if isinstance(c, dict) else c for c in o.get("choices", [])}
        kept = [x for x in v if x in allowed] if isinstance(v, list) else []
        return kept if kept or not d else list(d)  # nothing valid left (a removed choice): the default
    if isinstance(d, bool):
        return v if isinstance(v, bool) else d
    if o.get("choices"):
        allowed = [c["value"] if isinstance(c, dict) else c for c in o["choices"]]
        return v if v in allowed else (next((a for a in allowed if str(a) == str(v)), d))
    if "min" in o or "max" in o or (isinstance(d, int) and not isinstance(d, bool)):
        try:
            n = int(v)
        except (TypeError, ValueError):
            return d
        if v is None or v == "":
            return d
        if "min" in o:
            n = max(o["min"], n)
        if "max" in o:
            n = min(o["max"], n)
        return n
    return v


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
    values, added = {}, {}
    chosen = effective_options(recipe, chosen)
    for o in recipe.get("options", []):
        v = clean_value(o, chosen[o["key"]])
        if o.get("if_off") and not v:  # e.g. "I own this DLC" off -> exclude the DLC's locations
            for k, x in o["if_off"].items():
                added[k] = added.get(k, []) + x if isinstance(x, list) else x
        if o.get("app_only"):  # a question for the player, not an apworld option
            continue
        if o.get("as_toggles"):  # one tick list in the UI, one on/off option per choice in the apworld (BO3 maps)
            picked = set(v if isinstance(v, list) else [])
            for c in o["choices"]:
                values[c["value"]] = c["value"] in picked
        else:
            values[o["key"]] = v
    # options the apworld refuses to see equal (Hitman: goal level = starting level): move the first one
    for first, second in recipe.get("not_equal", []):
        if first in values and values.get(first) == values.get(second):
            o = next(x for x in recipe["options"] if x["key"] == first)
            allowed = [c["value"] if isinstance(c, dict) else c for c in o.get("choices", [])]
            values[first] = next((a for a in [o["default"]] + allowed if a != values[second]), values[first])
    # combinations the apworld refuses: {"if": {key: [values]}, "set": {key: value}} (DST: a boss goal with
    # caves off fails because the bosses live in the caves)
    for rule in recipe.get("fix_if", []):
        if all(values.get(k) in v for k, v in rule["if"].items()):
            values.update(rule["set"])
    dl_key = recipe.get("death_link_key", "death_link")
    if dl_key:
        values[dl_key] = death_link
    values.update(recipe.get("fixed_options", {}))
    values.update(added)
    extra = parse_extra(extra_text)
    for k, x in added.items():  # a list typed in the advanced box adds to ours, never drops it
        typed = extra.get(k)
        if isinstance(x, list) and isinstance(typed, str) and typed.startswith("[") and typed.endswith("]"):
            typed = [t.strip().strip("'\"") for t in typed[1:-1].split(",") if t.strip()]
        if isinstance(x, list) and isinstance(typed, list):
            extra[k] = list(dict.fromkeys(x + typed))
    values.update(extra)  # advanced overrides win
    if dl_key:
        values[dl_key] = death_link  # Death Link toggle always wins
    for k, v in values.items():
        lines.append(f"  {k}: {_yaml_value(v)}")
    return "\n".join(lines) + "\n"


def game_of_yaml(text: str):
    m = re.search(r"^game:\s*['\"]?([^'\"\n]+?)['\"]?\s*$", text, re.M)
    return m.group(1).strip() if m else None
