@echo off
rem ClipCut.exe 빌드 → dist\ClipCut\ClipCut.exe, dist\ClipCut-windows.zip
chcp 65001 >nul
cd /d %~dp0

if not exist venv (
  python -m venv venv
)
venv\Scripts\pip install -q --disable-pip-version-check -r requirements-app.txt || exit /b 1

venv\Scripts\python scripts\make_icon.py || exit /b 1
venv\Scripts\pyinstaller --noconfirm --clean ClipCut.spec || exit /b 1

powershell -NoProfile -Command "Compress-Archive -Force -Path dist\ClipCut -DestinationPath dist\ClipCut-windows.zip"

echo.
echo 완료: dist\ClipCut\ClipCut.exe, dist\ClipCut-windows.zip
