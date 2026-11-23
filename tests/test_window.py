"""The app window: finding Edge/Chrome, one copy at a time, quitting when the window closes."""
import json
import threading
import urllib.request
from http.server import ThreadingHTTPServer

from app import server, window


def test_finds_edge_before_chrome(tmp_path, monkeypatch):
    for rel in ["x86/Microsoft/Edge/Application/msedge.exe", "pf/Google/Chrome/Application/chrome.exe"]:
        (tmp_path / rel).parent.mkdir(parents=True)
        (tmp_path / rel).write_text("")
    monkeypatch.setenv("ProgramFiles(x86)", str(tmp_path / "x86"))
    monkeypatch.setenv("ProgramFiles", str(tmp_path / "pf"))
    monkeypatch.delenv("LOCALAPPDATA", raising=False)
    assert window.find_browser().endswith("msedge.exe")
    monkeypatch.setenv("ProgramFiles(x86)", str(tmp_path / "none"))
    assert window.find_browser().endswith("chrome.exe")


def test_app_mode_args_use_own_profile(tmp_path, monkeypatch):
    monkeypatch.setenv("APPDATA", str(tmp_path))
    args = window.browser_args("msedge.exe", "http://127.0.0.1:5/")
    assert "--app=http://127.0.0.1:5/" in args
    assert any(a.startswith("--user-data-dir=") and "APReady" in a for a in args)


class FakeProc:
    """A window process that ends at a given time on the fake clock."""
    def __init__(self, clock, ends_at):
        self.clock, self.ends_at = clock, ends_at

    def poll(self):
        return 0 if self.clock[0] >= self.ends_at else None


def _fake_clock(monkeypatch):
    clock = [1000.0]
    monkeypatch.setattr(window.time, "time", lambda: clock[0])
    monkeypatch.setattr(window.time, "sleep", lambda n: clock.__setitem__(0, clock[0] + n))
    window._last_ping[0] = 0.0
    return clock


def test_quits_when_the_window_closes(monkeypatch):
    clock = _fake_clock(monkeypatch)
    stopped = []
    window.wait_until_closed(FakeProc(clock, 1000 + 3600), lambda: stopped.append(clock[0]))
    assert stopped and stopped[0] - 1000 < 3600 + 10


def test_handed_off_window_falls_back_to_pings(monkeypatch):
    clock = _fake_clock(monkeypatch)
    window.ping()  # the page was open
    stopped = []
    window.wait_until_closed(FakeProc(clock, 1000), lambda: stopped.append(clock[0]))
    assert stopped and stopped[0] - 1000 > window.HEARTBEAT_TIMEOUT


def test_browser_left_running_in_background_still_quits(monkeypatch):
    """Window closed but the browser process stays alive: the missing pings end it."""
    clock = _fake_clock(monkeypatch)
    window.ping()
    stopped = []
    window.wait_until_closed(FakeProc(clock, float("inf")), lambda: stopped.append(clock[0]))
    assert stopped and window.WINDOW_OPEN_TIMEOUT < stopped[0] - 1000 < window.WINDOW_OPEN_TIMEOUT + 10


def test_second_copy_finds_the_first(tmp_path, monkeypatch):
    monkeypatch.setenv("APPDATA", str(tmp_path))
    srv = ThreadingHTTPServer(("127.0.0.1", 0), server.Handler)
    threading.Thread(target=srv.serve_forever, daemon=True).start()
    url = f"http://127.0.0.1:{srv.server_address[1]}/"
    assert window.already_running() is None
    window.mark_running(url)
    assert window.already_running() == url
    srv.shutdown()
    srv.server_close()
    assert window.already_running() is None  # stale file from a crash: start normally
    window.clear_running()


def test_open_only_takes_web_and_steam_links(monkeypatch):
    opened = []
    monkeypatch.setattr(server.webbrowser, "open", opened.append)
    srv = ThreadingHTTPServer(("127.0.0.1", 0), server.Handler)
    threading.Thread(target=srv.serve_forever, daemon=True).start()
    base = f"http://127.0.0.1:{srv.server_address[1]}"

    def post(url):
        req = urllib.request.Request(base + "/api/link", json.dumps({"url": url}).encode(), {"Content-Type": "application/json"})
        try:
            return urllib.request.urlopen(req).status
        except urllib.error.HTTPError as e:
            return e.code
    assert post("https://archipelago.gg/uploads") == 200
    assert post("file:///C:/Windows/System32/calc.exe") == 400
    assert opened == ["https://archipelago.gg/uploads"]
    srv.shutdown()


def test_open_folder_button_still_works(tmp_path, monkeypatch):
    """/api/open opens the players / my YAML folders (the link endpoint must not take its place)."""
    monkeypatch.setenv("APPDATA", str(tmp_path))
    opened = []
    monkeypatch.setattr(server.subprocess, "Popen", lambda args, **kw: opened.append(args))
    monkeypatch.setattr(server.sys, "platform", "linux")
    srv = ThreadingHTTPServer(("127.0.0.1", 0), server.Handler)
    threading.Thread(target=srv.serve_forever, daemon=True).start()
    req = urllib.request.Request(f"http://127.0.0.1:{srv.server_address[1]}/api/open", json.dumps({"what": "players"}).encode(),
                                 {"Content-Type": "application/json"})
    assert urllib.request.urlopen(req).status == 200
    assert opened and opened[0][-1].endswith("players")
    srv.shutdown()


def test_waking_from_sleep_does_not_quit(monkeypatch):
    """The PC slept for an hour with the window open: no quitting before the page can ping again."""
    clock = _fake_clock(monkeypatch)
    window.ping()
    stopped, slept = [], [False]

    def sleep(n):
        if not slept[0] and clock[0] > 1100:
            slept[0] = True
            clock[0] += 3600  # one long sleep
            return
        clock[0] += n
        if slept[0] and clock[0] > 1000 + 3600 + 200 and stopped == []:
            window.ping()  # the page pings again after waking
            raise SystemExit
    monkeypatch.setattr(window.time, "sleep", sleep)
    try:
        window.wait_until_closed(FakeProc(clock, float("inf")), lambda: stopped.append(clock[0]))
    except SystemExit:
        pass
    assert stopped == []


def test_unexpected_error_answers_instead_of_dropping(tmp_path, monkeypatch):
    monkeypatch.setenv("APPDATA", str(tmp_path))

    def boom(*a, **k):
        raise FileNotFoundError("no file manager")
    monkeypatch.setattr(server.subprocess, "Popen", boom)
    monkeypatch.setattr(server.sys, "platform", "linux")
    srv = ThreadingHTTPServer(("127.0.0.1", 0), server.Handler)
    threading.Thread(target=srv.serve_forever, daemon=True).start()
    req = urllib.request.Request(f"http://127.0.0.1:{srv.server_address[1]}/api/open", json.dumps({"what": "players"}).encode(),
                                 {"Content-Type": "application/json"})
    try:
        urllib.request.urlopen(req)
        code, body = 200, {}
    except urllib.error.HTTPError as e:
        code, body = e.code, json.loads(e.read())
    assert code == 500 and "no file manager" in body["error"]
    srv.shutdown()


def test_state_and_ping_carry_the_version(tmp_path, monkeypatch):
    monkeypatch.setenv("APPDATA", str(tmp_path))
    monkeypatch.setattr(server, "VERSION", "v9.9.9")
    srv = ThreadingHTTPServer(("127.0.0.1", 0), server.Handler)
    threading.Thread(target=srv.serve_forever, daemon=True).start()
    base = f"http://127.0.0.1:{srv.server_address[1]}"
    assert json.loads(urllib.request.urlopen(base + "/api/state").read())["version"] == "v9.9.9"
    assert json.loads(urllib.request.urlopen(base + "/api/ping").read())["version"] == "v9.9.9"
    srv.shutdown()
