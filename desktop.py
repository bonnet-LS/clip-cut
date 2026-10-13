"""ClipCut 데스크톱 앱 (pywebview 창 + 로컬 파일을 직접 처리)."""
import json
import sys
from pathlib import Path

import webview

from core import ALLOWED_EXTENSIONS, FFMPEG
from runner import ClipRunner, describe_video, open_in_file_manager

APP_NAME = "ClipCut"
APP_VERSION = "2.0.0"


def resource_dir() -> Path:
    # PyInstaller로 묶인 경우 리소스는 임시 압축 해제 폴더(_MEIPASS)에 있다.
    return Path(getattr(sys, "_MEIPASS", Path(__file__).resolve().parent))


class Api:
    """JS에서 window.pywebview.api.<메서드>로 호출하는 함수들."""

    def __init__(self):
        self._window = None
        self._runner = ClipRunner(self._emit)

    def get_info(self):
        return {"ffmpeg_ready": FFMPEG is not None, "version": APP_VERSION}

    def pick_video(self):
        exts = ";".join(f"*{e}" for e in sorted(ALLOWED_EXTENSIONS))
        result = self._window.create_file_dialog(
            webview.FileDialog.OPEN, file_types=(f"영상 파일 ({exts})",),
        )
        return describe_video(result[0]) if result else None

    def describe_video(self, path):
        return describe_video(path)

    def pick_output_parent(self):
        result = self._window.create_file_dialog(webview.FileDialog.FOLDER)
        return str(result[0]) if result else None

    def open_folder(self, path):
        open_in_file_manager(Path(path))

    def start(self, job):
        return self._runner.start(job)

    def cancel(self):
        self._runner.cancel()

    def _emit(self, event, payload):
        self._window.evaluate_js(f"window.clipcut && window.clipcut.{event}({json.dumps(payload)})")


def bind_drop(window, api):
    """창에 영상 파일을 끌어다 놓으면 전체 경로를 받아 화면에 전달한다."""
    from webview.dom import DOMEventHandler

    window.events.loaded.wait()

    def on_drop(event):
        files = (event.get("dataTransfer") or {}).get("files") or []
        if not files:
            return
        path = files[0].get("pywebviewFullPath")
        if path:
            api._emit("onVideoSelected", api.describe_video(path))

    window.dom.document.events.dragover += DOMEventHandler(lambda e: None, True, True)
    window.dom.document.events.drop += DOMEventHandler(on_drop, True, True)


def main():
    api = Api()
    window = webview.create_window(
        APP_NAME,
        url=str(resource_dir() / "ui" / "index.html"),
        js_api=api,
        width=960,
        height=820,
        min_size=(640, 640),
        background_color="#F4F5F8",
    )
    api._window = window
    webview.start(bind_drop, (window, api))


if __name__ == "__main__":
    main()
