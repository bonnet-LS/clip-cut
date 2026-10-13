// ClipCut 웹 버전 엔진.
// 데스크톱 앱(pywebview)과 같은 API(window.pywebview.api)를 브라우저 안의 ffmpeg.wasm으로 구현해
// ui/app.js 화면을 그대로 재사용한다. 영상은 서버로 전송되지 않고 이 브라우저 안에서만 처리된다.
import { FFmpeg } from "./vendor/ffmpeg/index.js";
import { zipSync } from "./vendor/fflate.js";

const VERSION = "2.0.0-web";
const ALLOWED = [".mp4", ".mov", ".mkv", ".avi", ".m4v", ".webm"];
const CROP = { "1:1": [1, 1], "9:16": [9, 16], "4:5": [4, 5], "16:9": [16, 9] };
const RES = { high: 1920, medium: 1280, low: 854 };
const MOUNT_DIR = "/input";
// 브라우저(wasm)에서는 4K 재인코딩이 메모리 한계로 멈춘다. 새로 인코딩할 때 긴 변을 이 크기 이하로 줄인다.
const WEB_MAX_SIDE = 1920;
// 멀티스레드 코어에서 스레드를 자동(코어 수만큼)으로 두면 스레드 풀이 바닥나 멈춘다. 고정 개수로 제한한다.
const THREADS = "4";

let ffmpeg = null;
let loading = null;
let currentFile = null;
let cancelled = false;
let lastResult = null;

// ---------- ffmpeg 준비 ----------
function coreUrls() {
  // 멀티스레드 코어는 SharedArrayBuffer(교차 출처 격리)가 있어야 동작한다.
  const mt = self.crossOriginIsolated;
  const base = new URL(mt ? "./vendor/core-mt/" : "./vendor/core/", import.meta.url).href;
  const urls = { coreURL: `${base}ffmpeg-core.js`, wasmURL: `${base}ffmpeg-core.wasm` };
  if (mt) urls.workerURL = `${base}ffmpeg-core.worker.js`;
  return urls;
}

function ensureFFmpeg() {
  if (ffmpeg && ffmpeg.loaded) return Promise.resolve(ffmpeg);
  if (!loading) {
    const instance = new FFmpeg();
    loading = instance.load(coreUrls()).then(() => {
      ffmpeg = instance;
      ffmpeg.on("log", ({ message }) => logListeners.forEach((fn) => fn(message)));
      return ffmpeg;
    }).finally(() => { loading = null; });
  }
  return loading;
}

const logListeners = new Set();

async function withLogs(onLine, task) {
  logListeners.add(onLine);
  try { return await task(); } finally { logListeners.delete(onLine); }
}

async function mountInput(file) {
  const ff = await ensureFFmpeg();
  // WORKERFS: 파일 전체를 메모리에 올리지 않고 필요한 부분만 읽는다 (대용량 영상 대응).
  try { await ff.unmount(MOUNT_DIR); } catch { /* 처음에는 마운트된 것이 없다 */ }
  try { await ff.createDir(MOUNT_DIR); } catch { /* 이미 있음 */ }
  await ff.mount("WORKERFS", { files: [file] }, MOUNT_DIR);
  return `${MOUNT_DIR}/${file.name}`;
}

// ---------- 유틸 ----------
const TIME_PATTERN = /^\d{1,2}(:\d{2}){0,2}(\.\d+)?$|^\d+(\.\d+)?$/;
const parseTime = (v) => v.split(":").reduce((acc, p) => acc * 60 + parseFloat(p), 0);

function formatTime(seconds) {
  const s = Math.max(0, Math.floor(seconds));
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), sec = s % 60;
  return h ? `${h}:${String(m).padStart(2, "0")}:${String(sec).padStart(2, "0")}` : `${m}:${String(sec).padStart(2, "0")}`;
}

function sanitizeLabel(label, fallback) {
  const cleaned = (label || "").trim().replace(/[^\w\-가-힣]+/g, "_").replace(/^_+|_+$/g, "");
  return cleaned || fallback;
}

function buildFilter(crop, resolution) {
  const parts = [];
  const limit = Math.min(RES[resolution] || WEB_MAX_SIDE, WEB_MAX_SIDE);
  if (CROP[crop]) {
    const [rw, rh] = CROP[crop];
    parts.push(`crop='trunc(min(iw,ih*${rw}/${rh})/2)*2':'trunc(min(ih,iw*${rh}/${rw})/2)*2'`);
  }
  // 지정한 화질(또는 웹 최대 크기)보다 클 때만 줄인다. 작은 영상은 키우지 않는다.
  parts.push(`scale='if(gte(iw,ih),min(${limit},iw),-2)':'if(gte(iw,ih),-2,min(${limit},ih))'`);
  return parts.join(",");
}

function emit(event, payload) {
  if (window.clipcut && window.clipcut[event]) window.clipcut[event](payload);
}

function download(blob, name) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

// ---------- 영상 정보 ----------
async function describe(file) {
  const ext = file.name.slice(file.name.lastIndexOf(".")).toLowerCase();
  if (!ALLOWED.includes(ext)) return { error: `지원하지 않는 파일 형식입니다: ${ext}` };
  currentFile = file;

  let duration = null;
  try {
    const input = await mountInput(file);
    let log = "";
    await withLogs((line) => { log += line + "\n"; }, () => ffmpeg.exec(["-hide_banner", "-i", input]));
    const m = log.match(/Duration:\s*(\d+):(\d+):(\d+(?:\.\d+)?)/);
    if (m) duration = +m[1] * 3600 + +m[2] * 60 + parseFloat(m[3]);
  } catch (err) {
    console.error(err);
  }
  return {
    path: file.name,
    name: file.name,
    size: file.size,
    duration,
    duration_text: duration != null ? formatTime(duration) : null,
    output_parent: "다운로드 폴더",
  };
}

function pickFile() {
  return new Promise((resolve) => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = ALLOWED.join(",") + ",video/*";
    input.addEventListener("change", () => resolve(input.files[0] || null), { once: true });
    input.addEventListener("cancel", () => resolve(null), { once: true });
    input.click();
  });
}

// ---------- 자르기 ----------
function cutArgs(input, seg, out, accurate, vf) {
  const start = String(parseTime(seg.start));
  const length = String(parseTime(seg.end) - parseTime(seg.start));
  if (!accurate) {
    return ["-hide_banner", "-ss", start, "-i", input, "-t", length, "-c", "copy", "-avoid_negative_ts", "make_zero", out];
  }
  // 입력 앞 -ss: 해당 위치로 바로 이동한 뒤 정확히 디코딩한다 (처음부터 디코딩하지 않아 빠름).
  const args = ["-hide_banner", "-threads", THREADS, "-ss", start, "-i", input, "-t", length, "-vf", vf];
  args.push(
    "-c:v", "libx264", "-threads", THREADS, "-preset", "veryfast", "-crf", "20", "-pix_fmt", "yuv420p",
    "-c:a", "aac", "-b:a", "192k", "-movflags", "+faststart", out,
  );
  return args;
}

async function run(job) {
  // 크롭·화질 변경은 새로 인코딩해야 하므로 '정확하게'로 처리한다.
  const accurate = job.mode === "accurate" || job.crop_ratio !== "original" || job.resolution !== "original";
  const vf = buildFilter(job.crop_ratio, job.resolution);
  const lengths = job.segments.map((s) => parseTime(s.end) - parseTime(s.start));
  const total = lengths.reduce((a, b) => a + b, 0) || 1;
  const files = {};
  const produced = [];
  const errors = [];
  let doneBefore = 0;

  try {
    const input = await mountInput(currentFile);
    for (let i = 0; i < job.segments.length; i += 1) {
      if (cancelled) break;
      const seg = job.segments[i];
      const idx = i + 1;
      const name = `${String(idx).padStart(2, "0")}_${sanitizeLabel(seg.label, `clip_${idx}`)}.mp4`;
      const out = `/out_${idx}.mp4`;
      const base = doneBefore;
      let tail = [];
      emit("onProgress", { index: idx, count: job.segments.length, overall: base / total });

      const onLine = (line) => {
        tail.push(line);
        if (tail.length > 30) tail = tail.slice(-15);
        const m = line.match(/time=(\d+):(\d+):(\d+(?:\.\d+)?)/);
        if (m) {
          const t = +m[1] * 3600 + +m[2] * 60 + parseFloat(m[3]);
          emit("onProgress", { index: idx, count: job.segments.length, overall: (base + Math.min(t, lengths[i])) / total });
        }
      };

      const code = await withLogs(onLine, () => ffmpeg.exec(cutArgs(input, seg, out, accurate, vf)));
      if (cancelled) break;

      if (code === 0) {
        const data = await ffmpeg.readFile(out);
        await ffmpeg.deleteFile(out);
        files[name] = data;
        produced.push(name);
      } else {
        const last = tail.filter((l) => l.trim()).pop() || "알 수 없는 오류";
        errors.push(`${idx}번 구간 (${seg.start} ~ ${seg.end}): ${last}`);
        try { await ffmpeg.deleteFile(out); } catch { /* 출력이 없을 수 있음 */ }
      }
      doneBefore += lengths[i];
    }
  } catch (err) {
    if (!cancelled) errors.push(String(err && err.message ? err.message : err));
  }

  if (errors.length) files["errors.txt"] = new TextEncoder().encode(errors.join("\n"));
  lastResult = buildResult(files, job);
  if (lastResult) download(lastResult.blob, lastResult.name);

  emit("onDone", { cancelled, produced, errors, output_dir: lastResult ? lastResult.name : "" });
}

function buildResult(files, job) {
  const names = Object.keys(files);
  if (!names.length) return null;
  const clipNames = names.filter((n) => n.endsWith(".mp4"));
  if (names.length === 1 && clipNames.length === 1) {
    return { blob: new Blob([files[clipNames[0]]], { type: "video/mp4" }), name: clipNames[0] };
  }
  const stem = sanitizeLabel(currentFile.name.replace(/\.[^.]+$/, ""), "video");
  // 영상은 이미 압축되어 있으므로 zip은 압축 없이 묶기만 한다.
  const zipped = zipSync(files, { level: 0 });
  return { blob: new Blob([zipped], { type: "application/zip" }), name: `${stem}_clips.zip` };
}

// ---------- 화면(app.js)이 사용하는 API ----------
const api = {
  async get_info() {
    try {
      await ensureFFmpeg();
      return { ffmpeg_ready: true, version: VERSION };
    } catch (err) {
      console.error(err);
      return { ffmpeg_ready: false, version: VERSION };
    }
  },
  async pick_video() {
    const file = await pickFile();
    return file ? describe(file) : null;
  },
  async pick_output_parent() { return null; },
  async start(job) {
    if (!currentFile) return { error: "영상 파일을 다시 선택해 주세요." };
    cancelled = false;
    run(job);
    return { output_dir: "" };
  },
  cancel() {
    cancelled = true;
    // 실행 중인 ffmpeg를 즉시 멈추려면 워커를 종료해야 한다. 다음 작업 때 다시 불러온다.
    if (ffmpeg) {
      ffmpeg.terminate();
      ffmpeg = null;
    }
  },
  open_folder() {
    if (lastResult) download(lastResult.blob, lastResult.name);
  },
};

// ---------- 웹 전용 화면 조정 ----------
function adaptUi() {
  const set = (sel, text) => { const el = document.querySelector(sel); if (el) el.textContent = text; };
  set(".dropzone-sub", "또는 영상 파일을 이 창으로 끌어다 놓으세요 · 영상은 서버로 전송되지 않아요");
  set('[data-panel="1"] .panel-head p', "컷편집할 원본 영상을 선택하세요. 영상은 업로드되지 않고 이 브라우저 안에서만 처리됩니다.");
  set('input[name="res"][value="original"] + span', "원본 (최대 1920)");
  const accurateDesc = document.querySelector('input[name="mode"][value="accurate"] + .choice-body .choice-desc');
  if (accurateDesc) accurateDesc.textContent = "입력한 시간 그대로 정밀하게 자릅니다. 웹에서는 최대 Full HD(1920)로 저장되고, 클립 길이의 2배 정도 시간이 걸려요.";
  const fastDesc = document.querySelector('input[name="mode"][value="fast"] + .choice-body .choice-desc');
  if (fastDesc) fastDesc.textContent = "원본 그대로(4K 포함) 몇 초 만에 잘라요. 시작·끝이 1초 정도 어긋날 수 있어요.";
  const change = document.getElementById("changeOutput");
  if (change) change.hidden = true;
  const openBtn = document.getElementById("openFolderBtn");
  if (openBtn) openBtn.lastChild.textContent = "다시 다운로드";

  // 출력 폴더 문구를 브라우저 다운로드 기준으로 바꾼다.
  const path = document.getElementById("outputPath");
  const sub = document.getElementById("outputSub");
  new MutationObserver(() => {
    if (path.textContent !== "다운로드 폴더") path.textContent = "다운로드 폴더";
    const msg = "클립이 여러 개면 zip 파일 하나로 받아요";
    if (sub.textContent !== msg) sub.textContent = msg;
  }).observe(path, { childList: true, characterData: true, subtree: true });
  path.textContent = "다운로드 폴더";

  // 완료 문구 조정
  const doneText = document.getElementById("doneText");
  new MutationObserver(() => {
    const t = doneText.textContent;
    if (t.includes("폴더를 열어")) doneText.textContent = "다운로드 폴더에 저장되었어요.";
    else if (t.includes("errors.txt")) doneText.textContent = "실패한 구간은 받은 파일 안 errors.txt에도 기록되어 있습니다.";
  }).observe(doneText, { childList: true, characterData: true, subtree: true });

  // 파일 끌어다 놓기
  document.addEventListener("drop", async (e) => {
    const file = e.dataTransfer && e.dataTransfer.files[0];
    if (file) emit("onVideoSelected", await describe(file));
  });
}

window.pywebview = { api };
adaptUi();
window.dispatchEvent(new Event("pywebviewready"));
