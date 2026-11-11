#!/usr/bin/env python3
# gen-renditions.py - phone-first renditions of a website photo (Sep 2026).
# SECURITY: fixed script, validated argv; request values never reach Python
# source. Usage:  gen-renditions.py <SRC_PATH>
# Writes, beside the source, <base>.w480.jpg/.webp, .w960.*, .w1600.* (only the
# widths the source can fill), EXIF-rotated and EXIF-stripped, and prints one
# JSON line: {"width":W,"height":H,"sizes":[480,960,...]}.
import sys, os, re, json
from PIL import Image, ImageOps

WIDTHS = (480, 960, 1600)

def die(msg):
    sys.stderr.write(msg + "\n"); sys.exit(2)

def main():
    if len(sys.argv) != 2: die('usage: <SRC_PATH>')
    src = sys.argv[1]
    if not os.path.isfile(src): die('no such file')
    if not re.search(r'\.(jpe?g|png|webp)$', src, re.I): die('not an image path')
    if re.search(r'\.w\d+\.(jpg|webp)$', src, re.I): die('already a rendition')
    base = re.sub(r'\.[A-Za-z0-9]+$', '', src)
    img = Image.open(src)
    img = ImageOps.exif_transpose(img)
    if img.mode not in ('RGB', 'RGBA'): img = img.convert('RGBA' if 'A' in img.getbands() else 'RGB')
    if img.mode == 'RGBA':
        flat = Image.new('RGB', img.size, (255, 255, 255)); flat.paste(img, mask=img.split()[3]); img = flat
    w, h = img.size
    made = []
    for tw in WIDTHS:
        if tw > w and made: break            # never upscale; keep at least one size
        scale = min(1.0, tw / float(w))
        out = img.resize((max(1, int(round(w * scale))), max(1, int(round(h * scale)))), Image.LANCZOS) if scale < 1.0 else img.copy()
        out.save(base + '.w%d.jpg' % tw, 'JPEG', quality=82, optimize=True, progressive=True)
        out.save(base + '.w%d.webp' % tw, 'WEBP', quality=78, method=4)
        made.append(tw)
        if tw >= w: break
    print(json.dumps({'width': w, 'height': h, 'sizes': made}))

if __name__ == '__main__':
    main()
