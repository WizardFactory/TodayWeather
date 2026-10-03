"""Render the maintained pollen manual with actual Angular scenario screenshots."""
from pathlib import Path
from reportlab.pdfgen import canvas
from reportlab.lib.utils import ImageReader
from reportlab.lib.styles import ParagraphStyle
from reportlab.platypus import Paragraph
from reportlab.lib.colors import HexColor

root = Path(__file__).resolve().parents[2]
target = root / 'docs/user/life-index.pdf'
c = canvas.Canvas(str(target), pagesize=(595, 842))
c.setTitle('TodayWeather life indices: pollen risk')
style = ParagraphStyle('body', fontName='Helvetica', fontSize=11, leading=16)
scenarios = [
    ('Spring: summary and detail', 'pollen-tab-forecast-spring.png',
     'Open a Korean location and scroll to Weather details. The pollen risk label shows the highest available grade: Oak High and Pine Normal produce Pollen risk: High.',
     'Tap the pollen row, or focus it and press Enter, to open the detail popup. Only Oak and Pine appear, each with its seasonal explanation and precautions for its own grade. Scroll when needed; choose Close to dismiss it.'),
    ('Autumn: only weeds', 'pollen-tab-forecast-autumn.png',
     'When only weeds have data, the representative risk is Normal. Open the pollen item to see Weeds: Normal. Oak and pine are absent. The popup includes weeds information and precautions.',
     'The three official categories are oak, pine and weeds. This predicted risk index is not a measured particle concentration.'),
    ('Low risk and unavailable data', 'pollen-tab-forecast-low.png',
     'Low is a valid risk grade. It remains visible and opens to Weeds: Low. Missing data is different: the pollen item disappears entirely.',
     'No usable forecast can occur outside the publication season or during a provider outage. There is no zero placeholder and no numeric concentration.')
]
for i, (title, file, intro, detail) in enumerate(scenarios, 1):
    c.setFillColor(HexColor('#f4f6fa')); c.rect(0, 0, 595, 842, fill=1, stroke=0)
    c.setFillColor(HexColor('#132239')); c.setFont('Helvetica-Bold', 23); c.drawString(38, 780, title)
    p=Paragraph(intro, style); _,h=p.wrap(519,100);p.drawOn(c,38,750-h)
    image=ImageReader(str(root/'docs/user/images/pollen-mobile'/file));iw,ih=image.getSize()
    scale=min(440/iw,365/ih);w,hh=iw*scale,ih*scale
    c.drawImage(image, (595-w)/2, 285+(365-hh)/2,w,hh)
    p=Paragraph(detail+'<br/><br/>UV remains a numeric index. Pollen labels are Low, Normal, High and Very high. Data: Korea Meteorological Administration, data.go.kr HealthWthrIdxServiceV3.',style)
    _,h=p.wrap(519,160);p.drawOn(c,38,250-h)
    c.setFont('Helvetica',8);c.drawString(38,38,'2026-10-03 / Actual Angular template, isolated v000903 weather fixture / No mobile release claim')
    c.drawRightString(557,38,f'{i} / 3');c.showPage()
c.save()
print(target)
