"""Значок Светланы (.ico) без внешних файлов: фиолетовый круг с белой «С»."""
import sys
from PIL import Image, ImageDraw, ImageFont

out = sys.argv[1] if len(sys.argv) > 1 else "svetlana.ico"
S = 256
img = Image.new("RGBA", (S, S), (0, 0, 0, 0))
d = ImageDraw.Draw(img)
d.ellipse((8, 8, S - 8, S - 8), fill=(124, 92, 232, 255))
d.ellipse((8, 8, S - 8, S - 8), outline=(255, 255, 255, 90), width=6)
font = None
for name in ("segoeuib.ttf", "arialbd.ttf", "DejaVuSans-Bold.ttf"):
    try:
        font = ImageFont.truetype(name, 170)
        break
    except OSError:
        continue
font = font or ImageFont.load_default()
box = d.textbbox((0, 0), "С", font=font)
d.text(((S - (box[2] - box[0])) / 2 - box[0], (S - (box[3] - box[1])) / 2 - box[1]), "С", font=font, fill="white")
img.save(out, sizes=[(16, 16), (24, 24), (32, 32), (48, 48), (64, 64), (128, 128), (256, 256)])
print("icon:", out)
