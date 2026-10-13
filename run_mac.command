#!/bin/bash
cd "$(dirname "$0")"

if ! command -v python3 &> /dev/null; then
  echo "Python3가 설치되어 있지 않습니다. https://www.python.org 에서 설치 후 다시 실행해주세요."
  read -p "엔터를 누르면 종료합니다..."
  exit 1
fi

if [ ! -d venv ]; then
  echo "최초 실행입니다. 필요한 프로그램을 설치합니다... (1~2분 정도 걸릴 수 있습니다)"
  python3 -m venv venv
fi
./venv/bin/pip install -q --disable-pip-version-check -r requirements.txt

echo "ClipCut을 시작합니다. 잠시 후 브라우저가 열립니다. 이 창을 닫으면 종료됩니다."
./venv/bin/python app.py
