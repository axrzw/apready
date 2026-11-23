"""A downloaded exe installs itself to a fixed place, puts shortcuts on the desktop, starts from there."""
from app import install, window


def _setup(tmp_path, monkeypatch):
    monkeypatch.setenv("LOCALAPPDATA", str(tmp_path / "local"))
    monkeypatch.setenv("APPDATA", str(tmp_path / "roaming"))
    made, started = [], []
    monkeypatch.setattr(window, "make_shortcuts", lambda exe: made.append(exe) or True)
    monkeypatch.setattr(install.subprocess, "Popen", lambda args, **kw: started.append((args, kw)))
    monkeypatch.setattr(install, "_quit_running_copy", lambda: None)
    dl = tmp_path / "Downloads" / "MyReadyAP.exe"
    dl.parent.mkdir()
    dl.write_bytes(b"MZ new")
    return dl, made, started


def test_downloaded_copy_installs_and_makes_shortcuts(tmp_path, monkeypatch):
    dl, made, started = _setup(tmp_path, monkeypatch)
    target = install.install_target()
    assert install.relocate(str(dl)) is True
    assert target.read_bytes() == b"MZ new"
    assert made == [str(target)]
    args, kw = started[0]
    assert args == [str(target)] and kw["env"]["PYINSTALLER_RESET_ENVIRONMENT"] == "1"
    # the installed copy runs normally and doesn't redo anything
    assert install.relocate(str(target)) is False
    assert install.ensure_shortcuts(str(target)) is False and made == [str(target)]


def test_newer_download_replaces_the_installed_copy(tmp_path, monkeypatch):
    dl, made, started = _setup(tmp_path, monkeypatch)
    target = install.install_target()
    target.parent.mkdir(parents=True)
    target.write_bytes(b"MZ old")
    assert install.relocate(str(dl)) is True
    assert target.read_bytes() == b"MZ new" and len(made) == 1  # shortcuts remade on every install


def test_cannot_install_runs_in_place(tmp_path, monkeypatch):
    dl, made, started = _setup(tmp_path, monkeypatch)

    def no_copy(*a, **k):
        raise OSError("disk full")
    monkeypatch.setattr(install.shutil, "copyfile", no_copy)
    assert install.relocate(str(dl)) is False and not started
    assert install.ensure_shortcuts(str(dl)) is True and made == [str(dl)]  # still gets a shortcut
