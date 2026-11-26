---
name: archipelago-port
description: Build Archipelago support for a game that has none: the apworld (items, locations, logic, options, Death Link) and the in-game mod/client that sends checks and receives items, then wire it into My Ready AP as a recipe. Use this whenever someone wants to add a game to Archipelago "from scratch", make a randomizer/multiworld mod, port a game to Archipelago, asks "can we make Archipelago work for <game>", or a game they want isn't on the Archipelago games sheet, even if they don't say "apworld" or "mod".
---

# Make any game an Archipelago game

Two halves always exist, and they meet at one contract:

1. **The apworld** (Python, runs on the host when the seed is generated): what the items and locations are,
   which locations need which items (logic), the player's options, and `slot_data` for the client.
2. **The game side** (a mod or an external client): when the player does a check-worthy thing, send
   `LocationChecks`; when the server sends items, give them in-game; send/receive Death Link; report the goal.

The contract between them is **the id tables** (item and location names → ints) plus `slot_data`. Write it
down first (a JSON in the repo both halves read) and everything else becomes ordinary work.

## Before writing code: is it worth it, and is it allowed?

- Check it isn't already done: the Archipelago games sheet (`python -m tools.new_recipe --sheet "<game>"` in
  this repo searches it), GitHub (`gh api -X GET search/repositories -f q='<game> archipelago'`), the AP
  Discord's future-game-design channel. Joining an existing effort beats a second one.
- **Online games with anti-cheat** (Easy Anti-Cheat, BattlEye, Vanguard, Ricochet...) are a no: injecting
  code gets accounts banned. Only do those if the game has an official offline mode where anti-cheat is off
  (Elden Ring / Dark Souls 3 style: the mod launches the game in offline mode), and say so in the recipe.
  Co-op games without anti-cheat (most Unity/indie co-op on Steam) are fine.
- Never ship the game's files. The mod and apworld are the only things released.

## Step 1: find out what you're dealing with

Run `python scripts/detect_engine.py "<game folder>"`. It reports the engine and the usual way in. Then read
the matching part of `references/engines.md`:

| Engine (what's in the folder)                        | Way in                                                   |
|------------------------------------------------------|----------------------------------------------------------|
| Unity Mono (`*_Data/Managed/Assembly-CSharp.dll`)     | BepInEx 5 + Harmony patches, C# with Archipelago.MultiClient.Net |
| Unity IL2CPP (`GameAssembly.dll`)                     | BepInEx 6 (IL2CPP) or MelonLoader, same client library  |
| Unreal (`*.pak`, `Binaries/Win64`)                    | UE4SS (Lua or C++ mods) + a small socket bridge, or memory |
| Godot (`*.pck`)                                       | Godot Mod Loader / GDWeave (C#), or GDScript with a WebSocket |
| GameMaker (`data.win`)                                | UndertaleModTool script patches + a bridge (see Buckshot's APBuckshot) |
| XNA/FNA/MonoGame (`*.exe` .NET, `Content/`)           | Harmony via a launcher (Everest-style) or a loader like SMAPI/TsRandomizer |
| Source / GoldSrc                                     | VScript/SourceMod or memory + console bridge (Portal 2 AP does this) |
| Anything else / emulated / old                        | External Python client reading/writing memory (pymem), BizHawk-style |

Prefer an in-process mod with MultiClient.Net when the engine allows it: it is the best-trodden path,
handles reconnects, and the player needs nothing else running. External memory clients are the universal
fallback (every game has memory) but are fragile across game updates, so pin the game version.

## Step 2: design the world on paper (an hour here saves days)

Write `design.md` with:
- **Locations**: things the player does once and the game can detect: picking up a unique item, opening a
  chest, finishing a level, beating a boss, an achievement. Each gets a stable name. Aim for 50-500.
  Things that can be missed forever need care (mark them, or exclude by default).
- **Items**: what gets shuffled. Progression (gates: keys, abilities, level unlocks), useful (upgrades),
  filler (money, consumables), traps. Count must equal locations (pad with filler).
- **Regions and rules**: which locations need which items. Start with a coarse graph (5-15 regions). A
  "sphere 1" must exist: enough checks reachable with nothing.
- **Goal**: one event the client can see (final boss dead, N levels done).
- **Options**: goal choice, length knobs, `death_link` (always, if the game has deaths), and if deaths are
  very frequent in this game a `death_link_amnesty` (Range, deaths before one is sent).
- **What the mod must do to the game**: block vanilla progression at each location (the chest gives an AP
  item instead), grant received items, save which item index it already got per seed.

Show the design to the person before coding. It's the part they have opinions about.

## Step 3: the apworld

Use `references/apworld.md` (skeleton, rules, tests). Build it against the current Archipelago release:
clone `ArchipelagoMW/Archipelago`, put the world in `worlds/<short_name>/`, and run its own tests
(`python -m pytest worlds/<short_name>`) plus a 1-player and a 3-player generate with `Generate.py`.
Package with the Launcher's "Build APWorlds" or by zipping the folder (`<short_name>.apworld`) with an
`archipelago.json` manifest.

## Step 4: the game side

Use `references/client.md`. Whatever the engine, the client must:
- read the connection from a JSON file next to the mod (`ap_connection.json`: host, port, slot, password,
  death_link) and also offer an in-game box. My Ready AP fills that file, so the player types nothing.
- send `LocationChecks` immediately, and resend all checked ones on reconnect (the server ignores repeats).
- apply `ReceivedItems` by **index**: store the last index per seed; on connect the server resends from 0.
- report the goal with `StatusUpdate` 30 (`session.SetGoalAchieved()`).
- Death Link: tag `DeathLink`, send a Bounce when the player dies (with a `cause` text), kill the player on
  a received one (ignore your own `source`). Respect `death_link` from slot_data and the amnesty option.
- show received/sent items in-game (a small message log), and reconnect by itself after drops.

## Step 5: test like a player, then release

1. Local server: `python MultiServer.py <seed>.archipelago`; play through sphere 1, receive an item from a
   second client (`!getitem` as admin in the server console), die with Death Link on.
2. Release on GitHub: the apworld and the mod zip as release assets, version-tagged together.
3. Add it to My Ready AP: `references/myreadyap.md` (recipe, connect file, dry run, map tracker).

## Working style

- Keep the id tables in one JSON both halves generate from; never hand-edit ids twice.
- Commit after each milestone; the person should be able to play sphere 1 early, long before the world is
  complete. Ship small: 30 locations that work beat 300 that don't.
- When something can't be detected or blocked in-game, say so plainly and leave it out of the location list.
