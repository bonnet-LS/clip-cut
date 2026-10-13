# ClipCut

영상을 고르고 자를 구간(시작~끝 시간)을 입력하면, 구간마다 mp4 클립으로 잘라 주는 사내용 컷편집 도구입니다.
같은 화면(`ui/`)을 세 가지 방식으로 제공합니다.

| 방식 | 주소 / 실행 | 특징 |
|---|---|---|
| **웹** (기본) | https://clipcut-tau.vercel.app | 설치 없이 링크로 사용. 영상은 서버로 전송되지 않고 브라우저 안에서만 처리. '정확하게' 모드는 최대 Full HD(1920) |
| **로컬 실행** | `run_mac.command` / `run_windows.bat` → `http://127.0.0.1:5050` | 4K 원본 화질 그대로, 더 빠르게 처리. Python 설치 필요 |
| 데스크톱 앱 (실험) | `build_mac.sh` / `build_windows.bat` | 설치형 앱. 배포하려면 코드 서명 필요 |

## 사용법

1. **영상 선택** — 클릭해서 고르거나 창으로 끌어다 놓기
2. **구간 입력** — 시작·끝 시간 입력 (`1:23`, `83.5`, `1:02:03` 형식). 구간마다 클립 하나가 만들어짐
3. **출력 설정**
   - 정확하게: 입력한 시간 그대로 정밀하게 자름 (새로 인코딩, H.264)
   - 빠르게: 원본을 복사해 몇 초 만에 자름 (화질 손실 없음, 경계가 1초 정도 어긋날 수 있음)
   - 화면 비율(9:16, 4:5, 1:1, 16:9)과 화질을 바꿀 수 있음 (바꾸면 새로 인코딩)
4. **자르기 시작** — 로컬은 원본 영상 옆(또는 고른 폴더)의 `영상이름_clips` 폴더에, 웹은 다운로드 폴더에 저장

## 로컬 실행 방법

준비물: **Python 3** — https://www.python.org/downloads/ (Windows는 설치 시 "Add to PATH" 체크)

1. 이 저장소를 내려받기 (GitHub → Code → Download ZIP) 후 압축 풀기
2. 실행
   - **Mac**: `run_mac.command` 더블클릭 (처음에 "확인되지 않은 개발자" 경고가 뜨면 우클릭 → 열기)
   - **Windows**: `run_windows.bat` 더블클릭
3. 처음 실행할 때 필요한 프로그램(ffmpeg 등)을 내려받느라 1~2분 걸릴 수 있습니다
4. 브라우저에 `http://127.0.0.1:5050` 이 자동으로 열립니다. 실행 창을 닫으면 종료됩니다

`127.0.0.1`은 "이 컴퓨터"라는 뜻이라 다른 사람에게 주소를 보내도 열리지 않습니다. 각자 PC에서 실행해야 합니다.

## 폴더 구조

```
ui/                 # 공용 화면 (index.html, style.css, app.js)
core.py             # ffmpeg 처리 로직
runner.py           # 자르기 작업 실행 (진행률·취소)
app.py              # 로컬 실행 서버 (127.0.0.1)
static/local.js     # 로컬 서버용 화면 연결
desktop.py          # 데스크톱 앱 (pywebview)
web/                # 웹 버전 (ffmpeg.wasm, Vercel 배포)
  src/web.js        #   브라우저용 엔진
  scripts/build.mjs #   ui/ + 엔진을 public/ 으로 빌드
  vercel.json       #   보안 헤더 (COOP/COEP, CSP)
```

## 웹 버전 개발·배포

```bash
cd web
npm install
npm run dev      # 빌드 후 http://localhost:5080 에서 확인
npm run deploy   # 빌드 후 Vercel 운영 배포 (vercel login 필요)
```

- 영상 처리는 사용자 브라우저 안에서만 이뤄지며, CSP(`connect-src 'self'`)로 외부 전송을 차단합니다.
- 브라우저 메모리 한계로 '정확하게' 모드는 긴 변 1920px 이하로 저장합니다. 4K가 필요하면 로컬 실행 버전을 사용하세요.

## 문제 해결

- "영상 처리 도구(ffmpeg)를 불러오지 못했습니다" → 프로그램 폴더의 `venv` 폴더를 삭제한 뒤 다시 실행
- 일부 구간만 실패 → 결과 폴더(웹은 받은 zip)의 `errors.txt`에 실패 사유 기록
