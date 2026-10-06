"""Generates the synthetic sample receipts in this folder (python3 tests/receipts/_generate.py).

Real photos are better test cases; these cover regional conventions deterministically:
US tax-added + handwritten tip, German VAT-inclusive with decimal commas, Japanese tax-inclusive
with a Reiwa-era date, Indian CGST/SGST + service charge.
"""
import os
import random
from PIL import Image, ImageDraw, ImageFilter, ImageFont

HERE = os.path.dirname(os.path.abspath(__file__))
MONO = "/System/Library/Fonts/Supplemental/Courier New Bold.ttf"
HAND = "/System/Library/Fonts/Supplemental/Bradley Hand Bold.ttf"
JP = "/System/Library/Fonts/Hiragino Sans GB.ttc"


def render(name, lines, font_path=MONO, size=26, width=620, handwritten=()):
    font = ImageFont.truetype(font_path, size)
    hand = ImageFont.truetype(HAND, size + 10)
    line_h = int(size * 1.45)
    height = 80 + line_h * (len(lines) + len(handwritten) * 2) + 60
    img = Image.new("RGB", (width, height), (252, 251, 246))
    d = ImageDraw.Draw(img)
    y = 50
    for line in lines:
        if isinstance(line, tuple):  # (left, right)
            left, right = line
            d.text((40, y), left, font=font, fill=(25, 25, 25))
            w = d.textlength(right, font=font)
            d.text((width - 40 - w, y), right, font=font, fill=(25, 25, 25))
        else:
            w = d.textlength(line, font=font)
            d.text(((width - w) / 2, y), line, font=font, fill=(25, 25, 25))
        y += line_h
    for left, right in handwritten:
        y += line_h // 2
        d.text((60, y), left, font=hand, fill=(20, 40, 140))
        w = d.textlength(right, font=hand)
        d.text((width - 60 - w, y), right, font=hand, fill=(20, 40, 140))
        y += line_h + 6
    random.seed(name)
    img = img.rotate(random.uniform(-1.2, 1.2), expand=True, fillcolor=(200, 200, 195), resample=Image.BICUBIC)
    img = img.filter(ImageFilter.GaussianBlur(0.4))
    img.save(os.path.join(HERE, f"{name}.png"), optimize=True)


render("us-diner", [
    "CORNER DINER", "1180 Broadway, New York NY", "(212) 555-0142", "",
    ("09/14/2026", "7:42 PM"), ("Server: Maria", "Table 12"), "-" * 34,
    ("1 Cheeseburger", "14.50"), ("1 Caesar Salad", "11.00"), ("2 Fries @ 4.25", "8.50"),
    ("2 Iced Tea @ 3.25", "6.50"), "-" * 34,
    ("Subtotal", "40.50"), ("Sales Tax 8.875%", "3.59"), ("TOTAL", "44.09"), "",
    ("VISA ****4417", ""), "Suggested tip: 18% $7.29  20% $8.10",
], handwritten=[("Tip", "8.00"), ("Total", "52.09")])

render("de-cafe", [
    "Café Sonnenschein", "Oranienstr. 21, 10999 Berlin", "USt-IdNr. DE123456789", "",
    ("03.10.2026", "10:15"), "-" * 34,
    ("Cappuccino groß 2 x 3,40", "6,80 A"), ("Butterbrezel 2 x 1,95", "3,90 B"),
    ("Käsekuchen", "3,80 B"), ("  Rabatt Tagesangebot", "-0,80 B"), ("Mineralwasser 0,5l", "2,20 A"),
    "-" * 34, ("SUMME EUR", "15,90"), "",
    ("Gegeben Bar", "20,00"), ("Rückgeld", "4,10"), "",
    ("MwSt   Netto   Steuer   Brutto", ""), ("A 19%   7,56    1,44    9,00", ""), ("B  7%   6,45    0,45    6,90", ""),
    "", "Vielen Dank für Ihren Besuch!",
])

render("jp-ramen", [
    "らーめん一番 新宿店", "東京都新宿区西新宿1-2-3", "TEL 03-1234-5678", "",
    ("令和8年10月5日(月)", "12:31"), "-" * 26,
    ("醤油ラーメン", "¥980"), ("餃子(6個)", "¥480"), ("生ビール ×2 @600", "¥1,200"), "-" * 26,
    ("小計", "¥2,660"), ("(内消費税等 10%", "¥241)"), ("合計", "¥2,660"), "",
    ("お預り", "¥3,000"), ("お釣り", "¥340"), "", "ありがとうございました",
], font_path=JP, size=26)

render("in-restaurant", [
    "SPICE ROUTE KITCHEN", "100 Ft Road, Indiranagar, Bengaluru", "GSTIN 29ABCDE1234F1Z5", "",
    ("Date: 28/09/2026", "Bill No: 4471"), "-" * 34,
    ("Paneer Butter Masala 1x345.00", "345.00"), ("Butter Naan 4x60.00", "240.00"),
    ("Dal Makhani 1x295.00", "295.00"), ("Mango Lassi 2x120.00", "240.00"),
    ("Veg Party Platter 1x1,450.00", "1,450.00"), "-" * 34,
    ("Sub Total", "2,570.00"), ("Service Charge @5%", "128.50"),
    ("CGST @2.5%", "67.46"), ("SGST @2.5%", "67.46"), "-" * 34,
    ("GRAND TOTAL", "Rs 2,833.42"), "", "Thank you! Visit again",
])
print("generated")
