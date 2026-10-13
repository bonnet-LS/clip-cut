"""앱 아이콘(assets/icon.png, icon.icns, icon.ico)을 생성한다. 빌드 스크립트에서 호출."""
import subprocess
import sys
from pathlib import Path

from PIL import Image, ImageDraw

ROOT = Path(__file__).resolve().parent.parent
ASSETS = ROOT / "assets"
SIZE = 1024


def draw_icon() -> Image.Image:
    img = Image.new("RGBA", (SIZE, SIZE), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    # macOS 아이콘 그리드: 1024 캔버스 안에 824 크기의 둥근 사각형
    margin = 100
    d.rounded_rectangle((margin, margin, SIZE - margin, SIZE - margin), radius=185, fill=(74, 124, 102, 255))
    # 컷을 의미하는 비스듬한 흰 막대
    cx, cy, half_len, half_w = SIZE / 2, SIZE / 2, 230, 34
    bar = Image.new("RGBA", (SIZE, SIZE), (0, 0, 0, 0))
    ImageDraw.Draw(bar).rounded_rectangle(
        (cx - half_w, cy - half_len, cx + half_w, cy + half_len), radius=half_w, fill=(255, 255, 255, 255),
    )
    img.alpha_composite(bar.rotate(-20, resample=Image.BICUBIC, center=(cx, cy)))
    return img


def main():
    ASSETS.mkdir(exist_ok=True)
    img = draw_icon()
    img.save(ASSETS / "icon.png")
    img.save(ASSETS / "icon.ico", sizes=[(16, 16), (32, 32), (48, 48), (64, 64), (128, 128), (256, 256)])

    if sys.platform == "darwin":
        iconset = ASSETS / "icon.iconset"
        iconset.mkdir(exist_ok=True)
        for size in (16, 32, 128, 256, 512):
            img.resize((size, size), Image.LANCZOS).save(iconset / f"icon_{size}x{size}.png")
            img.resize((size * 2, size * 2), Image.LANCZOS).save(iconset / f"icon_{size}x{size}@2x.png")
        subprocess.run(["iconutil", "-c", "icns", str(iconset), "-o", str(ASSETS / "icon.icns")], check=True)
        for f in iconset.iterdir():
            f.unlink()
        iconset.rmdir()


if __name__ == "__main__":
    main()
