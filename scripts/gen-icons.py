#!/usr/bin/env python3
# gen-icons.py - PWA icon generation for the BA white-label system.
# SECURITY: this is a FIXED script invoked with validated argv - request
# values are never interpolated into Python source (Security Wave, Aug 2026).
#
# Usage:
#   gen-icons.py letter <CHAR> <ACCENT_HEX> <BG_HEX> <OUT_DIR>
#   gen-icons.py logo   <LOGO_PATH> <OUT_DIR>
import sys, os, re
from PIL import Image, ImageDraw, ImageFont

def hex_to_rgb(h):
    h = h.lstrip('#')
    return tuple(int(h[i:i+2], 16) for i in (0, 2, 4))

def die(msg):
    sys.stderr.write(msg + "\n")
    sys.exit(2)

def make_letter_icon(letter, accent, bg, size, path):
    img = Image.new('RGBA', (size, size), hex_to_rgb(bg) + (255,))
    draw = ImageDraw.Draw(img)
    acc = hex_to_rgb(accent)
    margin = size // 10
    draw.ellipse([margin, margin, size - margin - 1, size - margin - 1],
                 outline=acc + (200,), width=max(2, size // 40))
    fs = int(size * 0.45)
    try:
        font = ImageFont.truetype('/usr/share/fonts/truetype/dejavu/DejaVuSerif-Bold.ttf', fs)
    except Exception:
        font = ImageFont.load_default()
    bbox = draw.textbbox((0, 0), letter, font=font)
    tw, th = bbox[2] - bbox[0], bbox[3] - bbox[1]
    draw.text(((size - tw) // 2 - bbox[0], (size - th) // 2 - bbox[1]),
              letter, fill=acc + (255,), font=font)
    img.save(path)

def main():
    if len(sys.argv) < 2:
        die('mode required')
    mode = sys.argv[1]
    if mode == 'letter':
        if len(sys.argv) != 6:
            die('letter mode: <CHAR> <ACCENT> <BG> <OUT_DIR>')
        letter, accent, bg, out = sys.argv[2], sys.argv[3], sys.argv[4], sys.argv[5]
        if not re.fullmatch(r'[A-Z0-9]', letter):
            die('letter must be a single A-Z or 0-9 character')
        for c in (accent, bg):
            if not re.fullmatch(r'#[0-9A-Fa-f]{6}', c):
                die('colors must be #RRGGBB')
        if not os.path.isdir(out):
            die('output dir missing')
        make_letter_icon(letter, accent, bg, 192, os.path.join(out, 'icon-192.png'))
        make_letter_icon(letter, accent, bg, 512, os.path.join(out, 'icon-512.png'))
        print('done')
    elif mode == 'logo':
        if len(sys.argv) != 4:
            die('logo mode: <LOGO_PATH> <OUT_DIR>')
        logo, out = sys.argv[2], sys.argv[3]
        if not os.path.isfile(logo) or not os.path.isdir(out):
            die('bad paths')
        img = Image.open(logo).convert('RGBA')
        for size in (192, 512):
            thumb = img.copy()
            thumb.thumbnail((size, size), Image.LANCZOS)
            canvas = Image.new('RGBA', (size, size), (6, 10, 6, 255))
            offset = ((size - thumb.width) // 2, (size - thumb.height) // 2)
            canvas.paste(thumb, offset, thumb)
            canvas.save(os.path.join(out, 'icon-%d.png' % size))
        print('done')
    else:
        die('unknown mode')

if __name__ == '__main__':
    main()
