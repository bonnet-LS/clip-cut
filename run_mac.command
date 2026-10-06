#!/bin/bash
cd "$(dirname "$0")"

if ! command -v python3 &> /dev/null; then
  echo "Python3가 설치되어 있지 않습니다. https://www.python.org 에서 설치 후 다시 실행해주세요."
  read -p "엔터를 누르면 종료합니다..."
  exit 1
fi

if ! command -v ffmpeg &> /dev/null; then
  echo "⚠ ffmpeg가 설치되어 있지 않습니다. 터미널에서 'brew install ffmpeg' 로 설치해주세요."
fi

if [ ! -d venv ]; then
  echo "최초 실행입니다. 필요한 패키지를 설치합니다..."
  python3 -m venv venv
  ./venv/bin/pip install -q -r requirements.txt
fi

(sleep 1.5 && open http://127.0.0.1:5050) &
echo "ClipCut 서버를 시작합니다. 이 창을 닫으면 서버가 종료됩니다."
./venv/bin/python app.py
