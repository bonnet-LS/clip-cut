import json
import re
import shutil
import subprocess
import uuid
import zipfile
from pathlib import Path

from flask import Flask, render_template, request, send_file, jsonify

BASE_DIR = Path(__file__).resolve().parent
UPLOAD_DIR = BASE_DIR / "uploads"
OUTPUT_DIR = BASE_DIR / "outputs"
UPLOAD_DIR.mkdir(exist_ok=True)
OUTPUT_DIR.mkdir(exist_ok=True)

ALLOWED_EXTENSIONS = {".mp4", ".mov", ".mkv", ".avi", ".m4v", ".webm"}
TIME_PATTERN = re.compile(r"^\d{1,2}(:\d{2}){0,2}(\.\d+)?$|^\d+(\.\d+)?$")

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

app = Flask(__name__)
app.config["MAX_CONTENT_LENGTH"] = 5 * 1024 * 1024 * 1024  # 5GB


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


def cut_segment(input_path: Path, start: str, end: str, out_path: Path, accurate: bool, vf_filter: str = None):
    needs_reencode = accurate or vf_filter is not None
    if needs_reencode:
        cmd = [
            FFMPEG, "-y",
            "-i", str(input_path),
            "-ss", start, "-to", end,
        ]
        if vf_filter:
            cmd += ["-vf", vf_filter]
        cmd += [
            "-c:v", "libx264", "-preset", "veryfast", "-crf", "18",
            "-c:a", "aac", "-b:a", "192k",
            str(out_path),
        ]
    else:
        cmd = [
            FFMPEG, "-y",
            "-ss", start, "-to", end,
            "-i", str(input_path),
            "-c", "copy",
            str(out_path),
        ]
    result = subprocess.run(cmd, capture_output=True, text=True)
    return result.returncode == 0, result.stderr


@app.route("/")
def index():
    return render_template(
        "index.html",
        ffmpeg_ready=FFMPEG is not None,
    )


@app.route("/process", methods=["POST"])
def process():
    if FFMPEG is None:
        return jsonify({"error": "영상 처리 도구(ffmpeg)를 불러오지 못했습니다. 프로그램 폴더의 venv 폴더를 삭제한 뒤 다시 실행해 주세요."}), 500

    video = request.files.get("video")
    segments_raw = request.form.get("segments")
    accurate = request.form.get("mode") == "accurate"
    crop_ratio = request.form.get("crop_ratio", "original")
    resolution = request.form.get("resolution", "original")

    if crop_ratio not in CROP_RATIOS:
        return jsonify({"error": f"지원하지 않는 크롭 비율입니다: {crop_ratio}"}), 400
    if resolution not in RESOLUTION_TIERS:
        return jsonify({"error": f"지원하지 않는 해상도입니다: {resolution}"}), 400

    if not video or not video.filename:
        return jsonify({"error": "영상 파일을 선택해 주세요."}), 400

    ext = Path(video.filename).suffix.lower()
    if ext not in ALLOWED_EXTENSIONS:
        return jsonify({"error": f"지원하지 않는 파일 형식입니다: {ext}"}), 400

    try:
        segments = json.loads(segments_raw)
    except (TypeError, json.JSONDecodeError):
        return jsonify({"error": "구간 정보가 올바르지 않습니다."}), 400

    if not segments:
        return jsonify({"error": "자를 구간을 1개 이상 입력해 주세요."}), 400

    for seg in segments:
        start, end = seg.get("start", ""), seg.get("end", "")
        if not TIME_PATTERN.match(start) or not TIME_PATTERN.match(end):
            return jsonify({"error": f"시간 형식이 올바르지 않습니다: '{start}' ~ '{end}' (예: 1:23 또는 83.5)"}), 400

    job_id = uuid.uuid4().hex[:12]
    job_upload_dir = UPLOAD_DIR / job_id
    job_output_dir = OUTPUT_DIR / job_id
    job_upload_dir.mkdir(parents=True, exist_ok=True)
    job_output_dir.mkdir(parents=True, exist_ok=True)

    input_path = job_upload_dir / f"source{ext}"
    video.save(input_path)

    vf_filter = build_vf_filter(crop_ratio, resolution)

    errors = []
    produced = []
    for idx, seg in enumerate(segments, start=1):
        label = sanitize_label(seg.get("label"), f"clip_{idx}")
        out_path = job_output_dir / f"{idx:02d}_{label}.mp4"
        ok, stderr = cut_segment(input_path, seg["start"], seg["end"], out_path, accurate, vf_filter)
        if ok and out_path.exists():
            produced.append(out_path)
        else:
            errors.append(f"[{idx}] {seg['start']}~{seg['end']} 실패: {stderr.strip().splitlines()[-1] if stderr else '알 수 없는 오류'}")

    shutil.rmtree(job_upload_dir, ignore_errors=True)

    if not produced:
        shutil.rmtree(job_output_dir, ignore_errors=True)
        return jsonify({"error": "모든 구간 처리에 실패했습니다.", "details": errors}), 500

    zip_path = OUTPUT_DIR / f"{job_id}.zip"
    with zipfile.ZipFile(zip_path, "w", zipfile.ZIP_DEFLATED) as zf:
        for clip in produced:
            zf.write(clip, arcname=clip.name)
        if errors:
            zf.writestr("errors.txt", "\n".join(errors))

    shutil.rmtree(job_output_dir, ignore_errors=True)

    return send_file(zip_path, as_attachment=True, download_name="clips.zip")


if __name__ == "__main__":
    app.run(host="127.0.0.1", port=5050, debug=False)
