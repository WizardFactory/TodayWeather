#!/usr/bin/env python3
"""Render maintained S08 manual and actual CLI output. Explicit verified UTC receipt input."""
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
from reportlab.platypus import SimpleDocTemplate, Paragraph, Spacer, Preformatted, KeepTogether, Image as PdfImage

ROOT = Path(__file__).resolve().parents[2]
SOURCE = ROOT / 'docs/operations/server2-provider-budgets.md'
PDF = SOURCE.with_suffix('.pdf')
EVIDENCE = ROOT / 'docs/evidence/tasks/server2-provider-budgets'


def receipt(log, stamp):
    when = datetime.fromisoformat(stamp)
    if when.tzinfo is None or when.utcoffset().total_seconds() != 0:
        raise ValueError('capture timestamp must be explicit UTC')
    if not log.startswith('execution started UTC ' + stamp + '\n'):
        raise ValueError('timestamp does not match actual execution receipt')
    if 'observed peer counters: 8 provider requests, 18 charged units, 8 witnesses; PASS' not in log:
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
                target = 'https://github.com/WizardFactory/TodayWeather/blob/' + revision + '/' + path.relative_to(ROOT).as_posix()
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
    if not log_path.is_relative_to(ROOT / 'reports/sdlc/issue-2693-s08') or not binary.is_relative_to(ROOT / 'server2/target'):
        raise ValueError('only owned task receipt and build binary are accepted')
    raw = log_path.read_bytes()
    text = raw.decode('utf-8')
    stamp = receipt(text, args.captured_at).isoformat(timespec='seconds')
    EVIDENCE.mkdir(parents=True, exist_ok=True)
    font = ImageFont.load_default(size=20)
    lines = ['S08 ACTUAL LOCAL RELEASE EXECUTION', 'UTC ' + stamp,
             '$ python3.11 server2/tests/budget/peer.py --binary',
             '  server2/target/release/examples/provider_budgets_smoke', ''] + text.splitlines()[1:]
    # Actual terminal output rendered verbatim; never compose expected outcomes as a receipt.
    image = Image.new('RGB', (1600, 100 + 34 * len(lines)), '#101924')
    draw = ImageDraw.Draw(image)
    for row, line in enumerate(lines):
        draw.text((32, 32 + 34 * row), line, font=font, fill='#e3edf7')
    screenshot = EVIDENCE / 'usage.png'
    image.save(screenshot)
    revision = subprocess.check_output(['git', '-C', str(ROOT), 'rev-parse', 'HEAD'], text=True).strip()
    if not re.fullmatch('[0-9a-f]{40}', revision):
        raise ValueError('manual links require an exact repository revision')
    styles = getSampleStyleSheet()
    styles['Normal'].fontSize = 9
    styles['Normal'].leading = 12
    styles['Code'].fontSize = 7.5
    styles['Code'].leading = 10
    blocks, paragraph, code = [], [], None
    def flush():
        if paragraph:
            blocks.append(Paragraph(inline_markup(' '.join(paragraph), revision), styles['Normal']))
            blocks.append(Spacer(1, 6))
            paragraph.clear()
    for line in SOURCE.read_text().splitlines():
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
    if code is not None:
        raise ValueError('unclosed manual code block')
    blocks.append(KeepTogether([Paragraph('Actual execution receipt', styles['Heading2']),
        PdfImage(str(screenshot), width=510, height=image.height * 510 / image.width)]))
    def footer(canvas, document):
        canvas.setFont('Helvetica', 7)
        canvas.setFillColor(colors.HexColor('#4c5663'))
        canvas.drawString(40, 23, 'S08 synthetic local evidence | UTC ' + stamp)
        canvas.drawRightString(570, 23, str(document.page))
    SimpleDocTemplate(str(PDF), pagesize=(612,792), rightMargin=40, leftMargin=40,
                      topMargin=34, bottomMargin=38, title='server2 provider budgets',
                      author='TodayWeather', invariant=1).build(blocks, onFirstPage=footer, onLaterPages=footer)
    manifest = {'schema':1,'captured_at_utc':stamp,
                'capture_kind':'terminal result rendered from actual isolated release execution',
                'environment':'macOS, release binary, synthetic loopback S3/provider peers',
                'command':'python3.11 server2/tests/budget/peer.py --binary server2/target/release/examples/provider_budgets_smoke',
                'observed':{'provider_requests':8,'charged_units':18,'witnesses':8},
                'execution_log_sha256':hashlib.sha256(raw).hexdigest(),
                'binary_sha256':hashlib.sha256(binary.read_bytes()).hexdigest(),
                'pdf_link_revision':revision,
                'source_sha256':hashlib.sha256(SOURCE.read_bytes()).hexdigest(),
                'pdf_sha256':hashlib.sha256(PDF.read_bytes()).hexdigest(),
                'screenshot_sha256':hashlib.sha256(screenshot.read_bytes()).hexdigest(),
                'limitations':'No live AWS/signature/IAM/provider quota/latency/API parity proof'}
    (EVIDENCE / 'manifest.json').write_text(json.dumps(manifest, indent=2) + '\n')
    print('rendered manual and actual terminal receipt at ' + stamp)


if __name__ == '__main__':
    main()
