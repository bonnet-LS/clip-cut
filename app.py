"""ClipCut 로컬 실행 버전.

이 PC에서 작은 서버를 띄우고 브라우저로 http://127.0.0.1:5050 화면을 연다.
영상은 이 PC의 ffmpeg로 처리하므로 4K 원본 화질 그대로 정확하게 자를 수 있다.
화면은 데스크톱 앱·웹 버전과 같은 ui/ 폴더를 사용한다.
"""
import base64
import secrets
import shutil
import socket
import subprocess
import sys
import threading
import uuid
import webbrowser
from pathlib import Path
from urllib.parse import unquote

from flask import Flask, abort, jsonify, request, send_from_directory

from core import ALLOWED_EXTENSIONS, FFMPEG, sanitize_label
from runner import ClipRunner, describe_video, open_in_file_manager

APP_VERSION = "2.0.0-local"
BASE_DIR = Path(__file__).resolve().parent
UI_DIR = BASE_DIR / "ui"
UPLOAD_DIR = BASE_DIR / "uploads"
DEFAULT_PORT = 5050
CHUNK = 8 * 1024 * 1024

# 다른 웹사이트가 이 로컬 서버를 몰래 호출하지 못하도록, 실행할 때마다 새 토큰을 만들어
# 이 서버가 내려준 화면만 API를 쓸 수 있게 한다.
TOKEN = secrets.token_urlsafe(32)
ALLOWED_HOSTS = set()

app = Flask(__name__)

state_lock = threading.Lock()
state = {"seq": 0, "events": []}


def emit(event, payload):
    with state_lock:
        state["seq"] += 1
        state["events"].append({"seq": state["seq"], "event": event, "payload": payload})
        del state["events"][:-50]


runner = ClipRunner(emit)


# ---------- 보안 ----------
@app.before_request
def guard():
    # DNS 리바인딩 방지: 127.0.0.1 / localhost 로 들어온 요청만 받는다.
    if request.host not in ALLOWED_HOSTS:
        abort(403)
    if request.path.startswith("/api/") and request.headers.get("X-ClipCut-Token") != TOKEN:
        abort(403)


@app.after_request
def headers(resp):
    resp.headers["X-Content-Type-Options"] = "nosniff"
    resp.headers["Referrer-Policy"] = "no-referrer"
    resp.headers["X-Frame-Options"] = "DENY"
    resp.headers["Cache-Control"] = "no-store"
    return resp


# ---------- 파일 선택 창 (운영체제 기본 대화상자) ----------
VIDEO_TYPES = ";".join(f"*{e}" for e in sorted(ALLOWED_EXTENSIONS))


def _run_powershell(script: str):
    encoded = base64.b64encode(script.encode("utf-16-le")).decode()
    result = subprocess.run(
        ["powershell", "-NoProfile", "-STA", "-EncodedCommand", encoded],
        capture_output=True, creationflags=subprocess.CREATE_NO_WINDOW,
    )
    return result.stdout.decode("utf-8", errors="replace").strip()


def native_dialog(kind: str):
    """kind='file' | 'folder'. 선택한 경로, 취소하면 "", 이 운영체제에서 지원하지 않으면 None."""
    if sys.platform == "darwin":
        if kind == "file":
            script = ['-e', 'POSIX path of (choose file with prompt "자를 영상을 선택하세요" of type {"public.movie"})']
        else:
            script = ['-e', 'POSIX path of (choose folder with prompt "클립을 저장할 폴더를 선택하세요")']
        result = subprocess.run(["osascript", *script], capture_output=True, text=True)
        return result.stdout.strip().rstrip("/") if result.returncode == 0 else ""
    if sys.platform == "win32":
        prelude = (
            "Add-Type -AssemblyName System.Windows.Forms;"
            "[Console]::OutputEncoding=[Text.Encoding]::UTF8;"
            "$owner=New-Object System.Windows.Forms.Form -Property @{TopMost=$true};"
        )
        if kind == "file":
            body = (
                "$d=New-Object System.Windows.Forms.OpenFileDialog;"
                f"$d.Filter='영상 파일|{VIDEO_TYPES}';"
                "if($d.ShowDialog($owner) -eq 'OK'){$d.FileName}"
            )
        else:
            body = (
                "$d=New-Object System.Windows.Forms.FolderBrowserDialog;"
                "$d.Description='클립을 저장할 폴더를 선택하세요';"
                "if($d.ShowDialog($owner) -eq 'OK'){$d.SelectedPath}"
            )
        return _run_powershell(prelude + body)
    if shutil.which("zenity"):
        args = ["zenity", "--file-selection"] + (["--directory"] if kind == "folder" else [])
        result = subprocess.run(args, capture_output=True, text=True)
        return result.stdout.strip() if result.returncode == 0 else ""
    return None


def downloads_dir() -> str:
    d = Path.home() / "Downloads"
    return str(d if d.is_dir() else Path.home())


def clear_uploads():
    shutil.rmtree(UPLOAD_DIR, ignore_errors=True)


# ---------- 화면 ----------
@app.route("/")
def index():
    html = (UI_DIR / "index.html").read_text(encoding="utf-8")
    html = html.replace(
        '<script src="app.js"></script>',
        f'<meta name="clipcut-token" content="{TOKEN}">\n'
        '  <script src="app.js"></script>\n  <script src="local.js"></script>',
    )
    return html


@app.route("/local.js")
def local_js():
    return send_from_directory(BASE_DIR / "static", "local.js")


@app.route("/<path:name>")
def ui_files(name):
    return send_from_directory(UI_DIR, name)


# ---------- API ----------
@app.get("/api/info")
def api_info():
    return jsonify({"ffmpeg_ready": FFMPEG is not None, "version": APP_VERSION})


@app.post("/api/pick_video")
def api_pick_video():
    path = native_dialog("file")
    if path is None:
        return jsonify({"unsupported": True})
    if not path:
        return jsonify(None)
    clear_uploads()
    return jsonify(describe_video(path))


@app.post("/api/upload")
def api_upload():
    """끌어다 놓은 파일은 경로를 알 수 없어서 이 PC 안에서 임시 폴더로 복사해 처리한다."""
    name = unquote(request.headers.get("X-Filename", ""))
    ext = Path(name).suffix.lower()
    if ext not in ALLOWED_EXTENSIONS:
        return jsonify({"error": f"지원하지 않는 파일 형식입니다: {ext or name}"})
    clear_uploads()
    target_dir = UPLOAD_DIR / uuid.uuid4().hex[:12]
    target_dir.mkdir(parents=True)
    target = target_dir / f"{sanitize_label(Path(name).stem, 'video')}{ext}"
    with open(target, "wb") as f:
        while chunk := request.stream.read(CHUNK):
            f.write(chunk)
    info = describe_video(target)
    if not info.get("error"):
        info["output_parent"] = downloads_dir()
    return jsonify(info)


@app.post("/api/pick_output")
def api_pick_output():
    path = native_dialog("folder")
    return jsonify(path or None)


@app.post("/api/open_folder")
def api_open_folder():
    path = (request.get_json(silent=True) or {}).get("path", "")
    # 이번 실행에서 만든 출력 폴더만 열 수 있다.
    if path in runner.output_dirs and Path(path).is_dir():
        open_in_file_manager(Path(path))
    return jsonify(True)


@app.post("/api/start")
def api_start():
    job = request.get_json(silent=True) or {}
    return jsonify(runner.start(job))


@app.post("/api/cancel")
def api_cancel():
    runner.cancel()
    return jsonify(True)


@app.get("/api/events")
def api_events():
    since = request.args.get("since", type=int, default=0)
    with state_lock:
        events = [e for e in state["events"] if e["seq"] > since]
        seq = state["seq"]
    return jsonify({"seq": seq, "events": events})


# ---------- 실행 ----------
def find_port(start: int) -> int:
    for port in range(start, start + 20):
        with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
            if s.connect_ex(("127.0.0.1", port)) != 0:
                return port
    raise SystemExit("사용할 수 있는 포트를 찾지 못했습니다.")


def main():
    port = find_port(DEFAULT_PORT)
    ALLOWED_HOSTS.update({f"127.0.0.1:{port}", f"localhost:{port}"})
    url = f"http://127.0.0.1:{port}"
    print(f"ClipCut 실행 중: {url}  (이 창을 닫으면 종료됩니다)")
    if "--no-browser" not in sys.argv:
        threading.Timer(1.0, lambda: webbrowser.open(url)).start()
    try:
        app.run(host="127.0.0.1", port=port, debug=False, threaded=True)
    finally:
        clear_uploads()


if __name__ == "__main__":
    main()
