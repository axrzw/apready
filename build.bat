@echo off
pip install pyinstaller
pyinstaller --onefile --name APReady --add-data "recipes;recipes" --add-data "ui;ui" run_app.py
echo Done: dist\APReady.exe
pause
