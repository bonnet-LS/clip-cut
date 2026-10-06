const segmentsEl = document.getElementById("segments");
const rowTemplate = document.getElementById("rowTemplate");
const form = document.getElementById("cutForm");
const statusEl = document.getElementById("status");
const submitBtn = document.getElementById("submitBtn");

const dropzone = document.getElementById("dropzone");
const videoFileInput = document.getElementById("videoFile");
const dropzoneText = document.getElementById("dropzoneText");
const dropzoneDefaultText = dropzoneText.textContent;

function updateDropzoneLabel() {
  const file = videoFileInput.files[0];
  dropzone.classList.toggle("has-file", !!file);
  dropzoneText.textContent = file
    ? `📄 ${file.name} (${(file.size / (1024 * 1024)).toFixed(1)}MB)`
    : dropzoneDefaultText;
}

videoFileInput.addEventListener("change", updateDropzoneLabel);

["dragenter", "dragover"].forEach((evt) => {
  dropzone.addEventListener(evt, (e) => {
    e.preventDefault();
    dropzone.classList.add("dragover");
  });
});
["dragleave", "drop"].forEach((evt) => {
  dropzone.addEventListener(evt, (e) => {
    e.preventDefault();
    dropzone.classList.remove("dragover");
  });
});
dropzone.addEventListener("drop", (e) => {
  const file = e.dataTransfer.files[0];
  if (file) {
    videoFileInput.files = e.dataTransfer.files;
    updateDropzoneLabel();
  }
});

const ffmpegBanner = document.getElementById("ffmpegBanner");
const ffmpegPanel = document.getElementById("ffmpegPanel");
const autoInstallBtn = document.getElementById("autoInstallBtn");
const recheckBtn = document.getElementById("recheckBtn");
const installLog = document.getElementById("installLog");

function setFfmpegReady(ready) {
  ffmpegBanner.classList.toggle("success", ready);
  ffmpegBanner.classList.toggle("error", !ready);
  ffmpegBanner.textContent = ready
    ? "✅ 이 PC에 ffmpeg가 설치되어 있습니다."
    : "⚠ 이 PC에 ffmpeg가 설치되어 있지 않습니다. 먼저 ffmpeg를 설치한 뒤 사용해 주세요.";
}

async function checkFfmpegStatus() {
  try {
    const res = await fetch("/ffmpeg/status");
    const data = await res.json();
    setFfmpegReady(!!data.installed);
    return !!data.installed;
  } catch {
    return false;
  }
}

function pollInstallJob(jobId) {
  const timer = setInterval(async () => {
    try {
      const res = await fetch(`/ffmpeg/install/${jobId}`);
      if (!res.ok) throw new Error("설치 상태를 확인할 수 없습니다.");
      const job = await res.json();
      installLog.hidden = false;
      installLog.textContent = job.log || "설치 준비 중...";
      installLog.scrollTop = installLog.scrollHeight;

      if (job.done) {
        clearInterval(timer);
        autoInstallBtn.disabled = false;
        if (job.success) {
          await checkFfmpegStatus();
        }
      }
    } catch (err) {
      clearInterval(timer);
      autoInstallBtn.disabled = false;
      installLog.hidden = false;
      installLog.textContent += `\n${err.message}`;
    }
  }, 1500);
}

autoInstallBtn.addEventListener("click", async () => {
  autoInstallBtn.disabled = true;
  installLog.hidden = false;
  installLog.textContent = "설치를 시작합니다...";

  try {
    const res = await fetch("/ffmpeg/install", { method: "POST" });
    const data = await res.json();

    if (!res.ok) {
      installLog.textContent = "오류: " + (data.error || "설치를 시작할 수 없습니다.");
      autoInstallBtn.disabled = false;
      return;
    }
    if (data.already_installed) {
      installLog.textContent = "이미 ffmpeg가 설치되어 있습니다.";
      await checkFfmpegStatus();
      autoInstallBtn.disabled = false;
      return;
    }
    pollInstallJob(data.job_id);
  } catch (err) {
    installLog.textContent = "요청 중 오류: " + err.message;
    autoInstallBtn.disabled = false;
  }
});

recheckBtn.addEventListener("click", async () => {
  recheckBtn.disabled = true;
  recheckBtn.textContent = "확인 중...";
  const ready = await checkFfmpegStatus();
  recheckBtn.disabled = false;
  recheckBtn.textContent = "설치 확인";
  if (!ready) {
    statusEl.textContent = "아직 ffmpeg가 감지되지 않았습니다. 설치 후 다시 확인해 주세요.";
  } else {
    statusEl.textContent = "";
  }
});

document.querySelectorAll(".tabBtn").forEach((btn) => {
  btn.addEventListener("click", () => {
    const tab = btn.dataset.tab;
    document.querySelectorAll(".tabBtn").forEach((b) => b.classList.toggle("active", b === btn));
    document.querySelectorAll(".tabPane").forEach((pane) => {
      pane.hidden = pane.dataset.tab !== tab;
    });
  });
});

document.querySelectorAll(".copyBtn").forEach((btn) => {
  btn.addEventListener("click", async () => {
    try {
      await navigator.clipboard.writeText(btn.dataset.copy);
      const original = btn.textContent;
      btn.textContent = "복사됨!";
      setTimeout(() => (btn.textContent = original), 1500);
    } catch {
      alert("복사에 실패했습니다. 명령을 직접 선택해서 복사해 주세요.");
    }
  });
});

function addRow() {
  const node = rowTemplate.content.cloneNode(true);
  node.querySelector(".removeRow").addEventListener("click", (e) => {
    e.target.closest(".segment-row").remove();
  });
  segmentsEl.appendChild(node);
}

document.getElementById("addRow").addEventListener("click", addRow);
addRow(); // 최소 1줄은 기본 제공

const cropRatioEl = document.getElementById("cropRatio");
const resolutionEl = document.getElementById("resolution");
const cropResHint = document.getElementById("cropResHint");

function updateCropResHint() {
  cropResHint.hidden = cropRatioEl.value === "original" && resolutionEl.value === "original";
}
cropRatioEl.addEventListener("change", updateCropResHint);
resolutionEl.addEventListener("change", updateCropResHint);

form.addEventListener("submit", async (e) => {
  e.preventDefault();
  statusEl.textContent = "";

  if (ffmpegBanner.classList.contains("error")) {
    statusEl.textContent = "먼저 위의 안내에 따라 ffmpeg를 설치해 주세요.";
    return;
  }

  const file = videoFileInput.files[0];
  if (!file) {
    statusEl.textContent = "영상 파일을 선택해 주세요.";
    return;
  }

  const rows = [...document.querySelectorAll(".segment-row")];
  const segments = rows.map((row) => ({
    start: row.querySelector(".start").value.trim(),
    end: row.querySelector(".end").value.trim(),
    label: row.querySelector(".label").value.trim(),
  }));

  if (segments.length === 0 || segments.some((s) => !s.start || !s.end)) {
    statusEl.textContent = "모든 구간의 시작/종료 시간을 입력해 주세요.";
    return;
  }

  const mode = document.querySelector('input[name="mode"]:checked').value;

  const formData = new FormData();
  formData.append("video", file);
  formData.append("segments", JSON.stringify(segments));
  formData.append("mode", mode);
  formData.append("crop_ratio", cropRatioEl.value);
  formData.append("resolution", resolutionEl.value);

  submitBtn.disabled = true;
  statusEl.textContent = `처리 중입니다... (${segments.length}개 구간, 영상 크기에 따라 몇 분 걸릴 수 있어요)`;

  try {
    const res = await fetch("/process", { method: "POST", body: formData });

    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      statusEl.textContent = "오류: " + (data.error || res.statusText);
      if (data.details) {
        statusEl.textContent += "\n" + data.details.join("\n");
      }
      return;
    }

    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "clips.zip";
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);

    statusEl.textContent = "완료! clips.zip 다운로드가 시작되었습니다.";
  } catch (err) {
    statusEl.textContent = "요청 중 오류가 발생했습니다: " + err.message;
  } finally {
    submitBtn.disabled = false;
  }
});
