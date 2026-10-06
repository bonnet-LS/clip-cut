@echo off
cd /d %~dp0

where python >nul 2>nul
if errorlevel 1 (
  echo Python이 설치되어 있지 않습니다. https://www.python.org 에서 설치 후 다시 실행해주세요.
  pause
  exit /b 1
)

if not exist venv (
  echo 최초 실행입니다. 필요한 프로그램을 설치합니다... ^(1~2분 정도 걸릴 수 있습니다^)
  python -m venv venv
)
venv\Scripts\pip install -q --disable-pip-version-check -r requirements.txt

start "" http://127.0.0.1:5050
echo ClipCut 서버를 시작합니다. 이 창을 닫으면 서버가 종료됩니다.
venv\Scripts\python app.py
pause
