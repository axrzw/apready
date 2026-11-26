# Adding the finished game to My Ready AP

The repo's `CLAUDE.md` describes the recipe format in full; this is the short path for a game you just made.

1. Draft: `python -m tools.new_recipe --repo <owner>/<repo>` reads the apworld (ast, never imports it) and
   writes `recipes/<id>.json` with the game name, options, Death Link key and the TODO list.
2. Steps:
   - `apworld`: `github_release` of `<name>.apworld` into `{custom_worlds}` (host and players get it).
   - `install`: the mod (`github_release` with `extract`, or `thunderstore` if published there), plus the
     loader (BepInEx/MelonLoader) if the mod zip doesn't ship it.
   - `connect`: `write_file` of `ap_connection.json` with `{host}`, `{port}` (in `ints`), `{slot}`,
     `{password}`, `{death_link}` (in `bools`). No typing for the player, and free deaths work through the
     relay because the game connects to `{host}:{port}` given by the app.
   - `launch`: `steam_launch` (or `run` for a launcher / external client).
3. Content the page shows: `guide_ar`, `checks_ar`, `checks_count_ar`, `avoid_ar`, `tips_ar`, `length`,
   `genres`, `beginner`, `dl_fit` + `dl_fit_ar`, and `stores`/`exe` if GOG/Epic copies work.
4. Native amnesty option? Set `"free_deaths_native": true` and put that option inside the Death Link box
   (`"deathlink": true`), so the app doesn't add its own free-deaths relay on top.
5. Verify: `python -m pytest -q`, add the id to `.github/dry-run.txt` and push (the dry-run workflow installs
   it for real twice), and add the repo to `.github/release-repos.txt` if you need to see its release files.
6. A PopTracker pack? Add `map_tracker` {uid, variant, download}; the dry run checks uid and variant.
