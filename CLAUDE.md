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
strip_top_folder, pick = glob of one file inside the zip to copy flat, check = path that
proves it's installed, tag, prerelease), `workshop` (workshop_id; done by itself once Steam
has downloaded it), `manual` (id, text_ar, url, every_time, done_if_exists = path/glob that
means it's already done, open_exe = launcher to open for the player), `copy`, `write_file`
(merge = keep the other keys of an existing JSON, ints = keys to write as numbers),
`json_list_add` (path, items), `open_url`, `steam_launch`, `run` (exe may be a glob,
optional_args only added when the value isn't empty), `apworld_builtin`.
Asset globs must match exactly one file of the release (a test rejects bare `*.zip`).
Clients inside an apworld (Archipelago Launcher components) are opened with
`ArchipelagoLauncher.exe "<Component>" -- --connect {address} --name {slot}`, so players need
the apworld too (put the same step in `install`).
Placeholders: `{steam} {sourcemods} {game_dir} {ap_dir} {custom_worlds} {tools} {documents} {appdata}
{slot} {host} {port} {address} {password}`.

## Status: what to do first
All 13 recipes are `"verified": false`. Nov 2026 review: repos, asset names, game strings,
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

### Open questions for the owner (Death Link, not changed on purpose)
- Cuphead's apworld names the option `deathlink` (no underscore). The recipe still uses the
   default `death_link`, so the toggle probably does nothing there. Fix: `"death_link_key": "deathlink"`.
- Hitman has no Death Link. Per the rule above its recipe should get `"death_link_key": null`.

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
