"""Render the maintained S06 manual and actual redacted release CLI stdout.

Requires reportlab/Pillow. Run from repo root with --log an actual smoke log.
The supplied log is verification input, not an executable command.
"""
import argparse
import hashlib
from html import escape
import json
from pathlib import Path
import re
import textwrap
from PIL import Image, ImageDraw, ImageFont
from reportlab.lib import colors
from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
from reportlab.lib.enums import TA_LEFT
from reportlab.lib.units import inch
from reportlab.platypus import SimpleDocTemplate, Paragraph, Spacer, Preformatted, Image as PdfImage

ROOT = Path(__file__).resolve().parents[2]
DOC = ROOT/'docs/operations/server2-catalogs.md'
PDF = DOC.with_suffix('.pdf')
EVIDENCE = ROOT/'docs/evidence/tasks/server2-catalogs'


def digest(path): return hashlib.sha256(Path(path).read_bytes()).hexdigest()


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--log', required=True)
    args = parser.parse_args()
    log = Path(args.log).resolve()
    if not log.is_relative_to(ROOT/'reports') or log.stat().st_size > 16384:
        raise ValueError('only bounded task reports stdout is accepted')
    output = log.read_text()
    if 'PASS local real HTTP smoke' not in output or any(x in output for x in ('X-Amz-', 'Authorization:', 'secret=')):
        raise ValueError('expected successful redacted actual smoke stdout')
    EVIDENCE.mkdir(parents=True, exist_ok=True)
    font_paths = ['/System/Library/Fonts/Menlo.ttc','/usr/share/fonts/truetype/dejavu/DejaVuSansMono.ttf']
    font = next((ImageFont.truetype(p, 19) for p in font_paths if Path(p).exists()),ImageFont.load_default())
    lines=['$ python3 tests/storage/catalog_peer.py --smoke target/release/examples/catalogs_smoke','']
    for line in output.strip().splitlines(): lines.extend(textwrap.wrap(line, width=105) or [''])
    image = Image.new('RGB',(1400,90+len(lines)*29),'#111827')
    draw = ImageDraw.Draw(image)
    draw.text((35,24),'S06 - actual release HTTP smoke | loopback only',font=font,fill='#93c5fd')
    for i,line in enumerate(lines): draw.text((35,70+i*29),line,font=font,fill='#d1fae5' if line.startswith('PASS') else '#e5e7eb')
    capture=EVIDENCE/'usage.png';image.save(capture)
    styles=getSampleStyleSheet();styles["Heading2"].keepWithNext=1;styles.add(ParagraphStyle(name='S06Body',fontName='Helvetica',fontSize=9,leading=12,spaceAfter=7));styles.add(ParagraphStyle(name='S06Code',fontName='Courier',fontSize=7.2,leading=10,spaceAfter=8))
    story=[];in_code=False;code=[];paragraph=[]
    def flush():
        if paragraph:
            content=escape(' '.join(paragraph));content=re.sub(r'\[([^\]]+)\]\(([^)]+)\)',r'<link href="\2" color="#1d4ed8">\1</link>',content);content=re.sub(r'`([^`]+)`',r'<font name="Courier">\1</font>',content)
            story.append(Paragraph(content,styles['S06Body']));paragraph.clear()
    for line in DOC.read_text().splitlines():
        if line.startswith('```'):
            flush()
            if in_code: story.append(Preformatted('\n'.join(code),styles['S06Code']));code=[]
            in_code=not in_code;continue
        if in_code:code.append(line);continue
        if line.startswith('# '):flush();story.append(Paragraph(escape(line[2:]),styles['Title']))
        elif line.startswith('## '):flush();story.append(Paragraph(escape(line[3:]),styles['Heading2']))
        elif not line.strip():flush()
        else:paragraph.append(line.strip())
    flush();story.append(Spacer(1,8));story.append(Paragraph('Actual local CLI usage',styles['Heading2']));story.append(PdfImage(str(capture),width=6.5*inch,height=image.height/image.width*6.5*inch))
    def footer(canvas,doc):
        canvas.setFont('Helvetica',8);canvas.setFillColor(colors.HexColor('#475569'));canvas.drawString(48,28,'S06 internal storage | local HTTP evidence; no AWS or route verification');canvas.drawRightString(564,28,str(doc.page))
    document=SimpleDocTemplate(str(PDF),pagesize=(612,792),leftMargin=48,rightMargin=48,topMargin=42,bottomMargin=48,title='S06 catalog publication and recovery',author='TodayWeather',invariant=1)
    document.build(story,onFirstPage=footer,onLaterPages=footer)
    manifest={'pages':document.page,'schema':1,'task':'S06','date':'2026-10-07','command':'python3 tests/storage/catalog_peer.py --smoke target/release/examples/catalogs_smoke','environment':'Rust1.99/macOS, public Python loopback peer','scope':'Complete group/cold/repair/unknown HTTP, not AWS/auth/performance/API parity','captured_stdout':output.strip().splitlines(),'binary_sha256':digest(ROOT/'server2/target/release/examples/catalogs_smoke'),'source_sha256':digest(DOC),'pdf_sha256':digest(PDF),'screenshot_sha256':digest(capture)}
    (EVIDENCE/'manifest.json').write_text(json.dumps(manifest,indent=2)+'\n')
    print('Manual PDF, actual stdout capture and hash manifest generated')

if __name__=='__main__': main()
