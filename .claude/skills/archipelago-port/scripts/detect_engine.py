"""Guess a game's engine from its install folder and say the usual way to mod it for Archipelago.

    python detect_engine.py "C:/Program Files (x86)/Steam/steamapps/common/<Game>"

Read-only: it only lists file names (and reads a few bytes of version files). Prints a short report.
"""
import sys
from pathlib import Path


def find(root: Path, pattern: str, limit: int = 3) -> list:
    out = []
    for p in root.rglob(pattern):
        out.append(p)
        if len(out) >= limit:
            break
    return out


def detect(root: Path) -> list:
    """[(engine, evidence, way_in)] most likely first."""
    hits = []
    managed = find(root, "Assembly-CSharp.dll")
    il2cpp = find(root, "GameAssembly.dll")
    if il2cpp:
        hits.append(("Unity IL2CPP", il2cpp[0], "BepInEx 6 IL2CPP (or MelonLoader) plugin; Il2CppInterop for game types; "
                     "Archipelago.MultiClient.Net. Check Thunderstore for a BepInExPack made for this game."))
    if managed:
        bep = (root / "BepInEx").exists() or (root / "winhttp.dll").exists()
        hits.append(("Unity Mono", managed[0], "BepInEx 5 plugin + Harmony patches + Archipelago.MultiClient.Net. "
                     "Decompile Assembly-CSharp.dll with ILSpy/dnSpy to find hooks." + (" (BepInEx already here.)" if bep else "")))
    paks = find(root, "*.pak")
    if paks or find(root, "*-Win64-Shipping.exe"):
        ver = "UE5" if find(root, "*.utoc") else "UE4"
        hits.append((f"Unreal ({ver})", (paks or find(root, '*-Win64-Shipping.exe'))[0],
                     "UE4SS (Lua mods for logic, C++ mod for a WebSocket client) or an external memory client. "
                     "Dump the SDK with UE4SS to find actor/function names."))
    pck = find(root, "*.pck")
    if pck:
        hits.append(("Godot", pck[0], "Godot Mod Loader (GDScript) or GDWeave (C#, Godot 4 .NET builds); "
                     "talk to the server over WebSocket from GDScript or through a C# client."))
    if find(root, "data.win"):
        hits.append(("GameMaker", find(root, "data.win")[0], "UndertaleModTool scripts that patch GML; a bridge "
                     "(file or local socket) to a small client. APBuckshot is a worked example."))
    if find(root, "Content/*.xnb") or find(root, "FNA.dll") or find(root, "MonoGame.Framework.dll") or find(root, "Microsoft.Xna.Framework.dll"):
        hits.append(("XNA / FNA / MonoGame (.NET)", (find(root, "FNA.dll") or find(root, "*.xnb"))[0],
                     "A .NET loader that starts the game in-process with Harmony (SMAPI, Everest, TsRandomizer style), "
                     "or MonoMod patches; MultiClient.Net for the connection."))
    if find(root, "gameinfo.txt") or find(root, "*.vpk"):
        hits.append(("Source", (find(root, "gameinfo.txt") or find(root, "*.vpk"))[0],
                     "VScript / SourceMod + console commands, or a memory client. Portal 2 AP and BO3 AP are examples."))
    if find(root, "*.rpa") or find(root, "renpy"):
        hits.append(("Ren'Py", find(root, "*.rpa")[0] if find(root, "*.rpa") else root, "Python scripts in game/: easy to mod directly."))
    if not hits:
        exes = find(root, "*.exe", 5)
        hits.append(("Unknown / native", exes[0] if exes else root,
                     "External Python client reading and writing memory (pymem), pinned to one game version. "
                     "Find addresses with Cheat Engine; prefer pointer paths that survive restarts."))
    return hits


def main(argv):
    if not argv:
        print(__doc__)
        return 2
    root = Path(argv[0])
    if not root.is_dir():
        print(f"not a folder: {root}")
        return 2
    for engine, evidence, way in detect(root):
        print(f"{engine}\n  evidence: {evidence}\n  way in:   {way}\n")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
