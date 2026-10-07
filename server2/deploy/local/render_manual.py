#!/usr/bin/env python3
"""Render editable operator Markdown and an actual terminal usage capture.

Optional documentation dependencies: reportlab, Pillow, PyMuPDF. No provider calls.
Run the PDF skill's authoring marker before the first invocation.
"""
import argparse
from datetime import date
import hashlib
import json
import platform
import re
import textwrap
from pathlib import Path
from xml.sax.saxutils import escape
from PIL import Image, ImageDraw, ImageFont
from reportlab import rl_config
rl_config.useA85 = False
from reportlab.lib import colors
from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
from reportlab.platypus import SimpleDocTemplate, Paragraph, Spacer, Preformatted, Image as PDFImage, Table, TableStyle


def render(source, log, pdf, capture, manifest, binary, captured_at='2026-10-06'):
    captured_at=date.fromisoformat(captured_at).isoformat()
    source=Path(source);capture=Path(capture);capture.parent.mkdir(parents=True,exist_ok=True)
    lines=['ACTUAL RELEASE-PROCESS SMOKE | '+captured_at,'python3.11 server2/deploy/local/smoke.py --binary target/release/server2','']
    for line in Path(log).read_text().splitlines(): lines.extend(textwrap.wrap(line,width=104,replace_whitespace=False) or [''])
    width=1500;height=90+len(lines)*25
    image=Image.new('RGB',(width,height),'#102135');draw=ImageDraw.Draw(image)
    fontpath='/System/Library/Fonts/Menlo.ttc'
    font=ImageFont.truetype(fontpath,20) if Path(fontpath).exists() else ImageFont.load_default(size=20)
    for index,line in enumerate(lines): draw.text((28,26+index*25),line,font=font,fill='#e6f0ff')
    image.save(capture)
    manifest=Path(manifest)
    manifest.write_text(json.dumps(dict(captured_at=captured_at,kind='actual-api-cli-usage',command=lines[1],platform=platform.platform(),binary_sha256=hashlib.sha256(Path(binary).read_bytes()).hexdigest(),capture_sha256=hashlib.sha256(capture.read_bytes()).hexdigest(),limitations='isolated foundation plus volatile local test S3/provider peers; no live AWS/provider, SigV4 conformance or weather parity'),indent=2)+'\n')
    styles=getSampleStyleSheet();styles['Heading2'].keepWithNext=True;styles.add(ParagraphStyle(name='CodeSmall',fontName='Courier',fontSize=8,leading=11,spaceAfter=10));styles['BodyText'].fontSize=10;styles['BodyText'].leading=14;styles.add(ParagraphStyle(name='BulletSmall',parent=styles['BodyText'],leftIndent=12,bulletIndent=0,spaceAfter=8))
    story=[];pending=[];code=[];table=[];in_code=False
    def flush():
        if pending:
            text=' '.join(pending);bullet=text.startswith('- ')
            story.append(Paragraph(escape(text[2:] if bullet else text),styles['BulletSmall' if bullet else 'BodyText'],bulletText='-' if bullet else None));story.append(Spacer(1,8));pending.clear()
    def flush_table():
        if table:
            t=Table([[Paragraph(escape(cell),styles['BodyText']) for cell in row] for row in table],colWidths=[210,95,165],repeatRows=1)
            t.setStyle(TableStyle([('BACKGROUND',(0,0),(-1,0),colors.HexColor('#dae6f2')),('VALIGN',(0,0),(-1,-1),'TOP'),('GRID',(0,0),(-1,-1),0.3,colors.HexColor('#b8c8d8')),('BOTTOMPADDING',(0,0),(-1,-1),7)]));story.append(t);story.append(Spacer(1,10));table.clear()
    for line in source.read_text().splitlines():
        if line.startswith('```'):
            flush();flush_table()
            if in_code: story.append(Preformatted('\n'.join(code),styles['CodeSmall']));code.clear()
            in_code=not in_code;continue
        if in_code: code.append(line);continue
        if line.startswith('|'):
            flush()
            if not re.fullmatch(r'[| :\-]+',line): table.append([c.strip() for c in line.strip('|').split('|')])
            continue
        flush_table()
        if line.startswith('#'):
            flush();level=len(line)-len(line.lstrip('#'));story.append(Paragraph(escape(line[level:].strip()),styles['Title' if level==1 else 'Heading2']));continue
        if line.startswith('- '):
            flush();pending.append(re.sub(r'\[([^]]+)\]\([^)]+\)',r'\1',line).replace('`','').replace('**',''));continue
        if not line.strip():flush()
        else:pending.append(re.sub(r'\[([^]]+)\]\([^)]+\)',r'\1',line).replace('`','').replace('**',''))
    flush();flush_table()
    story.append(Spacer(1,12));story.append(PDFImage(str(capture),width=470,height=470*height/width))
    def footer(canvas,doc):canvas.setFont('Helvetica',8);canvas.drawString(42,28,'S03 infrastructure | Local validation only | '+captured_at);canvas.drawRightString(550,28,str(doc.page))
    SimpleDocTemplate(str(pdf),pagesize=(595,842),leftMargin=42,rightMargin=42,topMargin=38,bottomMargin=45).build(story,onFirstPage=footer,onLaterPages=footer)

if __name__=='__main__':
    p=argparse.ArgumentParser(description=__doc__)
    for name in ['source','log','pdf','capture','manifest','binary']:p.add_argument('--'+name,required=True)
    p.add_argument('--captured-at',default='2026-10-06',help='Explicit actual capture date YYYY-MM-DD; historical default retained')
    a=p.parse_args();render(a.source,a.log,a.pdf,a.capture,a.manifest,a.binary,a.captured_at)
