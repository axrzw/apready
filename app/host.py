"""Host side: install every needed apworld, generate the seed, open the upload page."""
import re
import shutil
import subprocess
import sys
import webbrowser

from . import recipes as rec
from .paths import ap_dir, load_settings, players_dir
from .runner import Task, context, ensure_archipelago, run_step

UPLOAD_URL = "https://archipelago.gg/uploads"


def scan_players(all_recipes: dict) -> list:
    by_game = {r["game"]: r for r in all_recipes.values()}
    out = []
    for f in sorted(players_dir().glob("*.y*ml")):
        text = f.read_text(encoding="utf-8", errors="ignore")
        game = rec.game_of_yaml(text)
        r = by_game.get(game)
        out.append({"file": f.name, "game": game, "recipe": r["id"] if r else None,
                    "name": _yaml_field(text, "name"),
                    # Death Link as written for this game (our files say `true`/`false`; weights count as on if `true` is there)
                    "death_link": _dl_on(text, (r or {}).get("death_link_key", "death_link"))})
    return out


def _yaml_field(text: str, key: str):
    m = re.search(rf"^{re.escape(key)}:\s*['\"]?([^'\"\n]+?)['\"]?\s*$", text, re.M)
    return m.group(1).strip() if m else None


def _dl_on(text: str, key) -> bool:
    if not key:
        return False
    m = re.search(rf"^\s+{re.escape(key)}:\s*(.*)$", text, re.M)
    if not m:
        return False
    v = m.group(1).strip().strip("'\"").lower()
    if v in ("true", "on", "1", "yes"):
        return True
    if v == "":  # weights on the next lines: on if any truthy choice has weight
        tail = text[m.end():].splitlines()[:4]
        return any(re.match(r"\s+['\"]?(true|on)['\"]?:\s*[1-9]", t) for t in tail)
    return False


def generate(task: Task, all_recipes: dict):
    settings = load_settings()
    ensure_archipelago(task, settings)
    players = scan_players(all_recipes)
    if not players:
        raise RuntimeError("ما فيه ملفات YAML. حط ملفات الشباب في مجلد اللاعبين أول")
    unknown = [p["file"] for p in players if not p["recipe"]]
    if unknown:
        task.say("⚠ ألعاب ما عندنا لها وصفة (لازم الـ apworld حقها يكون مثبت يدوي): " + ", ".join(unknown))

    # every game in the seed needs its apworld on the host PC
    for rid in sorted({p["recipe"] for p in players if p["recipe"]}):
        r = all_recipes[rid]
        task.say(f"— apworld حق {r['name']}")
        ctx = context(r, settings)
        for step in r.get("apworld", []):
            run_step(step, ctx, settings, r, task)

    apd = ap_dir(settings)
    pdir = apd / "Players"
    pdir.mkdir(parents=True, exist_ok=True)
    for old in pdir.glob("*.y*ml"):
        old.unlink()
    for f in players_dir().glob("*.y*ml"):
        shutil.copy2(f, pdir / f.name)
    task.say(f"✔ نسخت {len(players)} ملف للاعبين")

    exe = apd / ("ArchipelagoGenerate.exe" if sys.platform == "win32" else "ArchipelagoGenerate")
    out = apd / "output"
    before = set(out.glob("*.zip")) if out.exists() else set()
    task.say("… أولّد السيد")
    # output is shown in the app, so no console box; stdin closed so a "press enter" can't hang it
    proc = subprocess.run([str(exe)], cwd=str(apd), capture_output=True, text=True, stdin=subprocess.DEVNULL,
                          creationflags=0x08000000 if sys.platform == "win32" else 0)
    after = set(out.glob("*.zip")) if out.exists() else set()
    new = sorted(after - before, key=lambda p: p.stat().st_mtime)
    if proc.returncode != 0 or not new:
        tail = "\n".join((proc.stdout + proc.stderr).splitlines()[-15:])
        raise RuntimeError("التوليد فشل:\n" + tail)
    zipf = new[-1]
    task.say(f"✔ السيد جاهز: {zipf.name}")
    task.say("ارفع الملف في الصفحة اللي انفتحت، وانسخ رابط الروم وارسله في القروب")
    if sys.platform == "win32":
        subprocess.Popen(["explorer", "/select,", str(zipf)])
    webbrowser.open(UPLOAD_URL)
    return str(zipf)
