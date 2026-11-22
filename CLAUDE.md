# My Ready AP (was APReady / AP جاهز)

One Windows program that lets a group of friends play an Archipelago multiworld without
fiddly setup. Each player opens the app, picks their game, presses Play. The host presses
one button to generate the seed. UI is Arabic (RTL); talk to the owner in Saudi Arabic.

## Hard rules
- **Death Link is a first-class feature.** Every game that supports it shows the big
  Death Link toggle, default ON. The toggle always wins over anything typed in the
  advanced box (`build_yaml` enforces this; a test covers it). Never remove or hide it.
  A game with no Death Link at all (checked in the apworld AND the mod) keeps the toggle on
  screen, greyed out and locked, with a short note (owner's choice).
- Two levels of options: basic (shown) and advanced (`"advanced": true`, inside the
  collapsible "خيارات متقدمة"), plus a free `key: value` box for any other option.
- Never download, bundle or share game files. Only mods / apworlds / tools from their
  official release pages.
- Only install apworlds from the repos written in the recipes. An .apworld is Python
  code that runs on the player's PC. Don't add "install from any URL".
- Recipes come only from the app itself and from this project's own repo
  (`app/updates.py`, default axrzw/apready@main). Never let users add a recipe or repo URL.
- Friends never see YAML, ports or folder paths unless they open the advanced section.

## How it works
- `app/server.py`: stdlib HTTP server on 127.0.0.1. Opens the browser to `ui/index.html`.
  No third-party dependencies, so the PyInstaller exe stays small.
- `app/recipes.py`: loads `recipes/*.json`, adds common advanced options, builds the YAML.
- `app/runner.py`: runs recipe steps in a background thread. The UI polls `/api/task/<id>`.
  Each step must be safe to run again (idempotent).
- `app/steam.py`: finds Steam libraries from the registry and libraryfolders.vdf, and a game
  folder from its appid. Steam Family games are found the same way.
- `app/updates.py`: at start, syncs `recipes/*.json` from the project repo into
  `%APPDATA%/APReady/recipes_remote` (GitHub contents API + sha index). Each file is validated;
  one the app can't read (bad id, unknown step type) is skipped and the shipped one kept.
  Offline = nothing changes. The UI shows the names of new games once.
- `tools/new_recipe.py` (dev tool, not in the exe): `--sheet "Game"` or `--repo o/r` writes a
  recipe draft: reads the apworld with `ast` (never imports it) for game name, options, the
  Death Link key and whether `true` is a valid value, client components; classifies mod zips;
  Steam appid from store search; prints the TODO list a human must check.
- `app/roomfeed.py`: the 📡 tab. A read-only Archipelago client (tags TextOnly + DeathLink, items
  handling 0) on the player's own slot, with a stdlib WebSocket (wss, then ws). It never plays,
  sends checks or sends deaths; it shows every PrintJSON (items sent/received, hints, goals) and
  every DeathLink bounce, counts deaths per player, and shows progress: everyone's from the
  archipelago.gg tracker API (static_tracker totals + tracker checks/status), else only your own
  (Connected / RoomUpdate). Started by Play or by the tab. `parse_room` takes the archipelago.gg
  room link: it opens the room page (wakes it) and reads the port from /api/room_status.
- `app/host.py`: installs the apworld for every game in `%APPDATA%/APReady/players`, copies
  the YAMLs to `Archipelago/Players`, runs ArchipelagoGenerate, and opens
  archipelago.gg/uploads. Most of these games are unofficial, so the website can't
  generate the seed itself. Local generation followed by an upload is the supported path.

## Recipe format (recipes/<id>.json)
```
id, name, name_ar, game (exact Archipelago game name), steam_appid, verified, notes_ar, sources[]
                 (the UI shows `name`: the game's own official name, owner's choice; name_ar is not shown)
guide_ar[]       short numbered steps shown under the game ("📖 كيف أشغّلها"): what the player does
                 after pressing Play (in-game menus, Steam settings). Every recipe needs one (test).
checks_ar        what counts as a check in this game and how it is sent ("🎯" section). Required (test).
avoid_ar[]       warnings: what to avoid (switching saves, worlds, teleports...). Required (test).
                 Death Link sub-settings are normal options with `"deathlink": true`: shown inside the
                 Death Link box only while it is on (Cuphead deaths-before-sending, BO3/PEAK triggers...).
death_link_key   (default "death_link"; null if the apworld has no Death Link option)
death_link_in_mod  true when the apworld has no option but the mod has Death Link itself
                 (TUNIC, Buckshot Roulette): the toggle stays live, connect steps use
                 {death_link} / {death_link_ar}. null key without this = toggle greyed out.
options[]        {key, label_ar, help_ar, default, choices?|min/max, advanced?}
fixed_options{}  always written
apworld[]        steps the HOST needs (apworld install)
install[]        one-time steps on the player's PC
connect[]        per-session steps before launch (write configs with {slot} {host} {port})
launch[]         start the game / client
```
Step types: `github_release` (repo, asset glob or "__source__", to, extract,
strip_top_folder, pick = glob of one file inside the zip to copy flat, check = path that
proves it's installed, tag, prerelease, tag_prefix = only releases whose tag starts with it), `workshop` (workshop_id; done by itself once Steam
has downloaded it), `manual` (id, text_ar, url, every_time, done_if_exists = path/glob that
means it's already done, open_exe = launcher to open for the player,
open_folder = folder to show instead of printing its path), `copy`, `write_file`
(merge = keep the other keys of an existing JSON, ints = keys to write as numbers),
`save_slot_json` (dir, slots, file / game_file with {n}, values, ints: Cuphead keeps
Archipelago per save slot; a new YAML marks a new game, so Play enables a slot that has no game
save and is not enabled yet, and later Plays only update address/port of that slot; never
touches a played slot; sets {save_slot} for the launch hint), `thunderstore` (packages: ["Namespace-Name"]; installs them and every dependency
from each package's manifest.json into the game the way r2modman does), `json_list_add` (path, items), `ini_set` (path, section, values, quote: true for
MelonPreferences TOML, false for BepInEx .cfg), `open_url`, `steam_launch`, `run` (exe may be a glob,
optional_args only added when the value isn't empty), `apworld_builtin`.
Any step can have `skip_if_exists` (path/glob): if it exists the step is skipped (one-time installers).
`write_file` with `merge` merges nested JSON objects too.
Asset globs must match exactly one file of the release (a test rejects bare `*.zip`).
Clients inside an apworld (Archipelago Launcher components) are opened with
`ArchipelagoLauncher.exe "<Component>" -- --connect {address} --name {slot}`. Players get the
apworld too, because the setup and play buttons also run the `apworld` phase.
Placeholders: `{steam} {sourcemods} {game_dir} {ap_dir} {custom_worlds} {tools} {documents} {appdata}
{locallow} {workshop} (this game's Workshop content folder) {slot} {host} {port} {address} {password}
{has_password} (1/0) {death_link} (true/false) {death_link_ar}`. `write_file` also takes
`bools` (keys to write as JSON true/false).

## Status (Nov 2026)
28 recipes, all `"verified": false`: nobody has played them on a real PC yet. The Nov 2026
work (PR #1, branch `claude/claude-md-recipes-review-j78ner`) did:
- Checked every recipe against its sources and the real release files: repo, asset globs,
  exact `game` string, option keys/values (from Options.py), Death Link key and type.
- Ran every recipe end to end on a fake Steam layout with the real downloads (GitHub and
  Thunderstore), twice (the second run downloads and asks nothing). Keep doing this for new
  recipes: see the dry-run approach in the commit history.
- Automated connect wherever the mod reads host/slot from a file. Still manual, and why:
  Sekiro
  connect (.NET user settings under a hashed path), RE4R per-seed patch (only the Wizard can),
  the non-RTX Steam beta for RE2/3/7, the one-time install button in the RE4R / Village / RE9
  launchers, typing the room in-game for games whose mod saves nothing (Buckshot, Brotato,
  R.E.P.O., Lethal Company, Content Warning, Cult of the Lamb, Valheim, Stardew first farm).

What to do next, in this order:
1. On Windows run `python -m app` and test Terraria end to end (official and simplest), then
   the others. Set `"verified": true` once someone has actually played a game with it.
2. Recipe updates need the repo to be readable without login: either make axrzw/apready
   public, or move recipes to a public recipes-only repo and change `DEFAULT_REPO` in
   `app/updates.py`. Until then friends only get the recipes inside their exe.
3. Build the first exe with the updater (`build.bat` or a `v*` tag) and give it to friends once.
4. New games: `python -m tools.new_recipe --sheet "<name>"`, then do its TODO list.

Notes kept from the review:
- Hitman: stock apworld from BenDipp/Archipelago (`hitman_woa.apworld`); launcher component
  "HITMAN World of Assassination Client" confirmed.
- Sekiro: apworld from yenix4/ArchipelagoSekiro, client `randomizerAP_windows_*.zip`
  extracted into the game folder. Game 1.06 + offline. Its `death_link` is a Choice with
  `alias_true` = full_death, so `true` works.
- Elden Ring: thefifthmatt/SoulsRandomizers, pinned tag eldenring-ap-0.1.4 (the repo also releases other
  randomizers; a pin keeps host and players on one version and works on old exes), game "EldenRing"
  (the Nexus 10334 mod by 4laric is a different implementation and its GitHub repo is private).
  `death_link_amnesty` and `boss_scaling_percent` exist but are marked "unsupported, till after first
  release" in options.py (v0.1.4), so the recipe leaves them out. Per-seed steps happen in its own app.
- Stardew: core apworld is world 7.4.x, so the mod glob is pinned to `StardewArchipelago.7.*.zip`.
- RE Village releases are on Snokay/Archipelago-RE-Village (the LiterallyMetaphorical copy has none).

### Death Link per game (owner decided, Nov 2026)
- Cuphead: the apworld's option is `deathlink` (no underscore), and its slot data sends
  `deathlink` = 0 unless that option is on, so the mod never enables Death Link. The recipe
  wrote `death_link`, so the owner's test (Nov 2026) sent no death. Fixed:
  `"death_link_key": "deathlink"`. Death Link in Cuphead only works inside levels.
  The same test showed the owner never enabled Archipelago on a save slot (C+Z menu), so the
  game ran unrandomized; the app now does that itself (`save_slot_json`).
- Hitman (docs: "Deathlink is not supported") and Valheim (no option, nothing in the mod
  DLL): `death_link_key: null`, toggle greyed out.
- TUNIC: no apworld option, but the mod has `DeathLinkEnabled` in Settings.json; the connect
  step writes it from the toggle. Buckshot Roulette: the mod has a DeathLink checkbox in its
  connect window (not saved anywhere), so the hint tells the player how to set it.
- Slay the Spire (wanted, not added yet): its `death_link` is a Range 0-100 (% of health lost),
  default 0, so `death_link: true` makes generation fail. Needs a per-recipe value for "on"
  (e.g. 100) in `build_yaml`. Ask the owner first.

### Games from the Archipelago games sheet still to add
Hades (Polycosmos needs ModImporter + ModUtil + StyxScribe + Python and a file picker every
run), Dark Souls III (the client ships its own dark_souls_3.apworld that clashes with the core
one; per-seed static randomizer), Hollow Knight, Risk of Rain 2 / ULTRAKILL (Thunderstore
packages exist; check them), Supermarket Simulator (BepInEx 6 bleeding-edge build is not on
GitHub releases), Silksong (.rar release), WEBFISHING (GDWeave, not BepInEx), TF2 MvM (server plugin), Deep Rock Galactic (mod.io).

## Adding a game
See ADDING_GAMES.md. Copy the closest recipe, fill in the fields, run `pytest`, and test it.

## Commands
- Run: `python -m app`
- Tests: `python -m pytest -q`
- Build exe: `build.bat`, or push a tag `v*` (or run the workflow with `release_tag`) and GitHub Actions
  builds `MyReadyAP.exe` (also uploaded as `APReady.exe` so old links keep working).
  Internal names (`app/`, `%APPDATA%/APReady`) stay, so settings survive the rename.

## Wanted next (owner asked)
- More Resident Evil parts. RE9 (Requiem) is added from LechapelierHD/Re9-archipelago.
  No Archipelago support found for the RE1 / RE0 remasters (Nov 2026). Check again later.
- Portal 1: no Archipelago support found yet (Nov 2026). Check again later.
