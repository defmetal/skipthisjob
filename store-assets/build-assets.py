#!/usr/bin/env python3
"""Regenerates the PROPOSED Chrome Web Store promo tiles and the site OG image
from store-assets/logo-ghost-chevron.svg (concept A). Needs: pip install cairosvg pillow
and the DM Sans variable font (path below; adjust FONT if needed).
Usage: python3 store-assets/build-assets.py
Palette per design-direction.md: Ghost Violet #7C3AED, Deep Violet #6D28D9, Midnight #1E1B2E,
Skip Amber #FBBF24, Mist #FAF8FF, Lilac Tint #F3F0FF."""
import io, os
import cairosvg
from PIL import Image, ImageDraw, ImageFont

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
SVG = open(os.path.join(HERE, 'logo-ghost-chevron.svg')).read()
FONT = os.environ.get('DMSANS', '/usr/share/fonts/truetype/sand-box/google/DM Sans/DMSans-VariableFont_opsz,wght.ttf')
VIOLET, DEEP, INK, AMBER, MIST, TINT = '#7C3AED', '#6D28D9', '#1E1B2E', '#FBBF24', '#FAF8FF', '#F3F0FF'


def logo(px):
    return Image.open(io.BytesIO(cairosvg.svg2png(bytestring=SVG.encode(), output_width=px, output_height=px))).convert('RGBA')


def font(size, wght=700):
    f = ImageFont.truetype(FONT, size)
    try:
        f.set_variation_by_axes([14, wght])  # opsz, wght
    except Exception:
        pass
    return f


def gradient(w, h, top, bottom):
    img = Image.new('RGB', (w, h), top)
    px = img.load()
    t = Image.new('RGB', (1, h))
    c1 = tuple(int(top[i:i + 2], 16) for i in (1, 3, 5)); c2 = tuple(int(bottom[i:i + 2], 16) for i in (1, 3, 5))
    for y in range(h):
        k = y / max(h - 1, 1)
        t.putpixel((0, y), tuple(round(c1[i] + (c2[i] - c1[i]) * k) for i in range(3)))
    return t.resize((w, h))


def shadowed_logo(canvas, px, xy, blur_alpha=70):
    from PIL import ImageFilter
    sh = Image.new('RGBA', canvas.size, (0, 0, 0, 0))
    m = Image.new('RGBA', (px, px), (0, 0, 0, blur_alpha))
    mask = logo(px).split()[3]
    sh.paste(m, (xy[0], xy[1] + px // 22), mask)
    sh = sh.filter(ImageFilter.GaussianBlur(px // 14))
    canvas.alpha_composite(sh)
    canvas.alpha_composite(logo(px), xy)


def blend(img, fn):
    layer = Image.new('RGBA', img.size, (0, 0, 0, 0))
    fn(ImageDraw.Draw(layer))
    img.alpha_composite(layer)


def chip(d, xy, text, f, fill, fg, pad=(18, 9), outline=None):
    tw = d.textlength(text, font=f)
    asc, desc = f.getmetrics()
    w, h = tw + pad[0] * 2, asc + desc + pad[1] * 2
    d.rounded_rectangle([xy[0], xy[1], xy[0] + w, xy[1] + h], radius=h / 2, fill=fill, outline=outline, width=2 if outline else 0)
    d.text((xy[0] + pad[0], xy[1] + pad[1]), text, font=f, fill=fg)
    return w, h


def small_tile():  # 440x280
    W, H = 440, 280
    img = gradient(W, H, '#8B5CF6', DEEP).convert('RGBA')
    shadowed_logo(img, 104, (W // 2 - 52, 30))
    d = ImageDraw.Draw(img)
    f1, f2 = font(30, 700), font(19, 500)
    for text, f, y, col in (('Skip This Job', f1, 150, '#FFFFFF'), ('Ghost job detector.', f2, 198, '#EDE9FE'), ('Free, no account.', f2, 224, AMBER)):
        d.text(((W - d.textlength(text, font=f)) / 2, y), text, font=f, fill=col)
    blend(img, lambda ld: ld.text((W - 92, H - 22), 'PROPOSED', font=font(11, 600), fill=(255, 255, 255, 130)))
    return img.convert('RGB')


def marquee():  # 1400x560
    W, H = 1400, 560
    img = gradient(W, H, '#8B5CF6', '#5B21B6').convert('RGBA')
    # soft glow
    from PIL import ImageFilter
    g = Image.new('RGBA', (W, H), (0, 0, 0, 0)); ImageDraw.Draw(g).ellipse([820, -120, 1500, 560], fill=(255, 255, 255, 38))
    img.alpha_composite(g.filter(ImageFilter.GaussianBlur(60)))
    shadowed_logo(img, 300, (1010, 130), 90)
    d = ImageDraw.Draw(img)
    d.text((90, 92), 'Skip This Job', font=font(34, 700), fill='#EDE9FE')
    h1 = font(76, 700)
    d.text((90, 150), "Stop applying to jobs", font=h1, fill='#FFFFFF')
    d.text((90, 240), "that don't exist.", font=h1, fill='#FFFFFF')
    sub = font(28, 500)
    d.text((90, 352), 'A ghost-risk score on every LinkedIn & Indeed listing.', font=sub, fill='#EDE9FE')
    cf = font(22, 600)
    def chips(ld):
        x = 90
        for t in ('Free, no account', 'No daily limit', 'LinkedIn + Indeed'):
            w, _ = chip(ld, (x, 428), t, cf, (255, 255, 255, 40), (255, 255, 255, 255), outline=(255, 255, 255, 120))
            x += w + 14
        ld.text((W - 190, H - 34), 'PROPOSED', font=font(14, 600), fill=(255, 255, 255, 130))
    blend(img, chips)
    return img.convert('RGB')


def og():  # 1200x630
    W, H = 1200, 630
    img = Image.new('RGBA', (W, H), MIST)
    from PIL import ImageFilter
    g = Image.new('RGBA', (W, H), (0, 0, 0, 0)); ImageDraw.Draw(g).ellipse([620, -200, 1400, 560], fill=(124, 58, 237, 60))
    img.alpha_composite(g.filter(ImageFilter.GaussianBlur(80)))
    shadowed_logo(img, 112, (80, 70), 60)
    d = ImageDraw.Draw(img)
    d.text((220, 96), 'Skip This Job', font=font(52, 700), fill=INK)
    h1 = font(80, 700)
    d.text((80, 232), 'Stop applying to jobs', font=h1, fill=INK)
    d.text((80, 322), "that don't exist.", font=h1, fill=VIOLET)
    d.text((80, 432), 'Free Chrome extension for LinkedIn & Indeed', font=font(32, 500), fill='#5B5670')
    cf = font(25, 600); x = 80
    for t in ('Free, no account', 'No daily limit', 'Ghost-risk score on every listing'):
        w, _ = chip(d, (x, 506), t, cf, TINT, DEEP, outline='#E4DEF7')
        x += w + 14
    return img.convert('RGB')


if __name__ == '__main__':
    out = os.path.join(HERE, 'proposed')
    small_tile().save(os.path.join(out, 'small-promo-tile-440x280-proposed.png'))
    marquee().save(os.path.join(out, 'marquee-promo-tile-1400x560-proposed.png'))
    og().save(os.path.join(ROOT, 'web', 'public', 'og-image.png'), optimize=True)
    print('ok')
