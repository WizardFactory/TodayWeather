#!/usr/bin/env python3
"""Check the native manual's source, retained images, PDF text and source provenance.

Uses the screenshot-manual skill's Python dependencies. Does not capture or publish.
Visual inspection remains a separate required check.
"""
import argparse
import hashlib
import json
from pathlib import Path
from PIL import Image
from pypdf import PdfReader


def sha(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def require(condition, message):
    if not condition:
        raise ValueError(message)


def verify(directory, repo):
    directory, repo = directory.resolve(), repo.resolve()
    source = json.loads((directory / 'manual.json').read_text())
    provenance = json.loads((directory / 'provenance.json').read_text())
    steps = source['steps']
    require(steps and len({s['screenshot'] for s in steps}) == len(steps), 'duplicate/empty steps')
    require(set(provenance['screenshots']) == {s['screenshot'] for s in steps}, 'image inventory differs')
    for step in steps:
        for field in ('title', 'instruction', 'caption', 'expected', 'screenshot'):
            require(isinstance(step[field], str) and step[field].strip(), f'missing {field}')
        path = (directory / step['screenshot']).resolve()
        require(path.is_relative_to(directory), 'escaping image path')
        record = provenance['screenshots'][step['screenshot']]
        require(sha(path) == record['sha256'], f'image changed: {path.name}')
        with Image.open(path) as image:
            require(list(image.size) == record['size'], f'image dimensions: {path.name}')
            require(image.width >= 720, f'image too small: {path.name}')
            image.verify()
    require(sha(directory / 'manual.json') == provenance['manual_sha256'], 'source changed')
    require(sha(directory / 'manual.pdf') == provenance['pdf_sha256'], 'PDF changed')
    pages = PdfReader(directory / 'manual.pdf').pages
    require(len(pages) == len(steps), 'page count differs')
    normalized = lambda s: ''.join(s.split())
    for i, (page, step) in enumerate(zip(pages, steps), 1):
        text = normalized(page.extract_text())
        for field in ('title', 'instruction', 'caption', 'expected'):
            require(normalized(step[field]) in text, f'page {i} missing {field}')
        # The builder embeds one lossless screenshot per page. Compare decoded
        # pixels, independent of PNG/PDF encodings and provenance hash updates.
        embedded = list(page.images)
        require(len(embedded) == 1, f'page {i} must contain one screenshot')
        with Image.open(directory / step['screenshot']) as screenshot:
            expected = screenshot.convert('RGB')
            actual = embedded[0].image.convert('RGB')
            require(actual.size == expected.size and actual.tobytes() == expected.tobytes(),
                    f'page {i} PDF image differs from {step["screenshot"]}')
    for name, expected in provenance['sources'].items():
        path = (repo / name).resolve()
        require(path.is_relative_to(repo) and path.is_file(), f'missing source: {name}')
        require(sha(path) == expected, f'capture source changed: {name}')
    print(f'{len(steps)} steps/images/pages: hashes, dimensions, text, embedded images and {len(provenance["sources"])} capture sources match')


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('directory', type=Path)
    parser.add_argument('--repo', type=Path, default=Path(__file__).resolve().parents[3])
    args = parser.parse_args()
    verify(args.directory, args.repo)
