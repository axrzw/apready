# APReady (AP جاهز)

One Windows program that lets a group of friends play an Archipelago multiworld without
fiddly setup. Each player opens the app, picks their game, presses Play. The host presses
one button to generate the seed. UI is Arabic (RTL); talk to the owner in Saudi Arabic.

## Hard rules
- **Death Link is a first-class feature.** Every game that supports it shows the big
  Death Link toggle, default ON. The toggle always wins over anything typed in the
  advanced box (`build_yaml` enforces this; a test covers it). Never remove or hide it.
- Two levels of options: basic (shown) and advanced (`"advanced": true`, inside the
  collapsible "خيارات متقدمة"), plus a free `key: value` box for any other option.
- Never download, bundle or share game files. Only mods / apworlds / tools from their
  official release pages.
- Only install apworlds from the repos written in the recipes. An .apworld is Python
  code that runs on the player's PC. Don't add "install from any URL".
- Friends never see YAML, ports or folder paths unless they open the advanced section.

## How it works
- `app/server.py`: stdlib HTTP server on 127.0.0.1. Opens the browser to `ui/index.html`.
  No third-party dependencies, so the PyInstaller exe stays small.
- `app/recipes.py`: loads `recipes/*.json`, adds common advanced options, builds the YAML.
- `app/runner.py`: runs recipe steps in a background thread. The UI polls `/api/task/<id>`.
  Each step must be safe to run again (idempotent).
- `app/steam.py`: finds Steam libraries from the registry and libraryfolders.vdf, and a game
  folder from its appid. Steam Family games are found the same way.
- `app/host.py`: installs the apworld for every game in `%APPDATA%/APReady/players`, copies
  the YAMLs to `Archipelago/Players`, runs ArchipelagoGenerate, and opens
  archipelago.gg/uploads. Most of these games are unofficial, so the website can't
  generate the seed itself. Local generation followed by an upload is the supported path.

## Recipe format (recipes/<id>.json)
```
id, name, name_ar, game (exact Archipelago game name), steam_appid, verified, notes_ar, sources[]
death_link_key   (default "death_link"; set null if the game has no Death Link)
options[]        {key, label_ar, help_ar, default, choices?|min/max, advanced?}
fixed_options{}  always written
apworld[]        steps the HOST needs (apworld install)
install[]        one-time steps on the player's PC
connect[]        per-session steps before launch (write configs with {slot} {host} {port})
launch[]         start the game / client
```
Step types: `github_release` (repo, asset glob or "__source__", to, extract,
strip_top_folder, tag), `workshop` (workshop_id), `manual` (id, text_ar, url,
every_time), `copy`, `write_file`, `open_url`, `steam_launch`, `run`, `apworld_builtin`.
Placeholders: `{steam} {sourcemods} {game_dir} {ap_dir} {custom_worlds} {tools} {documents} {appdata}
{slot} {host} {port} {address} {password}`.

## Status: what to do first
All 12 recipes are `"verified": false`. They were written from the setup guides in each
recipe's `sources` but have never been run on a real PC. In this order:
1. On Windows run `python -m app` and test Terraria end to end, since it's official and simplest.
2. For each recipe, open its sources and check: the repo names, the asset name globs
   (look at the actual release assets), the exact `game` string, the option keys and
   values (read the apworld's Options.py), and whether `death_link` is the right key.
   Set `"verified": true` once someone has actually played with it.
3. Replace `manual` steps with automation wherever possible. Examples: write
   tModLoader's mod config with slot and port, start the Sekiro client with connect
   args, pass `--connect {address} --name {slot}` to Archipelago clients that
   support it. The goal is zero manual steps after the first install.
4. Hitman uses the stock Archipelago apworld from BenDipp/Archipelago (not MultiworldGG).
   Check that the launcher component name is "HITMAN World of Assassination Client".
5. Sekiro needs the game on version 1.06 and Steam offline. Find the apworld's release
   repo, which is linked from the client or from panludia, and automate it.

## Adding a game
See ADDING_GAMES.md. Copy the closest recipe, fill in the fields, run `pytest`, and test it.

## Commands
- Run: `python -m app`
- Tests: `python -m pytest -q`
- Build exe: `build.bat`, or push a tag `v*` and GitHub Actions builds `APReady.exe`.

## Wanted next (owner asked)
- More Resident Evil parts. FuzzyGamesOn/REF_Inspect also mentions RE9, so check whether an RE9 AP exists.
  Also look for RE1/RE0 remasters.
- Portal 1: no Archipelago support found yet (Nov 2026). Check again later.
