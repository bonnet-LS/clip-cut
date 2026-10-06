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

  if (ffmpegBanner) {
    statusEl.textContent = "먼저 위의 안내에 따라 프로그램을 다시 실행해 주세요.";
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
