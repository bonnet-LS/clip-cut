const $ = (id) => document.getElementById(id);

const TIME_PATTERN = /^\d{1,2}(:\d{2}){0,2}(\.\d+)?$|^\d+(\.\d+)?$/;
const SEG_COLORS = ["--c1", "--c2", "--c3", "--c4", "--c5", "--c6"];
const LAST_STEP = 4;

const state = {
  step: 1,
  video: null,          // { path, name, size, duration, duration_text, output_parent }
  outputParent: null,
  outputDir: null,
  running: false,
  fatal: null,
  outputCustom: false,  // 저장 위치를 직접 골랐는지          // 계속 표시해야 하는 오류 (ffmpeg 없음 등)
};

let api = null;

// ---------- 유틸 ----------
function parseTime(value) {
  if (!TIME_PATTERN.test(value)) return null;
  return value.split(":").reduce((acc, part) => acc * 60 + parseFloat(part), 0);
}

function formatTime(seconds) {
  const s = Math.max(0, seconds);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  const secText = Number.isInteger(sec) ? String(sec).padStart(2, "0") : sec.toFixed(1).padStart(4, "0");
  return h ? `${h}:${String(m).padStart(2, "0")}:${secText}` : `${m}:${secText}`;
}

function formatSize(bytes) {
  if (bytes >= 1024 ** 3) return `${(bytes / 1024 ** 3).toFixed(2)} GB`;
  return `${(bytes / 1024 ** 2).toFixed(1)} MB`;
}

function icon(name) {
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  const use = document.createElementNS("http://www.w3.org/2000/svg", "use");
  use.setAttribute("href", `#i-${name}`);
  svg.appendChild(use);
  return svg;
}

function radioValue(name) {
  return document.querySelector(`input[name="${name}"]:checked`).value;
}

function showBanner(message) {
  const text = message || state.fatal || "";
  $("bannerText").textContent = text;
  $("banner").hidden = !text;
}

// ---------- 단계 이동 ----------
function goTo(step) {
  state.step = step;
  showBanner("");
  document.querySelectorAll(".panel").forEach((p) => { p.hidden = Number(p.dataset.panel) !== step; });
  document.querySelectorAll("#stepper li").forEach((li) => {
    const n = Number(li.dataset.step);
    li.classList.toggle("active", n === step);
    li.classList.toggle("done", n < step && stepComplete(n));
    li.classList.toggle("clickable", n !== step && n < LAST_STEP && step < LAST_STEP);
  });
  $("navbar").hidden = step === LAST_STEP;
  $("backBtn").classList.toggle("invisible", step === 1);
  $("nextBtn").textContent = step === 3 ? "자르기 시작" : "다음 →";
  updateNav();
  window.scrollTo(0, 0);
  if (step === 2) {
    const first = document.querySelector(".segment .start");
    if (first && !first.value) first.focus();
  }
}

// 상단 단계 표시에서 '완료'로 칠할지 판단한다.
function stepComplete(n) {
  if (n === 1) return !!state.video;
  if (n === 2) return !validateSegments();
  return true;
}

// 단계 이동은 자유롭게 하고, 자르기를 시작할 수 없는 이유만 반환한다.
function startError() {
  if (!state.video) return "1단계에서 영상을 선택해야 시작할 수 있어요.";
  const segError = validateSegments();
  if (segError) return `2단계를 확인해 주세요 · ${segError}`;
  return null;
}

function updateNav() {
  const hint = $("navHint");
  hint.classList.remove("error");
  let blocked = false;

  if (state.step === 1) {
    hint.textContent = state.video ? `${state.video.name} 선택됨` : "영상은 나중에 선택해도 돼요";
  } else if (state.step === 2) {
    const segError = validateSegments();
    const { count, total, visibleError } = segmentStats();
    if (visibleError) {
      hint.textContent = visibleError;
      hint.classList.add("error");
    } else {
      hint.textContent = segError ? "시작·끝 시간을 입력해 주세요" : `구간 ${count}개 · 총 ${formatTime(total)}`;
    }
  } else if (state.step === 3) {
    const error = startError();
    blocked = !!error;
    if (error) {
      hint.textContent = error;
      hint.classList.add("error");
    } else {
      hint.textContent = `클립 ${segmentStats().count}개가 만들어집니다`;
    }
  }
  $("nextBtn").disabled = blocked;
}

function next() {
  if (state.running) return;
  if (state.step === 3) {
    if (!startError()) start();
  }
  else goTo(state.step + 1);
}

function back() {
  if (state.step > 1 && state.step < LAST_STEP) goTo(state.step - 1);
}

// ---------- STEP 1: 영상 ----------
function setVideo(info) {
  if (!info) return;
  if (info.error) {
    showBanner(info.error);
    return;
  }
  showBanner("");
  state.video = info;
  // 사용자가 저장 위치를 직접 고르지 않았다면 영상과 같은 폴더로 맞춘다.
  if (!state.outputCustom) state.outputParent = info.output_parent;
  $("dropzone").hidden = true;
  $("fileCard").hidden = false;
  $("fileName").textContent = info.name;
  $("fileDuration").textContent = info.duration_text ? `길이 ${info.duration_text}` : "";
  $("fileSize").textContent = formatSize(info.size);
  setOutputPath(state.outputParent);
  validateSegments();
  updateNav();
}

async function pickVideo() {
  if (!api || state.running) return;
  setVideo(await api.pick_video());
}

// ---------- STEP 2: 구간 ----------
function addRow(values = {}) {
  const node = $("rowTemplate").content.firstElementChild.cloneNode(true);
  node.querySelector(".start").value = values.start || "";
  node.querySelector(".end").value = values.end || "";
  node.querySelector(".label").value = values.label || "";
  node.querySelector(".remove").addEventListener("click", () => {
    node.remove();
    if (!$("segments").children.length) addRow();
    refreshSegments();
  });
  node.querySelectorAll("input").forEach((input) => input.addEventListener("input", refreshSegments));
  $("segments").appendChild(node);
  refreshSegments();
  return node;
}

function readRows() {
  return [...document.querySelectorAll(".segment")].map((row) => ({
    row,
    start: row.querySelector(".start").value.trim(),
    end: row.querySelector(".end").value.trim(),
    label: row.querySelector(".label").value.trim(),
  }));
}

let lastStats = { count: 0, total: 0, visibleError: null };
function segmentStats() { return lastStats; }

// 각 구간을 검사해 화면에 표시하고, 첫 번째 오류 메시지를 반환한다.
function validateSegments() {
  const rows = readRows();
  const duration = state.video && state.video.duration;
  let firstError = null;
  let visibleError = null;
  let total = 0;
  const blocks = [];

  rows.forEach((r, i) => {
    const n = i + 1;
    const color = `var(${SEG_COLORS[i % SEG_COLORS.length]})`;
    r.row.style.setProperty("--seg-color", color);
    r.row.querySelector(".seg-badge").textContent = n;

    const startEl = r.row.querySelector(".start");
    const endEl = r.row.querySelector(".end");
    const start = parseTime(r.start);
    const end = parseTime(r.end);
    const filled = !!r.start && !!r.end;
    let error = null;
    let shown = null;

    startEl.classList.toggle("error", !!r.start && start === null);
    endEl.classList.toggle("error", !!r.end && end === null);

    if (!filled) {
      error = `${n}번 구간의 시작·끝 시간을 입력해 주세요.`;
    } else if (start === null || end === null) {
      error = shown = "시간 형식이 올바르지 않아요. 예: 1:23 또는 83.5";
    } else if (end <= start) {
      error = shown = "끝 시간이 시작 시간보다 늦어야 해요.";
      endEl.classList.add("error");
    } else if (duration && start >= duration) {
      error = shown = `시작 시간이 영상 길이(${formatTime(duration)})를 넘어요.`;
      startEl.classList.add("error");
    }

    r.row.classList.toggle("invalid", !!shown);
    r.row.querySelector(".seg-error").textContent = shown || "";
    r.row.querySelector(".seg-len").textContent =
      start !== null && end !== null && end > start ? formatTime(end - start) : "–";

    if (error) {
      firstError = firstError || error;
      if (shown) visibleError = visibleError || `${n}번 구간: ${shown}`;
    } else {
      total += end - start;
    }
    if (start !== null && end !== null && end > start) blocks.push({ n, start, end, color });
  });

  lastStats = { count: rows.length, total, visibleError };
  renderTimeline(blocks, duration);
  return firstError;
}

function renderTimeline(blocks, duration) {
  const timeline = $("timeline");
  timeline.replaceChildren();
  const span = duration || Math.max(60, ...blocks.map((b) => b.end));
  $("timelineTotal").textContent = duration ? `길이 ${formatTime(duration)}` : "";
  $("timelineEnd").textContent = formatTime(span);
  blocks.forEach((b) => {
    const el = document.createElement("div");
    el.className = "timeline-block";
    el.style.setProperty("--seg-color", b.color);
    el.style.left = `${Math.min(100, (b.start / span) * 100)}%`;
    el.style.width = `${Math.max(0, (Math.min(b.end, span) - b.start) / span) * 100}%`;
    el.textContent = b.n;
    el.title = `${b.n}번 구간 ${formatTime(b.start)} ~ ${formatTime(b.end)}`;
    timeline.appendChild(el);
  });
}

function refreshSegments() {
  validateSegments();
  updateNav();
}

// ---------- STEP 3: 출력 설정 ----------
function updateReencodeNotice() {
  const reencode = radioValue("crop") !== "original" || radioValue("res") !== "original";
  $("reencodeNotice").hidden = !(reencode && radioValue("mode") === "fast");
}

function setOutputPath(folder) {
  if (!folder) {
    $("outputPath").textContent = "원본 영상과 같은 폴더";
    $("outputSub").textContent = "영상을 선택하면 자동으로 정해지고, 다른 폴더로 바꿀 수도 있어요";
    return;
  }
  $("outputPath").textContent = `‎${folder}‎`;
  $("outputPath").title = folder;
  const stem = state.video ? state.video.name.replace(/\.[^.]+$/, "") : "영상이름";
  $("outputSub").textContent = `이 폴더 안에 ‘${stem}_clips’ 폴더를 만들어 저장합니다`;
}

async function pickOutput() {
  if (!api || state.running) return;
  const folder = await api.pick_output_parent();
  if (folder) {
    state.outputParent = folder;
    state.outputCustom = true;
    setOutputPath(folder);
  }
}

// ---------- STEP 4: 실행 ----------
async function start() {
  const job = {
    path: state.video.path,
    output_parent: state.outputParent,
    mode: radioValue("mode"),
    crop_ratio: radioValue("crop"),
    resolution: radioValue("res"),
    segments: readRows().map(({ start, end, label }) => ({ start, end, label })),
  };

  $("nextBtn").disabled = true;
  const res = await api.start(job);
  if (res.error) {
    showBanner(res.error);
    updateNav();
    return;
  }
  state.outputDir = res.output_dir;
  state.running = true;
  $("runView").hidden = false;
  $("doneView").hidden = true;
  $("cancelBtn").disabled = false;
  setProgress(0, "준비 중…");
  goTo(4);
}

function setProgress(fraction, label) {
  const pct = Math.round(fraction * 100);
  $("ring").style.setProperty("--p", pct);
  $("progressPct").textContent = `${pct}%`;
  if (label) $("progressLabel").textContent = label;
}

function resultItem(text, ok) {
  const li = document.createElement("li");
  if (!ok) li.className = "fail";
  li.appendChild(icon(ok ? "check" : "alert"));
  const span = document.createElement("span");
  span.textContent = text;
  li.appendChild(span);
  return li;
}

window.clipcut = {
  onVideoSelected(info) {
    if (state.running || state.step === LAST_STEP) return;
    setVideo(info);
    if (state.step !== 1) goTo(1);
  },
  onProgress({ index, count, overall }) {
    setProgress(overall, `${count}개 구간 중 ${index}번째를 자르고 있어요`);
  },
  onDone({ cancelled, produced, errors, output_dir }) {
    state.running = false;
    state.outputDir = output_dir;
    $("runView").hidden = true;
    $("doneView").hidden = false;

    const badge = $("resultBadge");
    badge.className = "result-badge";
    badge.replaceChildren(icon("check"));

    if (cancelled) {
      badge.classList.add("neutral");
      badge.replaceChildren(icon("x"));
      $("doneTitle").textContent = "취소했어요";
      $("doneText").textContent = produced.length ? `취소 전까지 ${produced.length}개 클립이 저장되었습니다.` : "저장된 클립이 없습니다.";
    } else if (!produced.length) {
      badge.classList.add("error");
      badge.replaceChildren(icon("alert"));
      $("doneTitle").textContent = "자르지 못했어요";
      $("doneText").textContent = "아래 내용을 확인한 뒤 다시 시도해 주세요.";
    } else if (errors.length) {
      badge.classList.add("error");
      badge.replaceChildren(icon("alert"));
      $("doneTitle").textContent = `${produced.length}개 완료, ${errors.length}개 실패`;
      $("doneText").textContent = "실패한 구간은 폴더 안 errors.txt에도 기록되어 있습니다.";
    } else {
      $("doneTitle").textContent = `클립 ${produced.length}개를 만들었어요`;
      $("doneText").textContent = "저장된 폴더를 열어 확인해 보세요.";
    }

    const list = $("resultList");
    list.replaceChildren(...produced.map((name) => resultItem(name, true)), ...errors.map((e) => resultItem(e, false)));
    $("openFolderBtn").hidden = !produced.length && !errors.length;
  },
};

// ---------- 이벤트 ----------
$("dropzone").addEventListener("click", pickVideo);
$("changeVideo").addEventListener("click", pickVideo);
$("addRow").addEventListener("click", () => addRow().querySelector(".start").focus());
$("changeOutput").addEventListener("click", pickOutput);
$("nextBtn").addEventListener("click", next);
$("backBtn").addEventListener("click", back);
$("cancelBtn").addEventListener("click", () => {
  $("cancelBtn").disabled = true;
  $("progressLabel").textContent = "취소하는 중…";
  api.cancel();
});
$("openFolderBtn").addEventListener("click", () => api.open_folder(state.outputDir));
$("sameVideoBtn").addEventListener("click", () => goTo(2));
$("newJobBtn").addEventListener("click", () => {
  state.video = null;
  $("dropzone").hidden = false;
  $("fileCard").hidden = true;
  $("segments").replaceChildren();
  addRow();
  goTo(1);
});

document.querySelectorAll("#stepper li").forEach((li) => {
  li.addEventListener("click", () => {
    if (li.classList.contains("clickable")) goTo(Number(li.dataset.step));
  });
});

document.querySelectorAll('input[name="mode"], input[name="crop"], input[name="res"]').forEach((el) => {
  el.addEventListener("change", updateReencodeNotice);
});

// 구간 입력 중 Enter: 마지막 구간이면 새 구간 추가
$("segments").addEventListener("keydown", (e) => {
  if (e.key !== "Enter" || e.isComposing) return;
  const row = e.target.closest(".segment");
  if (row && row === $("segments").lastElementChild) {
    e.preventDefault();
    addRow().querySelector(".start").focus();
  }
});

// 창 위로 파일을 끌어올 때 표시 (실제 경로는 앱(Python)이 받아 onVideoSelected로 전달)
let dragDepth = 0;
const dropTarget = () => (state.video ? $("fileCard") : $("dropzone"));
document.addEventListener("dragenter", (e) => { e.preventDefault(); dragDepth += 1; dropTarget().classList.add("dragover"); });
document.addEventListener("dragleave", () => { dragDepth -= 1; if (dragDepth <= 0) { dragDepth = 0; dropTarget().classList.remove("dragover"); } });
document.addEventListener("dragover", (e) => e.preventDefault());
document.addEventListener("drop", (e) => { e.preventDefault(); dragDepth = 0; dropTarget().classList.remove("dragover"); });

// ---------- 시작 ----------
addRow();
updateReencodeNotice();
setOutputPath(null);
goTo(1);

async function init() {
  api = window.pywebview.api;
  const info = await api.get_info();
  $("version").textContent = `v${info.version}`;
  if (!info.ffmpeg_ready) {
    state.fatal = "영상 처리 도구(ffmpeg)를 불러오지 못했습니다. 앱을 다시 설치해 주세요.";
    showBanner();
  }
}

if (window.pywebview && window.pywebview.api) init();
else window.addEventListener("pywebviewready", init);
