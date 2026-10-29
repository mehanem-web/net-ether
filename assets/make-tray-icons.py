"""Builds the tray animation frames (assets/tray-{idle,fail,dim}-{0..3}.ico) from tray.ico.

    python assets/make-tray-icons.py

rc.3: the old frames were 16 px only and the alert ones a dim red ring on dark navy — on a
150 % display, stretched and on Windows' grey tray, the alert icon read as blank. Every frame
now carries 16/24/32 px images made from tray.ico's own art:
  idle  the normal icon with a gentle glow pulse
  fail  the whole tile solid red, pulsing, shield in near-white — impossible to miss
  dim   greyed out (half-opacity mode)
ICO files are packed by hand (PNG entries): Pillow's multi-size .ico writer is broken.
Needs Pillow."""
import io, os, struct
from PIL import Image

HERE = os.path.dirname(os.path.abspath(__file__))
SIZES = (16, 24, 32)


def read_ico(path):
    d = open(path, 'rb').read()
    n = struct.unpack('<HHH', d[:6])[2]
    out = {}
    for i in range(n):
        w, h, _c, _r, _p, _b, sz, off = struct.unpack('<BBBBHHII', d[6 + 16 * i:22 + 16 * i])
        out[w or 256] = Image.open(io.BytesIO(d[off:off + sz])).convert('RGBA')
    return out


def write_ico(path, images):
    pngs = []
    for im in images:
        b = io.BytesIO(); im.save(b, 'PNG'); pngs.append((im.size[0], b.getvalue()))
    head = struct.pack('<HHH', 0, 1, len(pngs))
    off = 6 + 16 * len(pngs)
    ents, blob = b'', b''
    for w, data in pngs:
        ents += struct.pack('<BBBBHHII', w % 256, w % 256, 0, 0, 1, 32, len(data), off + len(blob))
        blob += data
    open(path, 'wb').write(head + ents + blob)


def accent(px):
    # 0 = background navy (≈ 8,18,22), 1 = full accent green (≈ 0,255,160)
    r, g, b, a = px
    return max(0.0, min(1.0, (g - 18) / 237.0))


def recolor(im, fn):
    out = Image.new('RGBA', im.size)
    out.putdata([fn(px) for px in im.getdata()])
    return out


def mix(c1, c2, t):
    return tuple(int(round(c1[i] + (c2[i] - c1[i]) * t)) for i in range(3))


def idle(im, k):
    def f(px):
        r, g, b, a = px
        t = accent(px)
        if t < 0.05: return px
        s = 1.0 - (1.0 - k) * t          # dim only the green parts
        return (int(r * s), int(g * s), int(b * s), a)
    return recolor(im, f)


def fail(im, k):
    bg = mix((120, 0, 0), (235, 30, 30), k)   # the tile itself turns red, pulsing
    fg = (255, 235, 235)
    def f(px):
        a = px[3]
        if a == 0: return px
        c = mix(bg, fg, accent(px))
        return (c[0], c[1], c[2], 255 if a > 40 else a)
    return recolor(im, f)


def dim(im, _k):
    def f(px):
        r, g, b, a = px
        y = int(0.3 * r + 0.59 * g + 0.11 * b)
        y = int(60 + y * 0.6)
        return (y, y, y, int(a * 0.75))
    return recolor(im, f)


def main():
    base = read_ico(os.path.join(HERE, 'tray.ico'))
    missing = [s for s in SIZES if s not in base]
    if missing: raise SystemExit(f'tray.ico lacks sizes {missing}')
    pulse = (1.0, 0.82, 0.64, 0.82)
    for mode, fn in (('idle', idle), ('fail', fail), ('dim', dim)):
        for i, k in enumerate(pulse):
            write_ico(os.path.join(HERE, f'tray-{mode}-{i}.ico'), [fn(base[s], k) for s in SIZES])
    print('wrote 12 frames ×', len(SIZES), 'sizes')


if __name__ == '__main__':
    main()
