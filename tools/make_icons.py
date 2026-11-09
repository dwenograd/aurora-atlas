"""Draws the Aurora Atlas app icons (aurora curtain over a volcano and a still lake).

Pure Python, no image libraries. Run from the repo root:  python tools/make_icons.py
"""
import math
import os
import struct
import zlib

OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'icons')


def smooth(e0, e1, x):
    t = min(1.0, max(0.0, (x - e0) / (e1 - e0)))
    return t * t * (3 - 2 * t)


def mix(a, b, t):
    return tuple(a[i] + (b[i] - a[i]) * t for i in range(3))


def h1(n, seed):
    n = (n * 374761393 + seed * 668265263) & 0xFFFFFFFF
    n = ((n ^ (n >> 13)) * 1274126177) & 0xFFFFFFFF
    return ((n ^ (n >> 16)) & 0xFFFF) / 65535.0


def noise1(x, seed):
    i = math.floor(x)
    f = x - i
    u = f * f * (3 - 2 * f)
    return h1(i, seed) * (1 - u) + h1(i + 1, seed) * u


def fbm1(x, seed, octaves=4):
    v, a, fr = 0.0, 0.5, 1.0
    for o in range(octaves):
        v += a * noise1(x * fr, seed + o * 31)
        fr *= 2.03
        a *= 0.5
    return v


STARS = [(0.12, 0.86, 1.0), (0.27, 0.93, 0.7), (0.83, 0.9, 0.9), (0.69, 0.8, 0.6), (0.92, 0.72, 0.7), (0.06, 0.66, 0.6), (0.45, 0.95, 0.8), (0.58, 0.88, 0.5)]
GREEN, TEAL, VIOLET = (0.30, 1.0, 0.62), (0.16, 0.8, 0.82), (0.66, 0.42, 1.0)


def sample(u, v):
    """u: 0..1 left to right, v: 0..1 bottom to top. Returns linear-ish rgb 0..1."""
    water = 0.2
    if v < water:  # lake reflects the scene
        depth = (water - v) / water
        ru = u + 0.006 * math.sin(v * 140.0)
        r, g, b = sample(ru, 2 * water - v)
        k = 0.45 - 0.25 * depth
        return (r * k + 0.01, g * k + 0.015, b * k + 0.03)
    col = mix((0.012, 0.022, 0.06), (0.05, 0.08, 0.17), smooth(0.2, 1.0, v))
    for sx, sy, sb in STARS:
        d = math.hypot(u - sx, v - sy)
        col = tuple(c + sb * 0.9 * smooth(0.012, 0.0, d) for c in col)
    # aurora: two curtains
    for k, (base0, amp, seed) in enumerate(((0.47, 0.07, 3), (0.6, 0.05, 9))):
        base = base0 + amp * math.sin(u * 5.0 + 0.7 + k * 1.9) + 0.03 * math.sin(u * 12.0 + k)
        dy = v - base
        if dy < -0.03:
            continue
        rays = fbm1(u * 24.0 + k * 7.0, seed)
        rays = smooth(0.25, 0.85, rays)
        curtain = smooth(-0.02, 0.012, dy) * math.exp(-max(dy, 0.0) * (4.2 + 2.0 * k))
        inten = curtain * (0.3 + rays) * (1.0 - 0.3 * k) * 1.35
        c = mix(mix(GREEN, TEAL, 0.3 * k), VIOLET, smooth(0.03, 0.26, dy))
        col = tuple(col[i] + c[i] * inten for i in range(3))
    # mountains: a snow-capped volcano and a low ridge
    cone = 0.5 - abs(u - 0.64) * 0.78
    ridge = 0.25 + 0.05 * fbm1(u * 3.0, 41) + 0.02 * math.sin(u * 7.0)
    mount = max(cone, ridge)
    if v < mount:
        m = (0.03, 0.045, 0.08)
        if cone > ridge and v > 0.5 - 0.11 + 0.02 * noise1(u * 30.0, 77):
            m = (0.2, 0.27, 0.32)
        rim = smooth(mount - 0.015, mount, v)
        return tuple(m[i] + (0.04, 0.12, 0.1)[i] * rim * 0.5 for i in range(3))
    # treeline along the shore
    tx = u * 26.0
    ti = math.floor(tx)
    tf = tx - ti
    th = (0.02 + 0.05 * h1(ti, 5)) * (1 if h1(ti, 11) > 0.2 else 0)
    if v < water + 0.012 + th * max(0.0, 1.0 - abs(tf - 0.5) * 2.2):
        return (0.006, 0.009, 0.016)
    return col


def render(size, ss=3):
    px = bytearray(size * size * 4)
    for y in range(size):
        for x in range(size):
            acc = [0.0, 0.0, 0.0]
            for sy in range(ss):
                for sx in range(ss):
                    u = (x + (sx + 0.5) / ss) / size
                    v = 1.0 - (y + (sy + 0.5) / ss) / size
                    c = sample(u, v)
                    for i in range(3):
                        acc[i] += c[i]
            o = (y * size + x) * 4
            for i in range(3):
                val = acc[i] / (ss * ss)
                val = 1.0 - math.exp(-val * 1.6)  # soft tone curve keeps the glow from clipping
                px[o + i] = max(0, min(255, int(round(255 * (val ** (1 / 1.25))))))
            px[o + 3] = 255
    return px


def round_corners(px, size, radius_frac):
    r = size * radius_frac
    for y in range(size):
        for x in range(size):
            cx = min(max(x + 0.5, r), size - r)
            cy = min(max(y + 0.5, r), size - r)
            d = math.hypot(x + 0.5 - cx, y + 0.5 - cy)
            a = max(0.0, min(1.0, r - d + 0.5))
            o = (y * size + x) * 4 + 3
            px[o] = int(px[o] * a)
    return px


def write_png(path, size, px):
    raw = b''.join(b'\x00' + bytes(px[y * size * 4:(y + 1) * size * 4]) for y in range(size))

    def chunk(t, d):
        return struct.pack('>I', len(d)) + t + d + struct.pack('>I', zlib.crc32(t + d) & 0xFFFFFFFF)

    data = b'\x89PNG\r\n\x1a\n' + chunk(b'IHDR', struct.pack('>IIBBBBB', size, size, 8, 6, 0, 0, 0)) + chunk(b'IDAT', zlib.compress(raw, 9)) + chunk(b'IEND', b'')
    with open(path, 'wb') as f:
        f.write(data)


def main():
    os.makedirs(OUT, exist_ok=True)
    jobs = [
        ('icon-512.png', 512, 2, 0.22),
        ('icon-192.png', 192, 3, 0.22),
        ('icon-maskable-512.png', 512, 2, 0),
        ('apple-touch-icon.png', 180, 3, 0),
        ('favicon-32.png', 32, 6, 0.2),
    ]
    for name, size, ss, rad in jobs:
        px = render(size, ss)
        if rad:
            px = round_corners(px, size, rad)
        write_png(os.path.join(OUT, name), size, px)
        print('wrote', name)


if __name__ == '__main__':
    main()
