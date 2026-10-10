"""Render the maintained S09 manual and actual redacted release CLI stdout.

Requires reportlab/Pillow. Derived from the maintained S07/S06 renderers; original MIT repository provenance retained. Run from repo root with --log an actual smoke log, or --pdf-only to preserve the historical capture.
The supplied log is verification input, not an executable command.
"""
import argparse
import hashlib
from html import escape
import json
import platform
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
DOC = ROOT/'docs/operations/server2-feasibility.md'
PDF = DOC.with_suffix('.pdf')
EVIDENCE = ROOT/'docs/evidence/tasks/server2-feasibility'


def digest(path): return hashlib.sha256(Path(path).read_bytes()).hexdigest()


def render_pdf(capture):
    styles=getSampleStyleSheet();styles["Heading2"].keepWithNext=1;styles.add(ParagraphStyle(name='S09Body',fontName='Helvetica',fontSize=9,leading=12,spaceAfter=7));styles.add(ParagraphStyle(name='S09Code',fontName='Courier',fontSize=7.2,leading=10,spaceAfter=8))
    story=[];in_code=False;code=[];paragraph=[]
    def flush():
        if paragraph:
            content=escape(' '.join(paragraph));content=re.sub(r'\[([^\]]+)\]\(([^)]+)\)',r'<link href="\2" color="#1d4ed8">\1</link>',content);content=re.sub(r'`([^`]+)`',r'<font name="Courier">\1</font>',content)
            story.append(Paragraph(content,styles['S09Body']));paragraph.clear()
    for line in DOC.read_text().splitlines():
        if line.startswith('```'):
            flush()
            if in_code: story.append(Preformatted('\n'.join(code),styles['S09Code']));code=[]
            in_code=not in_code;continue
        if in_code:code.append(line);continue
        if line.startswith('# '):flush();story.append(Paragraph(escape(line[2:]),styles['Title']))
        elif line.startswith('## '):flush();story.append(Paragraph(escape(line[3:]),styles['Heading2']))
        elif not line.strip():flush()
        else:paragraph.append(line.strip())
    with Image.open(capture) as capture_image:
        aspect = capture_image.height/capture_image.width
    flush();story.append(Spacer(1,8));story.append(Paragraph('Actual local CLI usage',styles['Heading2']));story.append(PdfImage(str(capture),width=6.5*inch,height=aspect*6.5*inch))
    def footer(canvas,doc):
        canvas.setFont('Helvetica',8);canvas.setFillColor(colors.HexColor('#475569'));canvas.drawString(48,28,'S09 tooling | actual host/AWS/O2/O5 gates pending');canvas.drawRightString(564,28,str(doc.page))
    document=SimpleDocTemplate(str(PDF),pagesize=(612,792),leftMargin=48,rightMargin=48,topMargin=42,bottomMargin=48,title='S09 bounded feasibility operations',author='TodayWeather',invariant=1)
    document.build(story,onFirstPage=footer,onLaterPages=footer)
    return document.page


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--log')
    parser.add_argument('--pdf-only', action='store_true', help='Refresh documentation using the unchanged historical actual CLI capture')
    parser.add_argument('--report')
    parser.add_argument('--command', default='python3 server2/tools/benchmark/run.py --output reports/s09-local.json')
    parser.add_argument('--capture-date', default='2026-10-08')
    args = parser.parse_args()
    if args.pdf_only:
        manifest_path = EVIDENCE/'manifest.json'
        manifest = json.loads(manifest_path.read_text())
        capture = EVIDENCE/'usage.png'
        if digest(capture) != manifest['screenshot_sha256']:
            raise ValueError('historical actual capture hash mismatch')
        manifest['pages'] = render_pdf(capture)
        manifest['source_sha256'] = digest(DOC)
        manifest['pdf_sha256'] = digest(PDF)
        manifest['documentation_refresh'] = {
            'date': '2026-10-10',
            'scope': 'Q9 R1/R2/R3/R4 documentation; historical actual CLI capture and measurement provenance unchanged',
            'operator_sha256': digest(ROOT/'server2/deploy/benchmark/aws_operator.py')}
        manifest_path.write_text(json.dumps(manifest, indent=2)+'\n')
        print('Manual PDF and documentation hashes refreshed; historical CLI capture preserved')
        return
    if not args.log or not args.report:
        parser.error('--log and --report are required unless --pdf-only is selected')
    log = Path(args.log).resolve()
    if not log.is_relative_to(ROOT/'reports') or log.stat().st_size > 16384:
        raise ValueError('only bounded task reports stdout is accepted')
    output = log.read_text()
    report_path=Path(args.report).resolve()
    if not report_path.is_relative_to(ROOT/'reports') or report_path.stat().st_size>8*1024*1024:
        raise ValueError('only bounded task report JSON accepted')
    report=json.loads(report_path.read_bytes())
    binary=ROOT/'server2/target/release/server2-feasibility'
    if report['runner_provenance']['binary_sha256']!=digest(binary) or not report['runner_provenance']['files_unchanged_during_execution']:
        raise ValueError('smoke report binary provenance mismatch')
    if 'PASS: bounded report, all outcome denominators and terminal archive fences' not in output or any(x in output for x in ('X-Amz-', 'Authorization:', 'secret=')):
        raise ValueError('expected successful redacted actual smoke stdout')
    EVIDENCE.mkdir(parents=True, exist_ok=True)
    font_paths = ['/System/Library/Fonts/Menlo.ttc','/usr/share/fonts/truetype/dejavu/DejaVuSansMono.ttf']
    font = next((ImageFont.truetype(p, 19) for p in font_paths if Path(p).exists()),ImageFont.load_default())
    lines=textwrap.wrap('$ '+args.command, width=105)+['']
    for line in output.strip().splitlines(): lines.extend(textwrap.wrap(line, width=105) or [''])
    image = Image.new('RGB',(1400,90+len(lines)*29),'#111827')
    draw = ImageDraw.Draw(image)
    draw.text((35,24),'S09 - actual release HTTP smoke | loopback only',font=font,fill='#93c5fd')
    for i,line in enumerate(lines): draw.text((35,70+i*29),line,font=font,fill='#d1fae5' if line.startswith('PASS') else '#e5e7eb')
    capture=EVIDENCE/'usage.png';image.save(capture)
    pages = render_pdf(capture)
    manifest={'pages':pages,'schema':1,'task':'S09','date':args.capture_date,'command':args.command,'environment':'Rust1.99/'+platform.system()+', public Python loopback peer','scope':'Actual local release cold/warm/funded HTTP report, low sample count; not AWS/auth/API parity or host go','captured_stdout':output.strip().splitlines(),'binary_sha256':digest(binary),'requested_config_sha256':report['requested_config_sha256'],'effective_config_sha256':report['runner_provenance']['effective_config_sha256'],'report_sha256':digest(report_path),'live_driver_sha256':digest(ROOT/'server2/tools/benchmark/aws.rs'),'operator_sha256':digest(ROOT/'server2/deploy/benchmark/aws_operator.py'),'source_sha256':digest(DOC),'pdf_sha256':digest(PDF),'screenshot_sha256':digest(capture)}
    (EVIDENCE/'manifest.json').write_text(json.dumps(manifest,indent=2)+'\n')
    print('Manual PDF, actual stdout capture and hash manifest generated')

if __name__=='__main__': main()
