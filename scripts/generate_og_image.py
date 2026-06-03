#!/usr/bin/env python3
"""Generate the Open Graph / Twitter Card image (1200x630 PNG) from og-image.svg.

Social platforms (Twitter, Facebook, LinkedIn) only support raster formats
for og:image — SVG is silently ignored. This script renders the SVG to a
1200x630 PNG and saves it to docs/public/og-image.png.

Usage:
  python3 scripts/generate_og_image.py

Requires: pip install pillow cairosvg
"""

import shutil
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SRC = ROOT / "docs" / "public" / "og-image.svg"
OUT = ROOT / "docs" / "public" / "og-image.png"


def main() -> int:
    if not SRC.exists():
        print(f"Error: source SVG not found: {SRC}", file=sys.stderr)
        return 1

    try:
        import cairosvg
        cairosvg.svg2png(
            url=str(SRC),
            write_to=str(OUT),
            output_width=1200,
            output_height=630,
        )
        print(f"✓ {OUT.relative_to(ROOT)} (1200x630)")
        return 0
    except ImportError:
        pass

    # Fallback: Pillow + simple text (no SVG rendering)
    try:
        from PIL import Image, ImageDraw, ImageFont

        # Fallback to the existing SVG by rasterizing via Pillow
        # Open SVG as image (Pillow can read SVG if cairosvg/rsvg-convert present)
        img = Image.new("RGB", (1200, 630), color=(59, 130, 246))
        draw = ImageDraw.Draw(img)

        # Try to find a system font
        font_paths = [
            "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf",
            "/usr/share/fonts/truetype/liberation/LiberationSans-Bold.ttf",
            "/usr/share/fonts/dejavu/DejaVuSans-Bold.ttf",
            "/System/Library/Fonts/Helvetica.ttc",
        ]
        font = None
        for fp in font_paths:
            try:
                font = ImageFont.truetype(fp, 120)
                break
            except (OSError, IOError):
                continue
        if font is None:
            font = ImageFont.load_default()

        # Title
        text = "ScholarLib"
        bbox = draw.textbbox((0, 0), text, font=font)
        text_width = bbox[2] - bbox[0]
        text_height = bbox[3] - bbox[1]
        x = (1200 - text_width) // 2
        y = (630 - text_height) // 2 - 30
        draw.text((x, y), text, fill="white", font=font)

        # Subtitle
        sub_font = font
        try:
            sub_font = ImageFont.truetype(font_paths[0], 36) if font_paths else font
        except (OSError, IOError):
            pass
        sub = "Open-Access Paper Library"
        bbox2 = draw.textbbox((0, 0), sub, font=sub_font)
        sw2 = bbox2[2] - bbox2[0]
        sx = (1200 - sw2) // 2
        draw.text((sx, y + 150), sub, fill="white", font=sub_font)

        img.save(OUT, "PNG", optimize=True)
        print(f"✓ {OUT.relative_to(ROOT)} (1200x630, fallback)")
        return 0
    except ImportError:
        pass

    print(
        "Error: cairosvg (preferred) or Pillow required.\n"
        "  pip install cairosvg pillow",
        file=sys.stderr,
    )
    return 1


if __name__ == "__main__":
    sys.exit(main())