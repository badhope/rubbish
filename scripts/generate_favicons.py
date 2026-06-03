#!/usr/bin/env python3
"""Generate favicons from docs/public/og-image.svg.

Outputs:
  - favicon.svg        (vector, modern browsers)
  - favicon.ico        (16x16 + 32x32 ICO, legacy browsers)
  - apple-touch-icon.png (180x180 PNG, iOS)

Requires: pip install pillow cairosvg

If Pillow + cairosvg aren't available, falls back to copying the SVG
and warning the user to install the dependencies.
"""

import argparse
import shutil
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SRC = ROOT / "docs" / "public" / "og-image.svg"
OUT_DIR = ROOT / "docs" / "public"


def main() -> int:
    parser = argparse.ArgumentParser(description="Generate favicons from og-image.svg")
    args = parser.parse_args()

    if not SRC.exists():
        print(f"Error: source SVG not found: {SRC}", file=sys.stderr)
        return 1

    # SVG version: always works
    svg_dest = OUT_DIR / "favicon.svg"
    shutil.copy(SRC, svg_dest)
    print(f"✓ {svg_dest.relative_to(ROOT)}")

    # Try PNG + ICO generation
    try:
        import cairosvg
        from PIL import Image
        from io import BytesIO

        # Render SVG to PNG at 512x512 (high-res)
        png_bytes = cairosvg.svg2png(
            url=str(SRC),
            output_width=512,
            output_height=512,
        )

        # 180x180 Apple touch icon
        img = Image.open(BytesIO(png_bytes))
        img_180 = img.resize((180, 180), Image.LANCZOS)
        apple_path = OUT_DIR / "apple-touch-icon.png"
        img_180.save(apple_path, "PNG", optimize=True)
        print(f"✓ {apple_path.relative_to(ROOT)}")

        # 192x192 PWA icon
        img_192 = img.resize((192, 192), Image.LANCZOS)
        pwa_192 = OUT_DIR / "pwa-192.png"
        img_192.save(pwa_192, "PNG", optimize=True)
        print(f"✓ {pwa_192.relative_to(ROOT)}")

        # 512x512 PWA icon
        img_512 = img.resize((512, 512), Image.LANCZOS)
        pwa_512 = OUT_DIR / "pwa-512.png"
        img_512.save(pwa_512, "PNG", optimize=True)
        print(f"✓ {pwa_512.relative_to(ROOT)}")

        # ICO (32x32 only — keep it small)
        img_32 = img.resize((32, 32), Image.LANCZOS)
        ico_path = OUT_DIR / "favicon.ico"
        img_32.save(ico_path, format="ICO", sizes=[(16, 16), (32, 32)])
        print(f"✓ {ico_path.relative_to(ROOT)}")

    except ImportError as e:
        print(
            f"⚠ Could not generate PNG/ICO (missing dependency: {e.name}).\n"
            "  Install: pip install pillow cairosvg\n"
            "  SVG favicon copied; PNG/ICO generation skipped.",
            file=sys.stderr,
        )
        return 0

    return 0


if __name__ == "__main__":
    sys.exit(main())