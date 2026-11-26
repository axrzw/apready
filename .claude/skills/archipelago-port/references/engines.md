# Ways into each engine

## Contents
- Unity (Mono) - the easy case
- Unity (IL2CPP)
- Unreal Engine 4/5
- Godot
- GameMaker
- .NET games (XNA/FNA/MonoGame)
- Source
- Anything else: an external memory client
- Finding the hooks (what to patch)

## Unity (Mono): the easy case
`<Game>_Data/Managed/Assembly-CSharp.dll` exists. Use **BepInEx 5** (the x64 build that matches the game)
and a plugin targeting `netstandard2.0` or the game's .NET version.
- References: `BepInEx.dll`, `0Harmony.dll`, the game's `Assembly-CSharp.dll`, `UnityEngine*.dll`, and
  `Archipelago.MultiClient.Net` (NuGet; ship its dll next to the plugin, plus `Newtonsoft.Json` if the game
  doesn't have it).
- Decompile `Assembly-CSharp.dll` with ILSpy/dnSpy. Search for pickup, chest, save, death, level-complete
  methods. Patch with Harmony prefixes (block vanilla reward, send the check) and postfixes (detect events).
- Run Archipelago network calls off the main thread; queue item grants and apply them in `Update()` on the
  main thread (Unity APIs are not thread-safe).
- If Thunderstore has this game, publish there too: My Ready AP's `thunderstore` step installs with deps.
- Examples worth reading: Risk of Rain 2 (Ijwu/Archipelago.RiskOfRain2), Subnautica
  (Berserker66/ArchipelagoSubnauticaModSrc), Hollow Knight (Archipelago.HollowKnight, uses the HK Modding API).

## Unity (IL2CPP)
`GameAssembly.dll` + `<Game>_Data/il2cpp_data`. Use **BepInEx 6 (IL2CPP)** bleeding-edge builds or
**MelonLoader**. Game types come through Il2CppInterop proxies (generated on first launch). Harmony still
works on most methods. The same MultiClient.Net library works. Examples: Muse Dash (DeamonHunter, MelonLoader),
PEAK, Content Warning.

## Unreal Engine 4/5
`<Game>/Content/Paks/*.pak`, `Binaries/Win64/<Game>-Win64-Shipping.exe`.
- **UE4SS** gives Lua hooks on UFunctions (`RegisterHook("/Script/Game.Chest:Open", ...)`) and a C++ mod API.
  Use Lua for game logic and either a C++ mod with a WebSocket client, or a local bridge: the Lua side writes
  events to a file / named pipe, a small external client (Python, CommonClient) talks to the server.
- Dump the SDK/object names with UE4SS's live view to find what to hook.
- Examples: the RE Engine games use REFramework (similar idea: Lua scripts in the game + a client).

## Godot
`*.pck` next to the exe (or embedded). Godot 3/4 games can load **Godot Mod Loader** packs; .NET Godot 4
games have **GDWeave**. GDScript can open a `WebSocketPeer` to the AP server directly (send JSON packets
yourself; see client.md for the packet list). Brotato's AP mod is a worked Godot Mod Loader example.

## GameMaker
`data.win`. Patch GML with **UndertaleModTool** scripts (C# scripts that edit code entries). GameMaker can't
easily open WebSockets: write events to a file or a local TCP socket and run a small Python client beside it.
Buckshot Roulette AP (asdfwyay/APBuckshot) does this.

## .NET games (XNA / FNA / MonoGame)
A managed exe with `Content/*.xnb`. Load the game in-process from a launcher (Assembly.Load + Harmony), like
SMAPI (Stardew), Everest (Celeste) or TsRandomizer (Timespinner). MultiClient.Net works directly.

## Source
`gameinfo.txt`, `*.vpk`. VScript (Squirrel) or SourceMod for logic, console commands (`exec`, `script`) to
drive it, and an external client for the network. Portal 2 AP: GlassToadstool/Portal2ArchipelagoMod.

## Anything else: an external memory client
Every game has memory. Write a Python client on top of Archipelago's `CommonClient` (or a standalone script
with `websockets`) that:
- attaches with `pymem` to the process, reads flags (chests opened, bosses dead) in a loop (~4 Hz),
- writes received items into inventory addresses,
- watches HP for deaths / writes 0 HP for Death Link.
Find addresses with Cheat Engine; use pointer scans so they survive restarts; pin the game version (Steam
beta branch or a depot note in the recipe). This is how BizHawk-era AP games and many PC ports work.

## Finding the hooks (what to patch)
For each location kind, find: the event (method called / memory flag set), how to stop the vanilla reward,
and a stable id (scene + object name, or a save-flag index). For each item kind: the function that gives it
in vanilla (call that rather than editing inventory by hand, so the game updates UI and save data).
Write the mapping in a table in `design.md`; it's what the id tables are generated from.
