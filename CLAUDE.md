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
- `app/window.py`: the app's own window: Edge (else Chrome/Brave) with `--app=` and its own profile in
  `%APPDATA%/APReady/window`, so it looks like a program (icon, no address bar) and the app quits when
  that window closes (process exit; or no `/api/ping` from the page for 150 s without the window process,
  10 min while it still runs; a clock jump = PC woke from sleep, not silence). One copy at a time
  (`running.json` + `/api/ping`); a second double-click just opens another window. If no such browser
  exists it opens a normal tab.
- `app/install.py`: a downloaded exe run from anywhere copies itself to
  `%LOCALAPPDATA%/Programs/MyReadyAP/MyReadyAP.exe` (no admin), makes "My Ready AP" shortcuts on the
  Desktop and in the Start menu pointing there, starts that copy (PYINSTALLER_RESET_ENVIRONMENT=1) and
  exits. A newer download does the same and first asks a running copy to quit (`/api/quit`, which also
  closes its window), so updating = download + run. The same file run again from Downloads just opens the
  installed copy (sha256 compare) and closes nothing. A copy older than v0.5.1 can't be asked to quit, so
  the new one shows a message box asking to close it. Shortcuts are made once per exe path
  (`shortcuts_for`), so a deleted shortcut stays deleted. Links from the page go through `/api/link` to the player's own browser
  (`/api/open` is the open-folder buttons).
  Version: `app/_version.py` says "dev"; the build writes the release tag there (step "Write version"),
  shown in the page's corner and in `/api/state` + `/api/ping`.
  The exe is built `--noconsole --icon app/icon.ico`; startup errors show a message box and
  `%APPDATA%/APReady/error.log`. Icon: `python -m tools.make_icon` (needs Pillow, dev only).
- `app/recipes.py`: loads `recipes/*.json`, adds common advanced options, builds the YAML.
- `app/runner.py`: runs recipe steps in a background thread. The UI polls `/api/task/<id>`.
  Each step must be safe to run again (idempotent).
- `app/steam.py`: finds Steam libraries from the registry and libraryfolders.vdf, and a game
  folder from its appid. Steam Family games are found the same way.
- `app/updates.py`: at start, syncs `recipes/*.json` from the project repo into
  `%APPDATA%/APReady/recipes_remote` (GitHub contents API + sha index). Each file is validated;
  one the app can't read (bad id, unknown step type) is skipped and the shipped one kept.
  Offline = nothing changes. The sync runs after the window opens, so the server bumps `RECIPES_REV` when
  the recipes really changed; `/api/ping` carries it and the page redraws the list and the open game by
  itself (before v0.6.3 the new options only showed after reopening). The notice lists only games that
  are really new or changed compared with what was loaded (a first sync re-downloads all of them).
- `tools/new_recipe.py` (dev tool, not in the exe): `--sheet "Game"` or `--repo o/r` writes a
  recipe draft: reads the apworld with `ast` (never imports it) for game name, options, the
  Death Link key and whether `true` is a valid value, client components; classifies mod zips;
  Steam appid from store search; prints the TODO list a human must check.
- `app/roomfeed.py`: the 📡 tab. The log drops server chatter (Join/Part/TagsChanged/Tutorial); the page's default filter
  «⭐ المهم» and it doesn't redraw while the reader is scrolled down (a «⬆ N رسائل جديدة» button). A read-only Archipelago client (tags TextOnly + DeathLink, items
  handling 0) on the player's own slot, with a stdlib WebSocket (wss, then ws). It never plays,
  sends checks or sends deaths; it shows every PrintJSON (items sent/received, hints, goals) and
  every DeathLink bounce, counts deaths per player, and shows progress: everyone's from the
  archipelago.gg tracker API (static_tracker totals + tracker checks/status), else only your own
  (Connected / RoomUpdate). Started by Play or by the tab. `parse_room` takes the archipelago.gg
  room link: it opens the room page (wakes it) and reads the port from /api/room_status.
- `app/dlproxy.py`: free deaths for every Death Link game. Each recipe with live Death Link gets the app-only
  option `free_deaths` (0-25, inside the Death Link box; not for Cuphead, whose mod has
  `deathlink_grace_count`: `"free_deaths_native": true`). With it above 0 and Death Link on, Play starts a
  local WebSocket relay (127.0.0.1:47281, else a free port) and gives the game that address instead of the
  room's ({host}/{port}/{address}). It passes everything through byte for byte except the game's own
  DeathLink Bounces: with N free deaths only every (N+1)th is sent. Deaths sent to the player are never
  touched. 0 = no relay, the game connects straight to the room. TLS attempts are closed so clients fall
  back to ws. The app stays alive after the window closes while a game is connected through the relay.
  The bar under the tabs shows the address to type (games where the player types it: Brotato, Buckshot,
  Content Warning, Cult of the Lamb, Elden Ring, Lethal Company, R.E.P.O., Sekiro, Stardew; Stardew and
  Sekiro also remember it), whether a game is connected through the relay, and a warning when a death
  of mine reached the room without passing the relay (`dlproxy.status`: the game is connected straight
  to the room, so free deaths can't work). The upstream socket has no read timeout (was 15 s: a quiet
  room dropped the game). CI `relay-check.yml` runs the real Archipelago.MultiClient.Net 6.7.1 through it.
- Death counter: the bar under the tabs (from `/api/ping`) shows everyone's deaths: Death Link messages
  heard in the room, and real totals My Ready AP apps share with a Bounce tagged `MyReadyAP`
  ({"kind": "deaths", "source", "deaths"}; "deaths?" asks the others). Shown = max of both per player;
  a remote app can't set my own number. Kept per seed in `%APPDATA%/APReady/deaths.json` (last 20).
- Hints (📡 tab card): the feed reads the room's hint storage `_read_hints_<team>_<slot>` (Get + SetNotify):
  «أغراضك وين» and «لازم تجيبها للشباب», found ones struck through; `/api/hint` sends `!hint <item>`
  (suggestions from `/api/hint_items`, my game's item names); points from Connected/RoomUpdate, cost =
  hint_cost % of my locations.
- Trackers (📡 tab): archipelago.gg's pages (`/tracker/<id>/<team>/<slot>` and `/tracker/<id>`; needs the
  room link so the tracker id is known) for every game, and `app/maptracker.py` for recipes with
  `map_tracker` {uid, variant, variant_if?, download}: PopTracker (black-sliver, portable, in
  %APPDATA%/APReady/tools/poptracker) + the pack, opened with --load-pack/--pack-variant/--ap-host/--ap-slot
  so it connects by itself. Packs (vetted: AP packs for the same mod; releases or tag zips of the pack's
  own repo): Hitman (BenDipp), TUNIC (SapphireSapphic), Terraria (SerpentAI), Cuphead (TheArcticFox42,
  var_dlc with use_dlc), Balatro (graygooglitch), RE2R/RE3R (TheRealSolidusSnake), Sekiro (vonTungsten).
  Content Warning's pack sits in a subfolder (not loadable as a tag zip); Stardew's is 2023 DEV; Brotato's
  has no versions. CI `map-check.yml` starts PopTracker with the app's arguments on Windows.
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
                 app_only: a question for the player, never written to the YAML; if_off {key: value}:
                 written when that option is off (lists add up, also with the advanced box). RE4R: "I own
                 Treasure Map: Expansion" off -> exclude_locations ["T.DLC"] (its 36 checks get filler).
                 A choice can carry `sets` {key: value}: picking it switches that option too (in the page
                 and in `effective_options`; Terraria's Calamity goals set calamity: true).
not_equal [[a, b]] options the apworld refuses to see equal (Hitman goal/starting level): `a` moves.
fix_if [{"if": {key: [values]}, "set": {...}}] combinations the apworld refuses (DST boss goal + no caves).
build_yaml cleans every value (`clean_value`): numbers into min/max (empty = default), choices from the
list, multi lists only known values. Option names/values were checked against each apworld's source with
an ast reader (no import); RE3R 0.2.99 accepts only difficulty standard (fixed_options).
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
from each package's manifest.json into the game the way r2modman does), `json_list_add` (path, items), `json_list_remove` (path, items), `github_file` (repo, path, branch, to, extract,
check: a raw file the author ships in the repo), `ini_set` (path, section, values, quote: true for
MelonPreferences TOML, false for BepInEx .cfg), `open_url`, `steam_launch`, `run` (exe may be a glob,
optional_args only added when the value isn't empty; `after_process` = exe name: start it in the background once
that game process runs, for tools that attach to the game (The Witness randomizer); `wait`: block until it exits),
`apworld_builtin`. `copy` takes `missing_ar` (the message when the game's own file, e.g. DOOM.WAD, isn't there).
Any step can have `skip_if_exists` (path/glob): if it exists the step is skipped (one-time installers).
Any step can have `when` {option: value}: it runs only if the player's choice matches (Terraria installs
and enables Calamity only with calamity on; `json_list_remove` turns it off otherwise). Setup uses the
choices on the page; Play uses the last YAML (what the host generated with).
`write_file` with `merge` merges nested JSON objects too.
Asset globs must match exactly one file of the release (a test rejects bare `*.zip`).
Clients inside an apworld (Archipelago Launcher components) are opened with
`ArchipelagoLauncher.exe "<Component>" -- --connect {address} --name {slot}`. Players get the
apworld too, because the setup and play buttons also run the `apworld` phase.
Placeholders: `{steam} {sourcemods} {game_dir} {ap_dir} {custom_worlds} {tools} {documents} {appdata}
{locallow} {workshop} (this game's Workshop content folder) {slot} {host} {port} {address} {password}
{has_password} (1/0) {death_link} (true/false) {death_link_ar} {slot_hex}` (the name as UTF-8 hex: APDOOM's
-applayerhex, so any letters survive the command line). `write_file` also takes
`bools` (keys to write as JSON true/false).

## Status (Nov 2026)
46 recipes, all `"verified": false`: nobody has played them on a real PC yet. `steam_appid` may be null
(Minecraft: Java edition, the card says «مو من ستيم»). The Nov 2026
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
  Add-ons are plain basic switches «عندي إضافة ...», off by default (owner's choice): enable_dlc
  (Shadow of the Erdtree) and enable_tp_dlc (Tarnished Edition / Tarnished Pack, 28 locations).
- RE4R: the Wizard wants Separate Ways and Treasure Map: Expansion. Separate Ways stays required
  (other players' items use its model). Treasure Map only adds 36 treasure checks (location group
  "T.DLC" in the apworld); without it the app excludes them and the player presses "Patch Anyway".
- Terraria + Calamity: the core apworld has `calamity` and Calamity goals (Rules.dsv flags them); the
  Seldom client supports CalamityMod (weakReferences). Workshop 2824688072 (CalamityMod) needs
  2824688266 (CalamityModMusic). Stardew's `mods` (SVE and ~25 more) is not added yet: those mods are
  on Nexus, so they'd need a manual download step.
- Cuphead DLC: `use_dlc` (switch «عندي إضافة The Delicious Last Course», off by default) and `mode` (goal;
  the dlc_* goals `sets` use_dlc, else the apworld picks a random base mode). Advanced: `dlc_chalice`,
  `dlc_kingsleap`. Field names = option names (the apworld's own test enforces it).
- Short games (Nov 2026): A Short Hike (BrandenEK: modding tools are a raw file in AShortHike.ModdingTools,
  step `github_file`; ModdingAPI/Randomizer/MapTracker releases into Modding/; no Death Link), Risk of Rain 2
  (Thunderstore Sneaki-Archipelago; connect fills BepInEx/config/com.Ijwu.Archipelago.cfg), Muse Dash
  (MelonLoader v0.7.0 per the official guide + DeamonHunter mod; connect writes UserData/ArchSaves/LastLogin.txt).
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

### Famous games added (Nov 2026, owner: "famous, longer games, and Minecraft")
Checked with CI because github.com is closed to this sandbox: `.github/workflows/release-info.yml` lists the
releases of the repos in `.github/release-repos.txt` and what is inside the files in `.github/release-assets.txt`
(`FILE:<path>` prints one file, e.g. an apworld's Options.py). `tools/dry_run.py` (+ `dry-run.yml`, ids in
`.github/dry-run.txt`, empty = all) runs recipes end to end with the real downloads twice and checks every map
pack's uid/variant against its manifest.json. Options were checked against the core worlds' source (ast).
- DOOM 1993 / DOOM II (both Steam 2280, base/DOOM.WAD, base/DOOM2.WAD) and Heretic (3286930, base/HERETIC.WAD):
  Daivuk/apdoom 1.2.0 (`LEGACY-APDOOM-*-Win32.zip`, the core worlds need 1.2.0), WAD copied next to it, started
  with `-game doom|doom2|heretic -apserver {address} -applayerhex {slot_hex}`: no typing at all.
- Hollow Knight: what Lumafly does, as github_release steps from hk-modding/modlinks: Modding API into Managed,
  Vasi, MenuChanger, ItemChanger, Benchwarp, QoL, Archipelago into Managed/Mods/<Name>. Connect writes
  LocalLow/Team Cherry/Hollow Knight/ArchipelagoMod.GlobalSettings.json (file = mod TYPE name). Its options are
  class names: `Goal`, `WhitePalace`, Death Link key `DeathLink`.
- Celeste (Open World): Everest stable `main.zip` + MiniInstaller-win64.exe (both skipped once everest-lib exists),
  mod zip into Mods/, connect writes Saves/modsettings-Archipelago Open World.celeste (Address/SlotName/Password;
  file name from Everest's Metadata.Name, not tested in game). Native `death_link_amnesty` (1-30).
- Subnautica: Berserker66 zip (has BepInEx) into the game; connect writes SNAppData/SavedGames/
  archipelago_last_connection.json (the mod's "last connection"; path from the mod source, not tested in game).
- The Witness: randomizer exe in tools, started by `after_process` witness64_d3d11.exe (it attaches at start-up and
  does not read the address from a file: the player types it). Native `death_link_amnesty` 0-5.
- A Hat in Time: Steam beta tcplink + workshop 3026842601 + developer console (manual once), "A Hat in Time Client"
  with --connect. Native `death_link_amnesty`. DLC goals `sets` EnableDLC1/EnableDLC2/EnableDeathWish.
- Dark Souls III: nex3 client v3.0.x (core world wants static randomizer >=3.0.0-beta.24 <3.1.0; fswap's newer
  clients are for their own apworld). DS3Randomizer.exe runs with `wait` (once per room), then launchmod bat.
- Inscryption, Bomb Rush Cyberfunk: Thunderstore packages (deps included). Noita: zip into mods/archipelago, the
  player allows unsafe mods and types the room in Mod Settings. Blasphemous: BrandenEK modding tools (raw
  win64.zip) + 9 mods from BlasphemousMods.json deps; Boots of Pleading / Double Jump only `when` their option.
  Timespinner: TsRandomizer into the game folder, started instead of the game.
- Minecraft: qixils/NeoForgeAP minecraft.apworld into custom_worlds (host and players); Play opens
  "Minecraft Client", the player opens their .apmc once per room (it sets up Java + NeoForge server); join
  localhost from Minecraft Java, /start. One slot per Minecraft world.
- Map trackers added: DOOM 1993 (Ozone31), The Witness (NewSoupVi), Noita (ScipioWright), A Hat in Time
  (Mysteryem), DS3 (TVV1GK).
- Not added: Mafia: The Old Country (no Archipelago support anywhere, Nov 2026); Overcooked! 2 (`deathlink` is a
  Choice, needs the per-recipe "on" value like Slay the Spire, plus an installer .bat); The Messenger (Courier
  install via the AP launcher); Raft (RML); Satisfactory (its mod manager); Factorio (separate copy + server).

### Games from the Archipelago games sheet still to add
Hades (Polycosmos needs ModImporter + ModUtil + StyxScribe + Python and a file picker every
run), ULTRAKILL (Thunderstore packages exist; check them), Supermarket Simulator (BepInEx 6 bleeding-edge build is not on
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
