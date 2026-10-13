#!/bin/bash
# ClipCut.app 빌드 → dist/ClipCut.app, dist/ClipCut-mac.zip
set -e
cd "$(dirname "$0")"

if [ ! -d venv ]; then
  python3 -m venv venv
fi
./venv/bin/pip install -q --disable-pip-version-check -r requirements-app.txt

./venv/bin/python scripts/make_icon.py
./venv/bin/pyinstaller --noconfirm --clean ClipCut.spec

# 배포용 zip (ditto는 앱 번들의 권한·심볼릭 링크를 그대로 보존한다)
rm -f dist/ClipCut-mac.zip
ditto -c -k --keepParent dist/ClipCut.app dist/ClipCut-mac.zip

echo ""
echo "완료: dist/ClipCut.app, dist/ClipCut-mac.zip"
