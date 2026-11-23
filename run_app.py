"""Entry point of MyReadyAP.exe (a window app with no console, so errors go to a message box + a log)."""
import sys
import traceback


def _show_error(text: str):
    try:
        from app.paths import data_dir
        log = data_dir() / "error.log"
        log.write_text(text, encoding="utf-8")
        where = f"\n\nالتفاصيل في:\n{log}"
    except Exception:
        where = ""
    if sys.platform == "win32":
        import ctypes
        ctypes.windll.user32.MessageBoxW(None, "صار خطأ وما قدر البرنامج يشتغل." + where, "My Ready AP", 0x10)
    else:
        print(text, file=sys.stderr)


def _hide_console():
    """A console build (for PCs that refuse the windowed one) hides its black window right away."""
    if sys.platform == "win32" and getattr(sys, "frozen", False):
        import ctypes
        hwnd = ctypes.windll.kernel32.GetConsoleWindow()
        if hwnd:
            ctypes.windll.user32.ShowWindow(hwnd, 0)


if __name__ == "__main__":
    _hide_console()
    try:
        from app.server import main
        main()
    except Exception:
        _show_error(traceback.format_exc())
