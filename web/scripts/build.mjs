// 웹 버전 빌드: ../ui 화면 + src/web.js 엔진 + ffmpeg.wasm 파일을 public/ 으로 모은다.
import { cpSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const ui = join(root, "..", "ui");
const out = join(root, "public");
const nm = join(root, "node_modules");

// 이전 빌드 결과를 지우되, Vercel 프로젝트 연결 정보(.vercel)는 남긴다.
mkdirSync(out, { recursive: true });
for (const name of readdirSync(out)) {
  if (name !== ".vercel") rmSync(join(out, name), { recursive: true, force: true });
}
mkdirSync(join(out, "vendor"), { recursive: true });

cpSync(join(ui, "style.css"), join(out, "style.css"));
cpSync(join(ui, "app.js"), join(out, "app.js"));
cpSync(join(root, "src", "web.js"), join(out, "web.js"));

// 웹 엔진은 app.js 다음에 불러온다.
const html = readFileSync(join(ui, "index.html"), "utf8").replace(
  '<script src="app.js"></script>',
  '<script src="app.js"></script>\n  <script type="module" src="web.js"></script>',
);
writeFileSync(join(out, "index.html"), html);

cpSync(join(nm, "@ffmpeg", "ffmpeg", "dist", "esm"), join(out, "vendor", "ffmpeg"), {
  recursive: true,
  filter: (src) => !src.endsWith(".d.ts") && !src.endsWith(".d.mts"),
});
cpSync(join(nm, "@ffmpeg", "core", "dist", "esm"), join(out, "vendor", "core"), { recursive: true });
cpSync(join(nm, "@ffmpeg", "core-mt", "dist", "esm"), join(out, "vendor", "core-mt"), { recursive: true });
cpSync(join(nm, "fflate", "esm", "browser.js"), join(out, "vendor", "fflate.js"));

// ffmpeg가 영상 파일을 32KB씩 읽을 때마다 브라우저 파일 읽기가 일어나 매우 느리다(초당 1MB 수준).
// WORKERFS 읽기를 16MB 단위로 미리 읽어 두는 방식으로 바꿔, 대용량 파일도 메모리에 다 올리지 않고 빠르게 읽는다.
const ORIGINAL_READ =
  "read:function(stream,buffer,offset,length,position){if(position>=stream.node.size)return 0;" +
  "var chunk=stream.node.contents.slice(position,position+length);" +
  "var ab=WORKERFS.reader.readAsArrayBuffer(chunk);buffer.set(new Uint8Array(ab),offset);return chunk.size}";
const CACHED_READ =
  "read:function(stream,buffer,offset,length,position){var node=stream.node;if(position>=node.size)return 0;" +
  "var c=node.__readCache;if(!c||position<c.start||position+length>c.end){" +
  "var end=Math.min(node.size,Math.max(position+length,position+16777216));" +
  "c=node.__readCache={start:position,end:end,data:new Uint8Array(WORKERFS.reader.readAsArrayBuffer(node.contents.slice(position,end)))}}" +
  "var n=Math.min(length,c.end-position);buffer.set(c.data.subarray(position-c.start,position-c.start+n),offset);return n}";

for (const core of ["core", "core-mt"]) {
  const file = join(out, "vendor", core, "ffmpeg-core.js");
  const src = readFileSync(file, "utf8");
  if (!src.includes(ORIGINAL_READ)) throw new Error(`${core}: WORKERFS read 코드를 찾지 못했습니다 (ffmpeg 버전 확인 필요)`);
  writeFileSync(file, src.replace(ORIGINAL_READ, CACHED_READ));
}

// public/ 폴더만 CLI로 올릴 때 쓰도록 헤더 설정만 남긴 vercel.json을 넣는다 (빌드 설정은 저장소 루트 vercel.json).
const vercelConfig = JSON.parse(readFileSync(join(root, "..", "vercel.json"), "utf8"));
writeFileSync(join(out, "vercel.json"), JSON.stringify({ headers: vercelConfig.headers }, null, 2) + "\n");
// Vercel CLI가 이 폴더에 만드는 인증 토큰 파일(.env*) 등이 절대 배포되지 않도록 제외한다.
writeFileSync(join(out, ".vercelignore"), ".env*\n.vercel\n.gitignore\n");

console.log("built ->", out);
