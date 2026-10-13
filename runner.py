"""영상 자르기 작업 실행기 (데스크톱 앱 desktop.py와 로컬 서버 app.py가 함께 사용).

진행 상황은 생성 시 넘겨받은 emit(event, payload) 함수로 알린다.
  - "onProgress": {"index", "count", "overall"}
  - "onDone": {"cancelled", "produced", "errors", "output_dir"}
"""
import os
import subprocess
import sys
import threading
import time
from pathlib import Path

from core import (
    ALLOWED_EXTENSIONS, CROP_RATIOS, FFMPEG, RESOLUTION_TIERS,
    build_vf_filter, cut_segment, format_time, last_error_line, parse_time,
    probe_duration, sanitize_label, validate_segments,
)


def unique_dir(path: Path) -> Path:
    if not path.exists():
        return path
    n = 2
    while (candidate := path.with_name(f"{path.name}_{n}")).exists():
        n += 1
    return candidate


def open_in_file_manager(path: Path):
    if sys.platform == "darwin":
        subprocess.Popen(["open", str(path)])
    elif sys.platform == "win32":
        os.startfile(str(path))
    else:
        subprocess.Popen(["xdg-open", str(path)])


def describe_video(path) -> dict:
    p = Path(path)
    if p.suffix.lower() not in ALLOWED_EXTENSIONS:
        return {"error": f"지원하지 않는 파일 형식입니다: {p.suffix or p.name}"}
    if not p.is_file():
        return {"error": "파일을 찾을 수 없습니다."}
    duration = probe_duration(p)
    return {
        "path": str(p),
        "name": p.name,
        "size": p.stat().st_size,
        "duration": duration,
        "duration_text": format_time(duration) if duration is not None else None,
        "output_parent": str(p.parent),
    }


class ClipRunner:
    def __init__(self, emit):
        self._emit = emit
        self._cancel = threading.Event()
        self._running = False
        self.output_dirs = set()  # 이번 실행 중 만든 출력 폴더 (폴더 열기 허용 목록)

    @property
    def running(self):
        return self._running

    def start(self, job: dict) -> dict:
        if self._running:
            return {"error": "이미 처리 중입니다."}
        if FFMPEG is None:
            return {"error": "영상 처리 도구(ffmpeg)를 불러오지 못했습니다. 프로그램을 다시 설치해 주세요."}

        input_path = Path(job.get("path") or "")
        if not input_path.is_file():
            return {"error": "영상 파일을 다시 선택해 주세요."}
        if job.get("crop_ratio") not in CROP_RATIOS or job.get("resolution") not in RESOLUTION_TIERS:
            return {"error": "출력 설정이 올바르지 않습니다."}

        segments = job.get("segments") or []
        error = validate_segments(segments, probe_duration(input_path))
        if error:
            return {"error": error}

        output_parent = Path(job.get("output_parent") or input_path.parent)
        if not output_parent.is_dir():
            return {"error": "저장 위치 폴더를 찾을 수 없습니다."}
        output_dir = unique_dir(output_parent / f"{sanitize_label(input_path.stem, 'video')}_clips")
        self.output_dirs.add(str(output_dir))

        self._cancel.clear()
        self._running = True
        threading.Thread(
            target=self._run, args=(job, input_path, segments, output_dir), daemon=True,
        ).start()
        return {"output_dir": str(output_dir)}

    def cancel(self):
        self._cancel.set()

    def _run(self, job, input_path, segments, output_dir):
        try:
            output_dir.mkdir(parents=True, exist_ok=True)
            accurate = job.get("mode") == "accurate"
            vf_filter = build_vf_filter(job["crop_ratio"], job["resolution"])

            lengths = [parse_time(s["end"]) - parse_time(s["start"]) for s in segments]
            total = sum(lengths) or 1.0
            done_before = 0.0
            errors, produced = [], []
            last_emit = 0.0

            for idx, seg in enumerate(segments, start=1):
                if self._cancel.is_set():
                    break
                label = sanitize_label(seg.get("label"), f"clip_{idx}")
                out_path = output_dir / f"{idx:02d}_{label}.mp4"

                def on_progress(fraction, idx=idx, base=done_before, length=lengths[idx - 1]):
                    nonlocal last_emit
                    now = time.monotonic()
                    if now - last_emit < 0.15:
                        return
                    last_emit = now
                    self._emit("onProgress", {
                        "index": idx, "count": len(segments),
                        "overall": (base + length * fraction) / total,
                    })

                self._emit("onProgress", {"index": idx, "count": len(segments), "overall": done_before / total})
                ok, stderr = cut_segment(
                    input_path, seg["start"], seg["end"], out_path, accurate, vf_filter,
                    on_progress=on_progress, should_cancel=self._cancel.is_set,
                )
                if ok:
                    produced.append(out_path.name)
                elif not self._cancel.is_set():
                    errors.append(f"{idx}번 구간 ({seg['start']} ~ {seg['end']}): {last_error_line(stderr)}")
                done_before += lengths[idx - 1]

            if errors:
                (output_dir / "errors.txt").write_text("\n".join(errors), encoding="utf-8")
            if not produced and not errors:
                # 취소되어 만들어진 파일이 없으면 빈 폴더를 남기지 않는다.
                try:
                    output_dir.rmdir()
                except OSError:
                    pass

            self._emit("onDone", {
                "cancelled": self._cancel.is_set(),
                "produced": produced,
                "errors": errors,
                "output_dir": str(output_dir),
            })
        except Exception as exc:  # 예상치 못한 오류도 화면에 알린다.
            self._emit("onDone", {"cancelled": False, "produced": [], "errors": [str(exc)], "output_dir": str(output_dir)})
        finally:
            self._running = False
