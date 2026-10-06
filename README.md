# ClipCut

영상을 올리고 자를 구간(시작~종료 시간)을 입력하면, 각 구간이 mp4 클립으로 잘려서 zip으로 다운로드되는 간단한 사내용 영상 컷편집 도구입니다.

## 사용 전 준비물 (최초 1회)

1. **Python 3** 설치 — https://www.python.org/downloads/ (설치 시 "Add to PATH" 체크)
2. **ffmpeg** 설치
   - ffmpeg가 없는 상태로 앱을 실행하면 화면에 **설치 도우미 패널**이 자동으로 나타납니다.
     "자동 설치 시도" 버튼(Mac: Homebrew, Windows: winget/Chocolatey 사용)을 눌러보고,
     실패하면 패널의 "수동 설치 방법"에 있는 명령어를 복사해 터미널/PowerShell에 붙여넣으면 됩니다.
   - 수동 설치 — Mac: `brew install ffmpeg` / Windows: `winget install --id=Gyan.FFmpeg -e`
   - 설치 후 페이지의 "설치 확인" 버튼을 누르면 새로고침 없이 바로 사용 가능 상태로 전환됩니다.

## 실행 방법

- **Mac**: `run_mac.command` 더블클릭
  - 처음 실행 시 "확인되지 않은 개발자" 경고가 뜨면, 파일 우클릭 → 열기 를 선택
- **Windows**: `run_windows.bat` 더블클릭

실행하면 자동으로 브라우저가 열리고 `http://127.0.0.1:5050` 페이지가 나타납니다.
창을 닫으면 서버도 함께 종료됩니다.

## 사용법

1. 영상 파일 선택
2. 처리 방식 선택
   - **정확 모드**: 입력한 시간 그대로 정밀하게 자름 (재인코딩, 영상 길이에 따라 다소 시간 소요)
   - **빠른 모드**: 원본을 거의 그대로 복사해서 빠르게 자름 (구간 경계가 키프레임 기준으로 1초 내외 어긋날 수 있음)
3. (선택) 크롭 비율 — 원본 유지 / 정사각형 1:1 / 세로 9:16(릴스·쇼츠) / 세로 4:5(인스타그램) / 가로 16:9
4. (선택) 해상도 — 원본 유지 / 고화질(긴 변 1920px) / 중화질(1280px) / 저화질(854px)
   - 크롭이나 해상도를 지정하면 빠른 모드를 선택해도 자동으로 재인코딩되어 처리됩니다 (화질 변경은 원본 복사만으로는 불가능하기 때문)
5. 구간 추가 — 시작/종료 시간 입력 (`1:23`, `83.5`, `01:02:03` 등 형식 가능), 클립 이름은 선택 입력
6. "편집 시작" 클릭 → 처리가 끝나면 `clips.zip`이 자동 다운로드됨

## 폴더 구조

```
video-clip-cutter/
  app.py              # 서버 (Flask)
  templates/index.html
  static/
  run_mac.command
  run_windows.bat
  requirements.txt
```

## 문제 해결

- 브라우저에 "ffmpeg가 설치되어 있지 않습니다" 배너가 뜨면 → 설치 도우미 패널의 "자동 설치 시도" 또는 "수동 설치 방법"을 이용
- 자동 설치가 "Homebrew/winget을 찾을 수 없다"며 실패하면 → 패널에 안내된 Homebrew(Mac) 설치 명령을 먼저 실행한 뒤 다시 시도
- Mac에서 Homebrew 설치 시 **"Homebrew on macOS is only supported on Apple Silicon processors"** 오류가 뜨면
  → 해당 Mac은 Intel(x86_64) 프로세서이고 최신 Homebrew가 Intel 지원을 중단한 경우입니다.
  패널의 Mac 탭 하단 "MacPorts로 설치" 안내를 따라주세요 (MacPorts는 Intel Mac을 계속 지원합니다).
  ffmpeg.org의 "소스 코드"(.tar.xz)는 직접 컴파일이 필요하므로 받지 않도록 주의하세요.
- 특정 구간만 실패하는 경우 → 다운로드된 zip 안 `errors.txt`에 실패 사유가 기록됨 (예: 시간 범위가 영상 길이를 벗어남)
