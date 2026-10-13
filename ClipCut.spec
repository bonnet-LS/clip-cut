# PyInstaller 빌드 설정 — build_mac.sh / build_windows.bat 에서 사용
import sys

from PyInstaller.utils.hooks import collect_data_files

APP_NAME = "ClipCut"
APP_VERSION = "2.0.0"
icon = "assets/icon.icns" if sys.platform == "darwin" else "assets/icon.ico"

a = Analysis(
    ["desktop.py"],
    datas=[("ui", "ui")] + collect_data_files("webview"),
    hiddenimports=[],
    excludes=["flask", "tkinter"],
)
pyz = PYZ(a.pure)

exe = EXE(
    pyz,
    a.scripts,
    [],
    exclude_binaries=True,
    name=APP_NAME,
    console=False,
    icon=icon,
    upx=False,
)

coll = COLLECT(exe, a.binaries, a.datas, name=APP_NAME, upx=False)

if sys.platform == "darwin":
    app = BUNDLE(
        coll,
        name=f"{APP_NAME}.app",
        icon=icon,
        bundle_identifier="kr.co.lush.clipcut",
        version=APP_VERSION,
        info_plist={
            "CFBundleDisplayName": APP_NAME,
            "CFBundleShortVersionString": APP_VERSION,
            "NSHighResolutionCapable": True,
            "LSMinimumSystemVersion": "11.0",
        },
    )
