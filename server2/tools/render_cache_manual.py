#!/usr/bin/env python3
"""Render the maintained setup manual and an actual, sanitized cache measurement receipt."""
import argparse
from datetime import datetime
import hashlib
import json
from pathlib import Path
import re
import subprocess
from xml.sax.saxutils import escape
from PIL import Image, ImageDraw, ImageFont
from reportlab.lib import colors
from reportlab.lib.styles import getSampleStyleSheet
from reportlab.platypus import (SimpleDocTemplate, Paragraph, Spacer, Preformatted,
                               KeepTogether, Table, TableStyle, Image as PdfImage)
import render_gateway_manual as markup

ROOT = Path(__file__).resolve().parents[2]
SOURCE = ROOT / 'docs/operations/server2-infrastructure.md'
PDF = SOURCE.with_suffix('.pdf')
EVIDENCE = ROOT / 'docs/evidence/tasks/issue-2742-s15b4c'


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--measurement', type=Path, required=True)
    args = parser.parse_args()
    measured = json.loads(args.measurement.read_text())
    stamp = datetime.fromisoformat(measured['executed_at_utc'])
    if stamp.tzinfo is None or stamp.utcoffset().total_seconds() != 0:
        raise ValueError('measurement requires an explicit UTC execution timestamp')
    if 'owned-loopback' not in measured['scope']:
        raise ValueError('only isolated local measurement receipts are supported')
    phases = measured['native_http']
    if len(phases) != 3 or len({p['response_sha256'] for p in phases}) != 1:
        raise ValueError('actual equal native response receipts are required')
    EVIDENCE.mkdir(parents=True, exist_ok=True)
    measurement = EVIDENCE / 'cache-measurement.json'
    measurement.write_text(json.dumps(measured, indent=2) + '\n')
    lines = ['S15b-4c ACTUAL OWNED-LOOPBACK DEBUG HTTP', 'UTC ' + measured['executed_at_utc'],
             'Partial KMA inputs; no AWS/provider/GIF decode or production p95 claim', '']
    for p in phases:
        lines += [p['phase'], '  status=%s  response=%s B  elapsed=%.2f ms' %
                  (p['status'], p['response_bytes'], p['elapsed_ms']),
                  '  raw GET=%s  catalog GET=%s  legacy hops=%s' %
                  (p['raw_gets'], p['control_gets'], p['legacy_hops'])]
    lines += ['', 'SYNTHETIC IMAGE-SIZED RAW (not a valid GIF)',
              'raw=%s B  gzip=%s B' % (measured['raw']['raw_bytes'], measured['raw']['gzip_wire_bytes'])]
    for p in measured['raw']['phases']:
        lines += ['%s: %.2f ms, hits=%s, corrupt=%s, allocated=%s B' %
                  (p['phase'], p['elapsed_ms'], p['metrics']['hits'],
                   p['metrics']['corruptions'], p['metrics']['bytes'])]
    font_path = next((p for p in ('/System/Library/Fonts/Menlo.ttc',
                      '/usr/share/fonts/truetype/dejavu/DejaVuSansMono.ttf') if Path(p).is_file()), None)
    font = ImageFont.truetype(font_path, 19) if font_path else ImageFont.load_default(size=19)
    width = max(1100, int(max(font.getlength(line) for line in lines)) + 48)
    image = Image.new('RGB', (width, 48 + 29 * len(lines)), '#101924')
    draw = ImageDraw.Draw(image)
    for row, line in enumerate(lines):
        draw.text((24, 24 + 29 * row), line, font=font, fill='#e3edf7')
    screenshot = EVIDENCE / 'cache-measurement.png'
    image.save(screenshot)
    revision = subprocess.check_output(['git', '-C', str(ROOT), 'rev-parse', 'HEAD'], text=True).strip()
    markup.SOURCE = SOURCE
    styles = getSampleStyleSheet()
    styles['Normal'].fontSize = 9
    styles['Normal'].leading = 12
    styles['Normal'].allowWidows = styles['Normal'].allowOrphans = 0
    styles['Code'].fontSize = 7
    styles['Code'].leading = 9
    for name in ('Heading2', 'Heading3'):
        styles[name].keepWithNext = True
    blocks, paragraph, table, code = [], [], [], None
    def inline(value):
        return markup.inline_markup(value.replace('**', ''), revision)
    def flush():
        if paragraph:
            blocks.extend([Paragraph(inline(' '.join(paragraph)), styles['Normal']), Spacer(1, 6)])
            paragraph.clear()
    def flush_table():
        if table:
            n = len(table[0])
            obj = Table([[Paragraph(inline(cell), styles['Normal']) for cell in row] for row in table],
                        colWidths=[510 / n] * n, repeatRows=1, hAlign='LEFT')
            obj.setStyle(TableStyle([('VALIGN', (0,0),(-1,-1),'TOP'),
                         ('BACKGROUND',(0,0),(-1,0),colors.HexColor('#edf2f7')),
                         ('LINEBELOW',(0,0),(-1,0),.5,colors.grey),
                         ('TOPPADDING',(0,0),(-1,-1),5),('BOTTOMPADDING',(0,0),(-1,-1),5)]))
            blocks.extend([obj, Spacer(1,8)])
            table.clear()
    for line in SOURCE.read_text().splitlines():
        if code is None and line.startswith('|'):
            flush()
            if not re.fullmatch(r'[| :\-]+', line):
                table.append([cell.strip() for cell in line.strip('|').split('|')])
            continue
        flush_table()
        if line.startswith('```'):
            flush()
            if code is None:
                code = []
            else:
                blocks.extend([Preformatted('\n'.join(code), styles['Code']), Spacer(1,8)])
                code = None
        elif code is not None:
            code.append(line)
        elif line.startswith('#'):
            flush()
            level = len(line) - len(line.lstrip('#'))
            blocks.append(Paragraph(inline(line[level:].strip()), styles['Title' if level == 1 else 'Heading2' if level == 2 else 'Heading3']))
        elif not line:
            flush()
        else:
            paragraph.append(line)
    flush()
    flush_table()
    if code is not None:
        raise ValueError('unclosed source code block')
    blocks.append(KeepTogether([Paragraph('Actual local cache measurement', styles['Heading2']),
                               PdfImage(str(screenshot), width=510, height=image.height * 510 / image.width)]))
    def footer(canvas, document):
        canvas.setFont('Helvetica',7)
        canvas.drawString(40,23,'S15b-4c local debug receipt | UTC '+stamp.isoformat(timespec='seconds'))
        canvas.drawRightString(570,23,str(document.page))
    SimpleDocTemplate(str(PDF),pagesize=(612,792),leftMargin=40,rightMargin=40,
                      topMargin=34,bottomMargin=38,title='server2 setup and disposable cache capacity',
                      author='TodayWeather',invariant=1).build(blocks,onFirstPage=footer,onLaterPages=footer)
    tracked_runtime = ['server2/src/cache/disk.rs', 'server2/src/cache/mod.rs',
                       'server2/src/storage/store.rs', 'server2/src/storage/settings.rs',
                       'server2/src/storage/transport.rs', 'server2/src/world/air_store.rs']
    manifest = dict(schema=1, capture_kind='sanitized actual measurement JSON rendered as a result capture',
                    executed_at_utc=measured['executed_at_utc'], base_commit=revision,
                    runtime_source_sha256={p: hashlib.sha256((ROOT/p).read_bytes()).hexdigest() for p in tracked_runtime},
                    command='python3 server2/tools/kma_cache_measure.py --measure-binary <task build>/examples/kma_cache_measure --native-binary <task build>/examples/loopback_server --output <owned receipt>',
                    binary_sha256=measured['binary_sha256'],
                    measurement_sha256=hashlib.sha256(measurement.read_bytes()).hexdigest(),
                    source_sha256=hashlib.sha256(SOURCE.read_bytes()).hexdigest(),
                    pdf_sha256=hashlib.sha256(PDF.read_bytes()).hexdigest(),
                    capture_sha256=hashlib.sha256(screenshot.read_bytes()).hexdigest(),
                    limitations=measured['scope'],
                    link_policy='Relative Markdown links preserved; new files absent at pinned base render as relative references, not fabricated GitHub revision links')
    (EVIDENCE/'capture.json').write_text(json.dumps(manifest,indent=2)+'\n')
    print('Rendered setup PDF and actual cache measurement capture at '+stamp.isoformat())


if __name__ == '__main__':
    main()
