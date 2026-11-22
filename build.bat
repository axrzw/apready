@echo off
pip install pyinstaller
pyinstaller --onefile --name MyReadyAP --add-data "recipes;recipes" --add-data "ui;ui" run_app.py
echo Done: dist\MyReadyAP.exe
pause
