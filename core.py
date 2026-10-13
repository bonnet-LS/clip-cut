"""ClipCut 영상 처리 로직 (웹 서버 app.py와 데스크톱 앱 desktop.py가 함께 사용)."""
import re
import shutil
import subprocess
import sys
import threading
from pathlib import Path

ALLOWED_EXTENSIONS = {".mp4", ".mov", ".mkv", ".avi", ".m4v", ".webm"}
TIME_PATTERN = re.compile(r"^\d{1,2}(:\d{2}){0,2}(\.\d+)?$|^\d+(\.\d+)?$")
DURATION_PATTERN = re.compile(r"Duration:\s*(\d+):(\d+):(\d+(?:\.\d+)?)")

CROP_RATIOS = {
    "original": None,
    "1:1": (1, 1),
    "9:16": (9, 16),
    "4:5": (4, 5),
    "16:9": (16, 9),
}
RESOLUTION_TIERS = {
    "original": None,
    "high": 1920,
    "medium": 1280,
    "low": 854,
}

# Windows에서 ffmpeg 실행 시 콘솔 창이 뜨지 않도록 한다.
_NO_WINDOW = {"creationflags": subprocess.CREATE_NO_WINDOW} if sys.platform == "win32" else {}


def sanitize_label(label: str, fallback: str) -> str:
    label = (label or "").strip()
    if not label:
        return fallback
    label = re.sub(r"[^\w\-가-힣]+", "_", label, flags=re.UNICODE).strip("_")
    return label or fallback


def find_ffmpeg():
    """PC에 설치된 ffmpeg를 우선 사용하고, 없으면 imageio-ffmpeg 패키지에 포함된 ffmpeg를 사용한다."""
    system_ffmpeg = shutil.which("ffmpeg")
    if system_ffmpeg:
        return system_ffmpeg
    try:
        import imageio_ffmpeg
        return imageio_ffmpeg.get_ffmpeg_exe()
    except Exception:
        return None


FFMPEG = find_ffmpeg()


def parse_time(value: str) -> float:
    """'1:23', '83.5', '01:02:03' 형식을 초 단위로 변환한다."""
    seconds = 0.0
    for part in value.split(":"):
        seconds = seconds * 60 + float(part)
    return seconds


def format_time(seconds: float) -> str:
    seconds = max(0.0, seconds)
    h, rem = divmod(int(seconds), 3600)
    m, s = divmod(rem, 60)
    return f"{h}:{m:02d}:{s:02d}" if h else f"{m}:{s:02d}"


def probe_duration(input_path: Path):
    """영상 길이(초)를 반환한다. 알 수 없으면 None."""
    if FFMPEG is None:
        return None
    result = subprocess.run(
        [FFMPEG, "-hide_banner", "-i", str(input_path)],
        capture_output=True, text=True, errors="replace", **_NO_WINDOW,
    )
    match = DURATION_PATTERN.search(result.stderr)
    if not match:
        return None
    h, m, s = match.groups()
    return int(h) * 3600 + int(m) * 60 + float(s)


def validate_segments(segments, duration=None):
    """구간 목록을 검사해 첫 번째 오류 메시지를 반환한다. 문제가 없으면 None."""
    if not segments:
        return "자를 구간을 1개 이상 입력해 주세요."
    for idx, seg in enumerate(segments, start=1):
        start, end = seg.get("start", ""), seg.get("end", "")
        if not TIME_PATTERN.match(start) or not TIME_PATTERN.match(end):
            return f"{idx}번 구간의 시간 형식이 올바르지 않습니다: '{start}' ~ '{end}' (예: 1:23 또는 83.5)"
        if parse_time(end) <= parse_time(start):
            return f"{idx}번 구간의 종료 시간이 시작 시간보다 빠르거나 같습니다: {start} ~ {end}"
        if duration is not None and parse_time(start) >= duration:
            return f"{idx}번 구간의 시작 시간({start})이 영상 길이({format_time(duration)})를 넘습니다."
    return None


def build_vf_filter(crop_ratio: str, resolution: str):
    parts = []
    crop = CROP_RATIOS.get(crop_ratio)
    if crop:
        rw, rh = crop
        parts.append(
            f"crop='trunc(min(iw,ih*{rw}/{rh})/2)*2':'trunc(min(ih,iw*{rh}/{rw})/2)*2'"
        )
    long_side = RESOLUTION_TIERS.get(resolution)
    if long_side:
        parts.append(
            f"scale='if(gte(iw,ih),{long_side},-2)':'if(gte(iw,ih),-2,{long_side})'"
        )
    return ",".join(parts) if parts else None


def build_cut_command(input_path: Path, start: str, end: str, out_path: Path, accurate: bool, vf_filter: str = None):
    needs_reencode = accurate or vf_filter is not None
    if needs_reencode:
        # 입력 앞 -ss: 시작 위치로 바로 이동한 뒤 정확히 디코딩한다.
        # (출력 쪽 -ss는 영상 처음부터 디코딩해서, 긴 영상 뒷부분을 자를 때 매우 느리다)
        duration = f"{parse_time(end) - parse_time(start):.3f}"
        cmd = [FFMPEG, "-y", "-ss", start, "-i", str(input_path), "-t", duration]
        if vf_filter:
            cmd += ["-vf", vf_filter]
        cmd += [
            # 아이폰 HDR(10비트) 원본도 어디서나 재생되도록 8비트(yuv420p)로 저장한다.
            "-c:v", "libx264", "-preset", "veryfast", "-crf", "18", "-pix_fmt", "yuv420p",
            "-movflags", "+faststart",
            "-c:a", "aac", "-b:a", "192k",
        ]
    else:
        cmd = [FFMPEG, "-y", "-ss", start, "-to", end, "-i", str(input_path), "-c", "copy"]
    return cmd + [str(out_path)]


def cut_segment(input_path: Path, start: str, end: str, out_path: Path, accurate: bool,
                vf_filter: str = None, on_progress=None, should_cancel=None):
    """구간 하나를 잘라 저장한다.

    on_progress(fraction)이 주어지면 0~1 사이 진행률을 수시로 알려준다.
    should_cancel()이 True를 반환하면 ffmpeg를 중단하고 (False, "취소됨")을 반환한다.
    """
    cmd = build_cut_command(input_path, start, end, out_path, accurate, vf_filter)
    cmd[1:1] = ["-hide_banner", "-nostats", "-progress", "pipe:1"]
    total = parse_time(end) - parse_time(start)

    proc = subprocess.Popen(
        cmd, stdout=subprocess.PIPE, stderr=subprocess.PIPE,
        text=True, errors="replace", **_NO_WINDOW,
    )
    # stderr를 읽지 않으면 버퍼가 차서 ffmpeg가 멈출 수 있으므로 별도 스레드에서 비워준다.
    stderr_lines = []

    def drain_stderr():
        for line in proc.stderr:
            stderr_lines.append(line)
            if len(stderr_lines) > 200:
                del stderr_lines[:100]

    drain = threading.Thread(target=drain_stderr, daemon=True)
    drain.start()

    for line in proc.stdout:
        if should_cancel and should_cancel():
            proc.kill()
            proc.wait()
            out_path.unlink(missing_ok=True)
            return False, "취소됨"
        key, _, value = line.strip().partition("=")
        if key == "out_time_us" and on_progress and total > 0 and value.isdigit():
            on_progress(min(1.0, int(value) / 1_000_000 / total))

    proc.wait()
    drain.join(timeout=2)
    stderr = "".join(stderr_lines)
    return proc.returncode == 0 and out_path.exists(), stderr


def last_error_line(stderr: str) -> str:
    lines = [line for line in (stderr or "").strip().splitlines() if line.strip()]
    return lines[-1] if lines else "알 수 없는 오류"
