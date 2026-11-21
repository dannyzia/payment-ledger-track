#!/usr/bin/env python3
"""
Generate Android and Web assets for Kumon Ledger Track from source images in docs/Images.
Replaces black corners with the branded Kumon blue (#83CDF4 / rgb(131, 205, 244)),
and generates:
- Adaptive icon foreground & background
- Legacy & round launcher icons for all mipmap densities (ldpi, mdpi, hdpi, xhdpi, xxhdpi, xxxhdpi)
- Splash screens for portrait and landscape across all densities and night variants
- Web icons (192, 512, favicon) and static logo
"""

import os
import glob
from collections import deque
from PIL import Image, ImageDraw

KUMON_BLUE = (131, 205, 244, 255)
img_dir = "docs/Images"
res_dir = "apps/web/android/app/src/main/res"

def main():
    icon_src_path = f"{img_dir}/a_clean_flat_friendly_app_icon_design_with_round.png"
    if not os.path.exists(icon_src_path):
        print(f"Source icon not found at {icon_src_path}")
        return

    icon_src = Image.open(icon_src_path).convert("RGBA")
    w, h = icon_src.size

    # Flood fill outer black pixels from corners
    visited = set()
    queue = deque([(0, 0), (w - 1, 0), (0, h - 1), (w - 1, h - 1)])
    for pt in queue:
        visited.add(pt)

    while queue:
        x, y = queue.popleft()
        for dx, dy in [(-1, 0), (1, 0), (0, -1), (0, 1)]:
            nx, ny = x + dx, y + dy
            if 0 <= nx < w and 0 <= ny < h and (nx, ny) not in visited:
                r, g, b, _ = icon_src.getpixel((nx, ny))
                if r < 50 and g < 50 and b < 50:
                    visited.add((nx, ny))
                    queue.append((nx, ny))

    # Transparent icon
    icon_trans = icon_src.copy()
    for pt in visited:
        icon_trans.putpixel(pt, (0, 0, 0, 0))

    # Anti-alias transition pixels
    for x, y in list(visited):
        for dx, dy in [(-1, 0), (1, 0), (0, -1), (0, 1)]:
            nx, ny = x + dx, y + dy
            if 0 <= nx < w and 0 <= ny < h and (nx, ny) not in visited:
                r, g, b, a = icon_trans.getpixel((nx, ny))
                if r < 100 and g < 100 and b < 100:
                    icon_trans.putpixel((nx, ny), KUMON_BLUE)

    # Blue bg icon
    icon_blue = Image.new("RGBA", (w, h), KUMON_BLUE)
    icon_blue.paste(icon_trans, (0, 0), icon_trans)

    icon_blue.save(f"{img_dir}/icon_blue.png")
    icon_trans.save(f"{img_dir}/icon_transparent.png")
    print("Saved icon_blue.png and icon_transparent.png")

    if os.path.exists(res_dir):
        # 1. Update ic_launcher_background.xml
        xml_path = f"{res_dir}/values/ic_launcher_background.xml"
        os.makedirs(os.path.dirname(xml_path), exist_ok=True)
        with open(xml_path, "w") as f:
            f.write("<?xml version=\"1.0\" encoding=\"utf-8\"?>\n<resources>\n    <color name=\"ic_launcher_background\">#83CDF4</color>\n</resources>\n")

        # 2. Generate mipmaps
        densities = {
            "ldpi": {"launcher": 36, "fg": 81},
            "mdpi": {"launcher": 48, "fg": 108},
            "hdpi": {"launcher": 72, "fg": 162},
            "xhdpi": {"launcher": 96, "fg": 216},
            "xxhdpi": {"launcher": 144, "fg": 324},
            "xxxhdpi": {"launcher": 192, "fg": 432},
        }

        for density, sizes in densities.items():
            d_dir = f"{res_dir}/mipmap-{density}"
            os.makedirs(d_dir, exist_ok=True)

            l_size = sizes["launcher"]
            im_l = icon_blue.resize((l_size, l_size), Image.Resampling.LANCZOS)
            im_l.save(f"{d_dir}/ic_launcher.png")

            mask_r = Image.new("L", (l_size, l_size), 0)
            draw_r = ImageDraw.Draw(mask_r)
            draw_r.ellipse((0, 0, l_size, l_size), fill=255)
            im_round = Image.new("RGBA", (l_size, l_size), (0, 0, 0, 0))
            im_round.paste(im_l, (0, 0), mask_r)
            im_round.save(f"{d_dir}/ic_launcher_round.png")

            fg_size = sizes["fg"]
            im_bg = Image.new("RGBA", (fg_size, fg_size), KUMON_BLUE)
            im_bg.save(f"{d_dir}/ic_launcher_background.png")

            im_fg = Image.new("RGBA", (fg_size, fg_size), (0, 0, 0, 0))
            content_size = int(fg_size * 0.72)
            offset = (fg_size - content_size) // 2
            im_content = icon_trans.resize((content_size, content_size), Image.Resampling.LANCZOS)
            im_fg.paste(im_content, (offset, offset), im_content)
            im_fg.save(f"{d_dir}/ic_launcher_foreground.png")

        # 3. Splash screens
        splash_src_path = f"{img_dir}/kumon-ledger-track-splash.png"
        if os.path.exists(splash_src_path):
            splash_src = Image.open(splash_src_path).convert("RGBA")
            sw, sh = splash_src.size
            for splash_path in glob.glob(f"{res_dir}/**/splash.png", recursive=True):
                orig = Image.open(splash_path)
                tw, th = orig.size
                scale = min(tw / sw, th / sh)
                nw, nh = int(sw * scale), int(sh * scale)
                scaled_splash = splash_src.resize((nw, nh), Image.Resampling.LANCZOS)

                canvas = Image.new("RGBA", (tw, th), KUMON_BLUE)
                ox = (tw - nw) // 2
                oy = (th - nh) // 2
                canvas.paste(scaled_splash, (ox, oy), scaled_splash)
                canvas.save(splash_path)

    # 4. Web icons
    web_icon_dir = "apps/web/static/icons"
    os.makedirs(web_icon_dir, exist_ok=True)
    icon_blue.resize((192, 192), Image.Resampling.LANCZOS).save(f"{web_icon_dir}/icon-192.png")
    icon_blue.resize((512, 512), Image.Resampling.LANCZOS).save(f"{web_icon_dir}/icon-512.png")
    icon_blue.resize((64, 64), Image.Resampling.LANCZOS).save("apps/web/static/favicon.png")

    # 5. Static logo
    logo_src_path = f"{img_dir}/Kumon Ledger Track Logo.png"
    if os.path.exists(logo_src_path):
        os.makedirs("apps/web/static/images", exist_ok=True)
        logo_src = Image.open(logo_src_path)
        logo_src.save("apps/web/static/images/logo.png")

    # 6. APK Download QR Code
    try:
        import qrcode
        import qrcode.image.svg
        apk_url = "https://payment-ledger-track.vercel.app/downloads/kumon-ledger-track.apk"
        qr = qrcode.QRCode(
            version=1,
            error_correction=qrcode.constants.ERROR_CORRECT_M,
            box_size=10,
            border=2,
        )
        qr.add_data(apk_url)
        qr.make(fit=True)
        qr.make_image(fill_color="#0F172A", back_color="#FFFFFF").save("apps/web/static/images/apk-qr.png")
        qrcode.make(apk_url, image_factory=qrcode.image.svg.SvgPathImage, box_size=10, border=2).save("apps/web/static/images/apk-qr.svg")
        print("Generated APK download QR codes (PNG & SVG)")
    except Exception as e:
        print("QR generation error:", e)

    print("Asset generation complete!")

if __name__ == "__main__":
    main()
