"""Render the maintained PWA manual JSON. Requires reportlab; no network access."""
import json
from pathlib import Path
from reportlab.pdfgen import canvas
from reportlab.lib.colors import HexColor
from reportlab.lib.utils import ImageReader
from reportlab.platypus import Paragraph
from reportlab.lib.styles import ParagraphStyle

root = Path(__file__).resolve().parents[2]
source = root / "docs/webapp/user-manual.json"
manual = json.loads(source.read_text())
target = root / "docs/webapp/user-manual.pdf"
c = canvas.Canvas(str(target), pagesize=(595, 842))
c.setTitle(manual["title"])
c.setAuthor("TodayWeather")
style = ParagraphStyle("body", fontName="Helvetica", fontSize=11, leading=16,
                       textColor=HexColor("#263449"))
for number, page in enumerate(manual["pages"], 1):
    c.setFillColor(HexColor("#f4f6fa")); c.rect(0, 0, 595, 842, fill=1, stroke=0)
    c.setFillColor(HexColor("#225fc0")); c.setFont("Helvetica-Bold", 11)
    c.drawString(38, 800, "TODAYWEATHER / PWA")
    c.setFillColor(HexColor("#132239")); c.setFont("Helvetica-Bold", 23)
    c.drawString(38, 766, page["title"])
    p = Paragraph(page["intro"], style); _, h = p.wrap(519, 100)
    p.drawOn(c, 38, 737-h)
    image = root / "docs/webapp/manual-images" / page["image"]
    im = ImageReader(str(image)); iw, ih = im.getSize()
    scale = min(519 / iw, 350 / ih)
    w, h = iw*scale, ih*scale
    c.drawImage(im, 38+(519-w)/2, 324+(350-h)/2, w, h)
    y = 298
    for i, step in enumerate(page["steps"], 1):
        p = Paragraph(f"<b>{i}.</b> {step}", style); _, h = p.wrap(519, 80)
        p.drawOn(c, 38, y-h); y -= h+8
    p = Paragraph("<b>Expected:</b> "+page["expected"], style)
    _, h = p.wrap(519, 90); p.drawOn(c, 38, y-h); y -= h+10
    p = Paragraph("<b>If unavailable:</b> "+page["failure"], style)
    _, h = p.wrap(519, 90); p.drawOn(c, 38, y-h)
    if y-h < 64: raise ValueError(f"Page {number} content exceeds safe margin")
    c.setFont("Helvetica", 8); c.setFillColor(HexColor("#5d6c82"))
    c.drawString(38, 38, f"{page['scenario']} / Synthetic fixture screenshots / {manual['date']}")
    c.drawRightString(557, 38, f"{number} / {len(manual['pages'])}")
    c.showPage()
c.save()
print(target)
