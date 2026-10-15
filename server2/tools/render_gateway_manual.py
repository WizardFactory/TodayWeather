#!/usr/bin/env python3
"""Render maintained S10 manual and actual CLI output. Explicit verified UTC receipt input."""
import argparse
from datetime import datetime, timezone
import hashlib
import json
from pathlib import Path
import re
import subprocess
from urllib.parse import urlsplit
from xml.sax.saxutils import escape

from PIL import Image, ImageDraw, ImageFont
from reportlab.lib import colors
from reportlab.lib.styles import getSampleStyleSheet
from reportlab.platypus import SimpleDocTemplate, Paragraph, Spacer, Preformatted, KeepTogether, Table, TableStyle, Image as PdfImage

ROOT = Path(__file__).resolve().parents[2]
SOURCE = ROOT / 'docs/operations/server2-gateway.md'
PDF = SOURCE.with_suffix('.pdf')
EVIDENCE = ROOT / 'docs/evidence/tasks/server2-gateway'


def receipt(log, stamp):
    when = datetime.fromisoformat(stamp)
    if when.tzinfo is None or when.utcoffset().total_seconds() != 0:
        raise ValueError('capture timestamp must be explicit UTC')
    if not log.startswith('execution started UTC ' + stamp + '\n'):
        raise ValueError('timestamp does not match actual execution receipt')
    if 'PASS S10 actual local release smoke; no live provider/AWS/quota or cutover claim' not in log:
        raise ValueError('required actual peer observation missing')
    return when.astimezone(timezone.utc)


def inline_markup(text, revision):
    """A bounded Markdown subset; escape all text, retain clickable valid link targets."""
    parts = []
    at = 0
    for match in re.finditer(r'`([^`]+)`|\[([^]\n]+)\]\(([^)\s]+)\)', text):
        parts.append(escape(text[at:match.start()]))
        code, label, target = match.groups()
        if code is not None:
            parts.append('<font name="Courier">' + escape(code) + '</font>')
        else:
            url = urlsplit(target)
            if url.scheme:
                if url.scheme not in ('http', 'https') or not url.netloc:
                    raise ValueError('unsupported manual link')
            else:
                if url.netloc:
                    raise ValueError('unsupported manual link')
                path = (SOURCE.parent / url.path).resolve()
                if not path.is_relative_to(ROOT) or not path.is_file():
                    raise ValueError('manual link outside maintained repository')
                relative = path.relative_to(ROOT).as_posix()
                exists_at_revision = subprocess.run(['git','-C',str(ROOT),'cat-file','-e',revision+':'+relative],stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL).returncode == 0
                if not exists_at_revision:
                    # New files have no immutable GitHub revision before this artifact's commit.
                    # Keep the maintained Markdown link, but render a useful relative reference
                    # rather than inventing a remote link to a revision lacking the file.
                    parts.append(escape(label + ' (' + target + ')'))
                    at = match.end()
                    continue
                target = 'https://github.com/WizardFactory/TodayWeather/blob/' + revision + '/' + relative
                if url.fragment:
                    target += '#' + url.fragment
            parts.append('<link href="' + escape(target, {'"':'&quot;'}) + '">' + escape(label) + '</link>')
        at = match.end()
    parts.append(escape(text[at:]))
    return ''.join(parts)

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--log', required=True)
    parser.add_argument('--captured-at', required=True)
    parser.add_argument('--binary', required=True)
    args = parser.parse_args()
    log_path = Path(args.log).resolve()
    binary = Path(args.binary).resolve()
    owned = [ROOT / 'reports/sdlc' / task for task in ('issue-2695-s10', 'issue-2736-s10c', 'issue-2753-s10e', 'issue-2759-s10f')]
    if not any(log_path.is_relative_to(path) for path in owned) or not binary.is_relative_to(ROOT / 'server2/target'):
        raise ValueError('only owned task receipt and build binary are accepted')
    raw = log_path.read_bytes()
    text = raw.decode('utf-8')
    stamp = receipt(text, args.captured_at).isoformat(timespec='seconds')
    EVIDENCE.mkdir(parents=True, exist_ok=True)
    font = ImageFont.load_default(size=24)
    lines = ['S10 ACTUAL LOCAL RELEASE EXECUTION', 'UTC ' + stamp,
             '$ python3 server2/tools/gateway_smoke.py --binary',
             '  server2/target/release/server2', ''] + text.splitlines()[1:]
    # Actual terminal output rendered verbatim; never compose expected outcomes as a receipt.
    image_width = max(1200, int(max(font.getlength(line) for line in lines)) + 64)
    image = Image.new('RGB', (image_width, 100 + 36 * len(lines)), '#101924')
    draw = ImageDraw.Draw(image)
    for row, line in enumerate(lines):
        draw.text((32, 32 + 36 * row), line, font=font, fill='#e3edf7')
    screenshot = EVIDENCE / 'usage.png'
    image.save(screenshot)
    revision = subprocess.check_output(['git', '-C', str(ROOT), 'rev-parse', 'HEAD'], text=True).strip()
    if not re.fullmatch('[0-9a-f]{40}', revision):
        raise ValueError('manual links require an exact repository revision')
    styles = getSampleStyleSheet()
    styles['Normal'].fontSize = 9
    styles['Normal'].leading = 12
    styles['Normal'].allowWidows = 0
    styles['Normal'].allowOrphans = 0
    styles['Heading2'].keepWithNext = True
    styles['Code'].fontSize = 7.5
    styles['Code'].leading = 10
    blocks, paragraph, code, table_rows = [], [], None, []
    def flush_table():
        if not table_rows:
            return
        rows = [[Paragraph(inline_markup(cell, revision), styles['Normal']) for cell in row] for row in table_rows]
        table = Table(rows, colWidths=[170, 340], repeatRows=1, hAlign='LEFT')
        table.setStyle(TableStyle([('VALIGN',(0,0),(-1,-1),'TOP'),('BACKGROUND',(0,0),(-1,0),colors.HexColor('#edf2f7')),('LINEBELOW',(0,0),(-1,0),0.5,colors.HexColor('#a0aec0')),('BOTTOMPADDING',(0,0),(-1,-1),6),('TOPPADDING',(0,0),(-1,-1),6),('LEFTPADDING',(0,0),(-1,-1),6),('RIGHTPADDING',(0,0),(-1,-1),6)]))
        blocks.append(table)
        blocks.append(Spacer(1,8))
        table_rows.clear()
    def flush():
        if paragraph:
            blocks.append(Paragraph(inline_markup(' '.join(paragraph), revision), styles['Normal']))
            blocks.append(Spacer(1, 6))
            paragraph.clear()
    for line in SOURCE.read_text().splitlines():
        if code is None and line.startswith('|'):
            flush()
            if not re.fullmatch(r'[| :\-]+', line):
                table_rows.append([cell.strip() for cell in line.strip('|').split('|')])
            continue
        flush_table()
        if line.startswith('```'):
            flush()
            if code is None:
                code = []
            else:
                blocks.append(Preformatted('\n'.join(code), styles['Code']))
                blocks.append(Spacer(1, 8))
                code = None
        elif code is not None:
            code.append(line)
        elif line.startswith('#'):
            flush()
            level = len(line) - len(line.lstrip('#'))
            blocks.append(Paragraph(inline_markup(line[level:].strip(), revision), styles['Title' if level == 1 else 'Heading2']))
        elif not line:
            flush()
        else:
            paragraph.append(line)
    flush()
    flush_table()
    if code is not None:
        raise ValueError('unclosed manual code block')
    blocks.append(KeepTogether([Paragraph('Actual execution receipt', styles['Heading2']),
        PdfImage(str(screenshot), width=510, height=image.height * 510 / image.width)]))
    def footer(canvas, document):
        canvas.setFont('Helvetica', 7)
        canvas.setFillColor(colors.HexColor('#4c5663'))
        canvas.drawString(40, 23, 'S10 synthetic local evidence | UTC ' + stamp)
        canvas.drawRightString(570, 23, str(document.page))
    SimpleDocTemplate(str(PDF), pagesize=(612,792), rightMargin=40, leftMargin=40,
                      topMargin=34, bottomMargin=38, title='server2 gateway and geocoding',
                      author='TodayWeather', invariant=1).build(blocks, onFirstPage=footer, onLaterPages=footer)
    manifest = {'schema':1,'captured_at_utc':stamp,
                'capture_kind':'terminal result rendered from actual isolated release execution',
                'environment':'macOS, release binary, synthetic loopback provider/backend/legacy-geocoder peers',
                'command':'python3 server2/tools/gateway_smoke.py --binary server2/target/release/server2',
                'observed':{'peer_counters':json.loads(next(line.split(': ',1)[1] for line in text.splitlines() if line.startswith('observed peer counters: ')))},
                'execution_log_sha256':hashlib.sha256(raw).hexdigest(),
                'binary_sha256':hashlib.sha256(binary.read_bytes()).hexdigest(),
                'pdf_link_revision':revision,
                'new_file_link_policy':'Repository-relative references rendered as text when absent from the pinned commit; Markdown keeps local clickable links',
                'source_sha256':hashlib.sha256(SOURCE.read_bytes()).hexdigest(),
                'pdf_sha256':hashlib.sha256(PDF.read_bytes()).hexdigest(),
                'screenshot_sha256':hashlib.sha256(screenshot.read_bytes()).hexdigest(),
                'limitations':'Synthetic loopback fixtures only; no live AWS/provider quota/production latency/cutover proof'}
    (EVIDENCE / 'manifest.json').write_text(json.dumps(manifest, indent=2) + '\n')
    print('rendered manual and actual terminal receipt at ' + stamp)


if __name__ == '__main__':
    main()
