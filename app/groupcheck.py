"""Is this group of games a good mix? Plain-language advice for the host, from the players' YAML files and
each recipe's notes (length, how harsh Death Link is in it, co-op). Nothing here blocks generation."""

LEN_AR = {"short": "قصيرة", "medium": "متوسطة", "long": "طويلة"}


def check(players: list, recipes: dict) -> list:
    """players: [{"name", "game", "recipe", "death_link"}] (scan_players). Returns [{"level", "title", "text"}],
    level "bad" (will spoil the night), "warn" (worth a word in the group), "ok" (good to know)."""
    out = []
    known = [p for p in players if p.get("recipe") in recipes]
    unknown = [p for p in players if p.get("recipe") not in recipes]
    if not players:
        return out
    if unknown:
        out.append({"level": "bad", "title": "ألعاب ما لها وصفة",
                    "text": "، ".join(sorted({p.get("game") or p.get("file", "؟") for p in unknown}))
                    + ": لازم الـ apworld حقها يكون مثبت عندك يدوي، وإلا التوليد يفشل."})
    r_of = lambda p: recipes[p["recipe"]]
    who = lambda ps: "، ".join(p.get("name") or p.get("file", "؟") for p in ps)

    # Death Link: one harsh game kills everyone all night
    dl_on = [p for p in known if p.get("death_link") and _dl_live(r_of(p))]
    harsh = [p for p in dl_on if r_of(p).get("dl_fit") == 1]
    if harsh and len(dl_on) > 1:
        names = "، ".join(f"{p.get('name') or '؟'} ({r_of(p)['name']})" for p in harsh)
        out.append({"level": "bad", "title": "Death Link بيتعب الشباب",
                    "text": f"{names}: لعبة تموت فيها كثير. خلّه يرفع الموتات المجانية (أو «كل كم موتة ترسل») أو يطفّي Death Link، "
                            "وإلا بتموتون كل دقيقة."})
    dl_off = [p for p in known if not (p.get("death_link") and _dl_live(r_of(p)))]
    if dl_on and dl_off:
        out.append({"level": "ok", "title": "مو الكل في Death Link",
                    "text": f"{who(dl_off)} ما يموتون معكم ولا يقتلونكم. عادي، بس عشان تدرون."})

    # length: a 2-hour game next to a 40-hour one
    lens = {r_of(p).get("length") for p in known} - {None, ""}
    if "short" in lens and "long" in lens:
        short = [p for p in known if r_of(p).get("length") == "short"]
        out.append({"level": "warn", "title": "أطوال مختلفة كثير",
                    "text": f"{who(short)} بيخلصون بدري. اللي يخلص يقدر يسوي Release عشان أغراض الشباب توصلهم، "
                            "أو يحط لعبة ثانية معه (ملفين لنفس الشخص)."})

    # Minecraft: one slot per Minecraft world
    mc = [p for p in known if r_of(p)["id"] == "minecraft"]
    if len(mc) > 1:
        out.append({"level": "warn", "title": "أكثر من ماين كرافت",
                    "text": f"{who(mc)}: كل ملف ماين كرافت عالم منفصل بسيرفر. لو تبون تلعبون نفس العالم، ملف واحد يكفي والباقين يدخلون سيرفره."})

    # co-op games: friends on the same game can share a lobby
    by_game = {}
    for p in known:
        if "coop" in (r_of(p).get("genres") or []):
            by_game.setdefault(r_of(p)["name"], []).append(p)
    for game, ps in by_game.items():
        if len(ps) > 1:
            out.append({"level": "ok", "title": f"{game} مع بعض",
                        "text": f"{who(ps)} يقدرون يلعبون في نفس العالم/اللوبي، كل واحد باسمه."})

    if len(players) > 8:
        out.append({"level": "warn", "title": "مجموعة كبيرة",
                    "text": f"{len(players)} ملف: التوليد ياخذ وقت أطول، والروم يكون مزدحم بالرسائل. صفحة الروم تفلتر لك اللي يخصك."})
    if not any(o["level"] in ("bad", "warn") for o in out) and known:
        out.insert(0, {"level": "ok", "title": "المجموعة حلوة", "text": "ما فيه شي يخرّب الجولة. بالتوفيق!"})
    return out


def _dl_live(r: dict) -> bool:
    return bool(r.get("death_link_key", "death_link")) or bool(r.get("death_link_in_mod"))
