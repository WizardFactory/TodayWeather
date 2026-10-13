#!/usr/bin/env python3
"""Render the S19 operations guide PDF and a terminal capture from an actual smoke.sh log.

Requires Pillow and reportlab. Reuses the S10 renderer's bounded Markdown link handling.
"""
import argparse
from datetime import datetime, timezone
import hashlib
import json
from pathlib import Path
import re
import subprocess
import sys
import textwrap

ROOT = Path(__file__).resolve().parents[3]
sys.path.insert(0, str(ROOT / 'server2/tools'))
import render_gateway_manual as base  # noqa: E402
from PIL import Image, ImageDraw, ImageFont  # noqa: E402
from reportlab.lib import colors  # noqa: E402
from reportlab.lib.styles import getSampleStyleSheet  # noqa: E402
from reportlab.platypus import (Image as PdfImage, KeepTogether, Paragraph, Preformatted,  # noqa: E402
                                SimpleDocTemplate, Spacer, Table, TableStyle)

SOURCE = ROOT / 'docs/operations/server2-smoke-shadow.md'
PDF = SOURCE.with_suffix('.pdf')
EVIDENCE = ROOT / 'docs/evidence/tasks/server2-smoke-shadow'
REQUIRED = ('PASS S19 integrated release smoke', 'PASS paired replay gateway', 'unexplained differences: 0',
            'PASS cache-aware rollback rehearsal gateway', 'PASS S19 integrated smoke (gateway)')


def capture_lines(text, stamp):
    """S19 stages of the actual log, with the checkout prefix removed and long lines wrapped."""
    lines = text.splitlines()
    start = next(i for i, line in enumerate(lines) if line.startswith('+ ') and 'tools/shadow/smoke.py' in line)
    if lines[start + 1] != 'execution started UTC ' + stamp:
        raise ValueError('capture timestamp does not match the actual S19 smoke receipt')
    for needle in REQUIRED:
        if not any(needle in line for line in lines[start:]):
            raise ValueError('required observation missing: ' + needle)
    out = []
    for line in lines[start:]:
        line = line.replace(str(ROOT) + '/', '')
        out.extend(textwrap.wrap(line, 132, subsequent_indent='      ') or [''])
    return out


def render_image(lines, stamp):
    font = ImageFont.load_default(size=20)
    head = ['S19 ACTUAL LOCAL RELEASE EXECUTION (gateway family)', 'UTC ' + stamp,
            '$ bash server2/deploy/smoke.sh --binary <release server2>', '']
    rows = head + lines
    width = max(1200, int(max(font.getlength(line) for line in rows)) + 64)
    image = Image.new('RGB', (width, 64 + 28 * len(rows)), '#101924')
    draw = ImageDraw.Draw(image)
    for row, line in enumerate(rows):
        fill = '#9be29b' if line.startswith('PASS') else '#f2c46d' if line.startswith('KNOWN GAP') else '#e3edf7'
        draw.text((32, 32 + 28 * row), line, font=font, fill=fill)
    EVIDENCE.mkdir(parents=True, exist_ok=True)
    path = EVIDENCE / 'usage.png'
    image.save(path)
    return path, image


def build_pdf(screenshot, image, stamp, revision):
    styles = getSampleStyleSheet()
    styles['Normal'].fontSize = 9
    styles['Normal'].leading = 12
    styles['Heading2'].keepWithNext = True
    styles['Heading3'].keepWithNext = True
    styles['Code'].fontSize = 7.5
    styles['Code'].leading = 10
    blocks, paragraph, code, rows = [], [], None, []

    def markup(text):
        return base.inline_markup(text, revision)

    def flush_table():
        if rows:
            cells = [[Paragraph(markup(cell), styles['Normal']) for cell in row] for row in rows]
            table = Table(cells, colWidths=[180, 352], repeatRows=1, hAlign='LEFT')
            table.setStyle(TableStyle([('VALIGN', (0, 0), (-1, -1), 'TOP'),
                                       ('BACKGROUND', (0, 0), (-1, 0), colors.HexColor('#edf2f7')),
                                       ('LINEBELOW', (0, 0), (-1, 0), 0.5, colors.HexColor('#a0aec0')),
                                       ('TOPPADDING', (0, 0), (-1, -1), 5), ('BOTTOMPADDING', (0, 0), (-1, -1), 5)]))
            blocks.extend([table, Spacer(1, 8)])
            rows.clear()

    def flush():
        if paragraph:
            blocks.extend([Paragraph(markup(' '.join(paragraph)), styles['Normal']), Spacer(1, 6)])
            paragraph.clear()

    for line in SOURCE.read_text().splitlines():
        if code is None and line.startswith('|'):
            flush()
            if not re.fullmatch(r'[| :\-]+', line):
                rows.append([cell.strip() for cell in line.strip('|').split('|')])
            continue
        flush_table()
        if line.startswith('```'):
            flush()
            if code is None:
                code = []
            else:
                blocks.extend([Preformatted('\n'.join(code), styles['Code']), Spacer(1, 8)])
                code = None
        elif code is not None:
            code.append(line)
        elif line.startswith('#'):
            flush()
            level = len(line) - len(line.lstrip('#'))
            style = {1: 'Title', 2: 'Heading2'}.get(level, 'Heading3')
            blocks.append(Paragraph(markup(line[level:].strip()), styles[style]))
        elif line.startswith('- '):
            flush()
            blocks.extend([Paragraph(markup(line[2:]), styles['Normal'], bulletText='-'), Spacer(1, 3)])
        elif not line:
            flush()
        else:
            paragraph.append(line)
    flush()
    flush_table()
    if code is not None:
        raise ValueError('unclosed code block in guide')
    blocks.append(KeepTogether([Paragraph('Actual execution receipt', styles['Heading2']),
                                PdfImage(str(screenshot), width=532, height=image.height * 532 / image.width)]))

    def footer(canvas, document):
        canvas.setFont('Helvetica', 7)
        canvas.setFillColor(colors.HexColor('#4c5663'))
        canvas.drawString(40, 23, 'S19 synthetic local evidence | UTC ' + stamp)
        canvas.drawRightString(572, 23, str(document.page))
    SimpleDocTemplate(str(PDF), pagesize=(612, 792), rightMargin=40, leftMargin=40, topMargin=34, bottomMargin=38,
                      title='server2 integrated smoke, paired replay and rollback rehearsal', author='TodayWeather',
                      invariant=1).build(blocks, onFirstPage=footer, onLaterPages=footer)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--log', required=True)
    parser.add_argument('--captured-at', required=True)
    parser.add_argument('--binary', required=True)
    parser.add_argument('--reports', required=True, help='directory holding the run JSON reports')
    args = parser.parse_args()
    log = Path(args.log).resolve()
    binary = Path(args.binary).resolve()
    reports = Path(args.reports).resolve()
    if not log.is_relative_to(ROOT / 'reports') or not reports.is_relative_to(ROOT / 'reports'):
        raise ValueError('only ignored task receipts under reports/ are accepted')
    when = datetime.fromisoformat(args.captured_at)
    if when.tzinfo is None or when.utcoffset().total_seconds() != 0:
        raise ValueError('capture timestamp must be explicit UTC')
    stamp = when.astimezone(timezone.utc).isoformat(timespec='seconds')
    raw = log.read_bytes()
    lines = capture_lines(raw.decode('utf-8'), stamp)
    screenshot, image = render_image(lines, stamp)
    revision = subprocess.check_output(['git', '-C', str(ROOT), 'rev-parse', 'HEAD'], text=True).strip()
    build_pdf(screenshot, image, stamp, revision)
    scenarios = json.loads((reports / 'scenarios.json').read_text())
    replay = json.loads((reports / 'replay-gateway.json').read_text())
    rollback = json.loads((reports / 'rollback-gateway.json').read_text())
    manifest = {
        'schema': 1, 'captured_at_utc': stamp,
        'capture_kind': 'terminal result rendered from an actual isolated release-binary smoke.sh execution',
        'environment': 'macOS, release binary, loopback recorded providers, frozen legacy origin, S03 local S3 peer',
        'command': 'bash server2/deploy/smoke.sh --binary <release server2>',
        'observed': {
            'scenarios': [s['id'] for s in scenarios['families']['gateway']['scenarios']],
            'peer_totals': scenarios['families']['gateway']['peer_totals'],
            'replay': {'unexplained': len(replay['unexplained_differences']), 'self_check': replay['self_check'],
                       'percentiles_ms': {side: replay['sides'][side]['percentiles_ms'] for side in replay['sides']},
                       'revision': replay['revision'], 'workload_sha256': replay['workload']['sha256']},
            'rollback_known_gaps': [g['id'] for p in rollback['phases'] for g in p.get('known_gaps', [])],
        },
        'execution_log_sha256': hashlib.sha256(raw).hexdigest(),
        'binary_sha256': hashlib.sha256(binary.read_bytes()).hexdigest(),
        'pdf_link_revision': revision,
        'new_file_link_policy': 'Repository-relative references rendered as text when absent from the pinned commit; Markdown keeps local clickable links',
        'source_sha256': hashlib.sha256(SOURCE.read_bytes()).hexdigest(),
        'pdf_sha256': hashlib.sha256(PDF.read_bytes()).hexdigest(),
        'screenshot_sha256': hashlib.sha256(screenshot.read_bytes()).hexdigest(),
        'limitations': 'Loopback fixtures only; no live provider/AWS/production latency/quota/shadow or cutover proof',
    }
    (EVIDENCE / 'manifest.json').write_text(json.dumps(manifest, indent=2, sort_keys=True) + '\n')
    print('rendered S19 guide PDF and actual terminal capture at ' + stamp)


if __name__ == '__main__':
    main()
