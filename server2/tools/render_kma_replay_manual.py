#!/usr/bin/env python3
"""Render the maintained replay manual and a capture of an actual sanitized report."""
import argparse
from datetime import datetime
import hashlib
import json
from pathlib import Path
import re
from xml.sax.saxutils import escape
from PIL import Image, ImageDraw, ImageFont
from reportlab.lib.styles import getSampleStyleSheet
from reportlab.platypus import SimpleDocTemplate, Paragraph, Spacer, Preformatted, Image as PdfImage
import render_gateway_manual as markup

ROOT = Path(__file__).resolve().parents[2]
SOURCE = ROOT / 'docs/operations/server2-kma-replay.md'
EVIDENCE = ROOT / 'docs/evidence/tasks/issue-2742-s15b4b3'


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--report', type=Path, required=True)
    args = parser.parse_args()
    report = json.loads(args.report.read_text())
    if report['family'] != 'kma' or report['verdict'] != 'PASS' or report['unexplained_differences']:
        raise ValueError('an actual passing domestic replay report is required')
    stamp = datetime.fromisoformat(report['started_at_utc'])
    if stamp.tzinfo is None or stamp.utcoffset().total_seconds() != 0:
        raise ValueError('explicit UTC report timestamp required')
    EVIDENCE.mkdir(parents=True, exist_ok=True)
    selected = EVIDENCE / 'replay.json'
    selected.write_text(json.dumps(report, indent=2) + '\n')
    cases = report['workload']['requests']
    passes = report['workload']['passes']
    candidate = report['sides']['candidate']
    lines = ['S15b-4b3 CORE | ACTUAL OWNED-LOOPBACK DEBUG HTTP',
             'UTC ' + report['started_at_utc'],
             'Grid/RSS/mid; rich inputs absent; NOT full domestic parity',
             f'{cases} unique cases x {len(passes)} phases = {cases * len(passes)} responses',
             'Exact status / body bytes / functional header union: PASS',
             'Unexplained differences: 0',
             'Legacy HTTP: %s | Provider HTTP: %s' % (candidate['legacy_requests'], candidate['provider_requests']),
             'Deliberate expected-body perturbation detected: %s differences' % report['self_check']['unexplained'], '']
    for phase in passes:
        metric = candidate['percentiles_ms'][phase + '_pass']
        lines.append('%s: p95 %.2f ms (%s)' % (phase, metric['p95'], metric['n']))
    lines += ['', 'Debug example using production Gateway router / injected dependencies',
              'Not AWS/EC2 latency, production startup, live shadow or rollback evidence',
              '98 assembly-only cases remain separate; rich-input increment pending']
    fontpath = next((p for p in ('/System/Library/Fonts/Menlo.ttc', '/usr/share/fonts/truetype/dejavu/DejaVuSansMono.ttf') if Path(p).is_file()), None)
    font = ImageFont.truetype(fontpath, 18) if fontpath else ImageFont.load_default(size=18)
    width = max(1100, int(max(font.getlength(line) for line in lines)) + 48)
    image = Image.new('RGB', (width, 48 + 29 * len(lines)), '#101924')
    draw = ImageDraw.Draw(image)
    for row, line in enumerate(lines):
        draw.text((24, 24 + 29 * row), line, font=font, fill='#e3edf7')
    screenshot = EVIDENCE / 'replay.png'
    image.save(screenshot)
    styles = getSampleStyleSheet()
    styles['Normal'].fontSize = 9
    styles['Normal'].leading = 12
    styles['Code'].fontSize = 7
    styles['Code'].leading = 9
    markup.SOURCE = SOURCE
    blocks = []
    paragraph, code = [], None
    def flush():
        if paragraph:
            blocks.extend([Paragraph(markup.inline_markup(' '.join(paragraph), report['revision']['commit']), styles['Normal']), Spacer(1, 6)])
            paragraph.clear()
    for line in SOURCE.read_text().splitlines():
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
            blocks.append(Paragraph(escape(line[level:].strip()), styles['Title' if level == 1 else 'Heading2']))
        elif not line:
            flush()
        elif line.startswith('|'):
            flush()
            if not re.fullmatch(r'[| :\-]+', line):
                blocks.append(Paragraph(escape(' / '.join(c.strip() for c in line.strip('|').split('|'))), styles['Normal']))
        else:
            paragraph.append(line)
    flush()
    if code is not None:
        raise ValueError('unclosed source code block')
    blocks.extend([Paragraph('Actual core replay result capture', styles['Heading2']),
                   PdfImage(str(screenshot), width=510, height=image.height * 510 / image.width)])
    def footer(canvas, document):
        canvas.setFont('Helvetica', 7)
        canvas.drawString(40, 23, 'S15b-4b3 core | actual local debug receipt | ' + report['started_at_utc'])
        canvas.drawRightString(570, 23, str(document.page))
    pdf = SOURCE.with_suffix('.pdf')
    SimpleDocTemplate(str(pdf), pagesize=(612, 792), leftMargin=40, rightMargin=40,
                      topMargin=34, bottomMargin=38, title='Domestic canonical S3 core replay',
                      author='TodayWeather', invariant=1).build(blocks, onFirstPage=footer, onLaterPages=footer)
    hashes = {str(p.relative_to(ROOT)): hashlib.sha256(p.read_bytes()).hexdigest() for p in (SOURCE, pdf, screenshot, selected)}
    (EVIDENCE / 'capture.json').write_text(json.dumps({'schema': 1, 'capture_kind': 'Actual sanitized replay report rendered as result capture',
        'started_at_utc': report['started_at_utc'], 'hashes': hashes, 'limitations': report['limitations']}, indent=2) + '\n')
    print('Rendered manual PDF and actual replay result capture')


if __name__ == '__main__':
    main()
