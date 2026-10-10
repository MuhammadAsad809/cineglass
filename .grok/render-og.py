"""CineGlass share card from the app's cinema hero, with an exact lockup."""
from PIL import Image, ImageDraw, ImageFilter, ImageFont, ImageEnhance
import numpy as np

W, H = 1200, 630
CYAN = (154, 232, 242)
MAGENTA = (233, 168, 224)
AMBER = (243, 197, 107)
WHITE = (246, 248, 252)

font = ImageFont.truetype("/workspace/.grok/fonts/CormorantGaramond-SemiBold.ttf", 156)
title = "CineGlass"
tracking = 2


def rounded_mask(w, h, r):
    m = Image.new("L", (w, h), 0)
    ImageDraw.Draw(m).rounded_rectangle([0, 0, w - 1, h - 1], radius=r, fill=255)
    return m


src = Image.open("/workspace/public/art/hero-cinema.jpg").convert("RGB")
# Cover-crop 16:9 hero to 1200×630. Trim is vertical and small.
scale = max(W / src.width, H / src.height)
resized = src.resize((round(src.width * scale), round(src.height * scale)), Image.Resampling.LANCZOS)
left = (resized.width - W) // 2
top = (resized.height - H) // 2
photo = resized.crop((left, top, left + W, top + H))
photo = ImageEnhance.Color(photo).enhance(0.92)
photo = ImageEnhance.Contrast(photo).enhance(1.06)

glyphs = []
text_w = 0
for i, ch in enumerate(title):
    box = font.getbbox(ch)
    width = font.getlength(ch)
    glyphs.append((ch, width, box))
    text_w += width
    if i < len(title) - 1:
        text_w += tracking
ymin = min(box[1] for _, _, box in glyphs)
ymax = max(box[3] for _, _, box in glyphs)

cy = 318
ty = cy - (ymin + ymax) / 2
tx = (W - text_w) / 2
rule_w = 148
rule_y = int(ty + ymax + 22)

pad_x, pad_y = 78, 46
px = int(tx - pad_x)
pw = int(text_w + pad_x * 2)
py = int(ty + ymin - pad_y)
ph = int((rule_y + 16) - py)
rad = 36
px = max(80, min(px, W - pw - 80))

comp = photo.convert("RGBA")

# Edge vignette so the lockup wins at thumbnail size without burying the room.
yy, xx = np.mgrid[0:H, 0:W]
nx = (xx - W / 2) / (W / 2)
ny = (yy - H / 2) / (H / 2)
r = np.sqrt(nx * nx * 0.55 + ny * ny * 0.85)
vig = np.clip((r - 0.35) * 0.85, 0, 0.62)
dark = np.zeros((H, W, 4), dtype=np.uint8)
dark[..., 3] = (vig * 255).astype(np.uint8)
comp = Image.alpha_composite(comp, Image.fromarray(dark, "RGBA"))

backdrop = comp.crop((px, py, px + pw, py + ph)).filter(ImageFilter.GaussianBlur(14))
panel = Image.alpha_composite(backdrop, Image.new("RGBA", (pw, ph), (7, 7, 12, 92)))
panel = Image.alpha_composite(panel, Image.new("RGBA", (pw, ph), (255, 255, 255, 28)))
sheen = Image.new("RGBA", (pw, ph), (0, 0, 0, 0))
ImageDraw.Draw(sheen).polygon(
    [(28, 18), (pw - 40, 12), (pw - 70, 58), (60, 68)],
    fill=(255, 255, 255, 40),
)
panel = Image.alpha_composite(panel, sheen.filter(ImageFilter.GaussianBlur(8)))
mask = rounded_mask(pw, ph, rad)
panel.putalpha(Image.fromarray(np.minimum(np.array(panel.getchannel("A")), np.array(mask))))
ImageDraw.Draw(panel).rounded_rectangle(
    [1.5, 1.5, pw - 3, ph - 3], radius=rad - 1, outline=(*CYAN, 200), width=2
)
comp.alpha_composite(panel, (px, py))

# Soft shadow, then the wordmark.
shadow = Image.new("RGBA", (W, H), (0, 0, 0, 0))
sd = ImageDraw.Draw(shadow)
x = tx
for ch, width, _box in glyphs:
    sd.text((x, ty + 2), ch, font=font, fill=(0, 0, 0, 210))
    x += width + tracking
comp = Image.alpha_composite(comp, shadow.filter(ImageFilter.GaussianBlur(8)))

glow = Image.new("RGBA", (W, H), (0, 0, 0, 0))
gd = ImageDraw.Draw(glow)
x = tx
for ch, width, _box in glyphs:
    gd.text((x, ty), ch, font=font, fill=(*CYAN, 120))
    x += width + tracking
comp = Image.alpha_composite(comp, glow.filter(ImageFilter.GaussianBlur(8)))

td = ImageDraw.Draw(comp)
x = tx
for ch, width, _box in glyphs:
    td.text((x, ty), ch, font=font, fill=(*WHITE, 250))
    x += width + tracking

rule = np.zeros((2, rule_w, 4), dtype=np.uint8)
for i in range(rule_w):
    t = i / (rule_w - 1)
    col = tuple(int(AMBER[c] * (1 - t) + MAGENTA[c] * t) for c in range(3))
    rule[:, i] = (*col, 230)
comp.alpha_composite(Image.fromarray(rule, "RGBA"), ((W - rule_w) // 2, rule_y))

out = comp.convert("RGB")
out.save("/workspace/.grok/og-preview.png", "PNG")
print("pane", (px, py, pw, ph), "title", round(tx), round(ty), round(text_w), "rule", rule_y)
print("crop", resized.size, "offset", left, top)
