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


def verify(directory, repo):
    directory, repo = directory.resolve(), repo.resolve()
    source = json.loads((directory / 'manual.json').read_text())
    provenance = json.loads((directory / 'provenance.json').read_text())
    steps = source['steps']
    assert steps and len({s['screenshot'] for s in steps}) == len(steps), 'duplicate/empty steps'
    assert set(provenance['screenshots']) == {s['screenshot'] for s in steps}, 'image inventory differs'
    for step in steps:
        for field in ('title', 'instruction', 'caption', 'expected', 'screenshot'):
            assert isinstance(step[field], str) and step[field].strip(), f'missing {field}'
        path = (directory / step['screenshot']).resolve()
        assert path.is_relative_to(directory), 'escaping image path'
        record = provenance['screenshots'][step['screenshot']]
        assert sha(path) == record['sha256'], f'image changed: {path.name}'
        with Image.open(path) as image:
            assert list(image.size) == record['size'], f'image dimensions: {path.name}'
            assert image.width >= 720, f'image too small: {path.name}'
            image.verify()
    assert sha(directory / 'manual.json') == provenance['manual_sha256'], 'source changed'
    assert sha(directory / 'manual.pdf') == provenance['pdf_sha256'], 'PDF changed'
    pages = PdfReader(directory / 'manual.pdf').pages
    assert len(pages) == len(steps), 'page count differs'
    normalized = lambda s: ''.join(s.split())
    for i, (page, step) in enumerate(zip(pages, steps), 1):
        text = normalized(page.extract_text())
        for field in ('title', 'instruction', 'caption', 'expected'):
            assert normalized(step[field]) in text, f'page {i} missing {field}'
    for name, expected in provenance['sources'].items():
        path = (repo / name).resolve()
        assert path.is_relative_to(repo) and path.is_file(), f'missing source: {name}'
        assert sha(path) == expected, f'capture source changed: {name}'
    print(f'{len(steps)} steps/images/pages: hashes, dimensions, text and {len(provenance["sources"])} capture sources match')


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('directory', type=Path)
    parser.add_argument('--repo', type=Path, default=Path(__file__).resolve().parents[3])
    args = parser.parse_args()
    verify(args.directory, args.repo)
