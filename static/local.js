// ClipCut 로컬 실행 버전 연결부.
// 데스크톱 앱(pywebview)과 같은 API(window.pywebview.api)를 이 PC의 로컬 서버(app.py) 호출로 구현해
// ui/app.js 화면을 그대로 재사용한다.
(() => {
  const TOKEN = document.querySelector('meta[name="clipcut-token"]').content;
  let eventSeq = 0;
  let polling = null;

  async function call(path, body, extraHeaders = {}) {
    const res = await fetch(`/api/${path}`, {
      method: body === undefined ? "GET" : "POST",
      headers: {
        "X-ClipCut-Token": TOKEN,
        ...(body !== undefined && !(body instanceof Blob) ? { "Content-Type": "application/json" } : {}),
        ...extraHeaders,
      },
      body: body === undefined ? undefined : body instanceof Blob ? body : JSON.stringify(body),
    });
    if (!res.ok) throw new Error(`서버 오류 (${res.status})`);
    return res.json();
  }

  function emit(event, payload) {
    if (window.clipcut && window.clipcut[event]) window.clipcut[event](payload);
  }

  // 운영체제 파일 선택 창을 쓸 수 없는 환경이면 브라우저 파일 선택 후 이 PC 안에서 복사한다.
  function pickWithBrowser() {
    return new Promise((resolve) => {
      const input = document.createElement("input");
      input.type = "file";
      input.accept = "video/*,.mp4,.mov,.mkv,.avi,.m4v,.webm";
      input.addEventListener("change", () => resolve(input.files[0] || null), { once: true });
      input.addEventListener("cancel", () => resolve(null), { once: true });
      input.click();
    });
  }

  async function upload(file) {
    const name = document.querySelector(".dropzone-title");
    if (name) name.textContent = `${file.name} 불러오는 중…`;
    try {
      return await call("upload", file, { "X-Filename": encodeURIComponent(file.name) });
    } finally {
      if (name) name.textContent = "여기를 클릭해 영상 파일 선택";
    }
  }

  function startPolling() {
    if (polling) return;
    polling = setInterval(async () => {
      try {
        const { seq, events } = await call(`events?since=${eventSeq}`);
        eventSeq = seq;
        for (const e of events) {
          emit(e.event, e.payload);
          if (e.event === "onDone") {
            clearInterval(polling);
            polling = null;
          }
        }
      } catch (err) {
        console.error(err);
      }
    }, 300);
  }

  const api = {
    get_info: () => call("info"),
    async pick_video() {
      const result = await call("pick_video", {});
      if (result && result.unsupported) {
        const file = await pickWithBrowser();
        return file ? upload(file) : null;
      }
      return result;
    },
    pick_output_parent: () => call("pick_output", {}),
    open_folder: (path) => call("open_folder", { path }),
    async start(job) {
      const { seq } = await call(`events?since=${eventSeq}`);
      eventSeq = seq;
      const res = await call("start", job);
      if (!res.error) startPolling();
      return res;
    },
    cancel: () => call("cancel", {}),
  };

  // 끌어다 놓은 파일은 경로를 알 수 없어 업로드(이 PC 안에서의 복사) 방식으로 처리한다.
  document.addEventListener("drop", async (e) => {
    const file = e.dataTransfer && e.dataTransfer.files[0];
    if (file) emit("onVideoSelected", await upload(file));
  });

  window.pywebview = { api };
  window.dispatchEvent(new Event("pywebviewready"));
})();
