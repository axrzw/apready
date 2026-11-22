# APReady (AP جاهز)

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
- `app/host.py`: installs the apworld for every game in `%APPDATA%/APReady/players`, copies
  the YAMLs to `Archipelago/Players`, runs ArchipelagoGenerate, and opens
  archipelago.gg/uploads. Most of these games are unofficial, so the website can't
  generate the seed itself. Local generation followed by an upload is the supported path.

## Recipe format (recipes/<id>.json)
```
id, name, name_ar, game (exact Archipelago game name), steam_appid, verified, notes_ar, sources[]
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
proves it's installed, tag, prerelease), `workshop` (workshop_id; done by itself once Steam
has downloaded it), `manual` (id, text_ar, url, every_time, done_if_exists = path/glob that
means it's already done, open_exe = launcher to open for the player,
open_folder = folder to show instead of printing its path), `copy`, `write_file`
(merge = keep the other keys of an existing JSON, ints = keys to write as numbers),
`thunderstore` (packages: ["Namespace-Name"]; installs them and every dependency
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

## Status: what to do first
All 28 recipes are `"verified": false`. Nov 2026 review: repos, asset names, game strings,
option keys and death_link keys were checked against the sources and release pages (see
the review notes in the commit history). What is still manual and why:
Elden Ring (Nexus needs a login), Cuphead connect (stored inside the save slot), Sekiro
connect (.NET user settings under a hashed path), RE4R per-seed patch (only the Wizard can),
the non-RTX Steam beta for RE2/3/7, and the one-time install button in the RE4R / Village /
RE9 launchers. None has been run on a real PC yet. In this order:
1. On Windows run `python -m app` and test Terraria end to end, since it's official and simplest.
2. For each recipe, open its sources and check: the repo names, the asset name globs
   (look at the actual release assets), the exact `game` string, the option keys and
   values (read the apworld's Options.py), and whether `death_link` is the right key.
   Set `"verified": true` once someone has actually played with it.
3. Replace `manual` steps with automation wherever possible. Examples: write
   tModLoader's mod config with slot and port, start the Sekiro client with connect
   args, pass `--connect {address} --name {slot}` to Archipelago clients that
   support it. The goal is zero manual steps after the first install.
4. Hitman: stock apworld from BenDipp/Archipelago (`hitman_woa.apworld`); the launcher
   component "HITMAN World of Assassination Client" is confirmed. Its Options.py has no
   Death Link option, but the recipe still writes `death_link` (the owner decides; see below).
5. Sekiro: apworld from yenix4/ArchipelagoSekiro, client `randomizerAP_windows_*.zip`
   extracted into the game folder. Game 1.06 + offline. Its `death_link` is a Choice with
   `alias_true` = full_death, so `true` works.

### Death Link per game (owner decided, Nov 2026)
- Cuphead: the owner played it with Death Link and it works. Leave the recipe as it is.
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
- Build exe: `build.bat`, or push a tag `v*` and GitHub Actions builds `APReady.exe`.

## Wanted next (owner asked)
- More Resident Evil parts. RE9 (Requiem) is added from LechapelierHD/Re9-archipelago.
  No Archipelago support found for the RE1 / RE0 remasters (Nov 2026). Check again later.
- Portal 1: no Archipelago support found yet (Nov 2026). Check again later.
