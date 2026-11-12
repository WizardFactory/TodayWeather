#!/usr/bin/env python3
"""Require every declared comparison in successful Gradle JUnit XML, not just on disk."""
import json
from pathlib import Path
import re
import sys
import xml.etree.ElementTree as ET

ANDROID = Path(__file__).resolve().parents[2]


def verify_results(directory, manifest):
    expected = {
        (name, size + '/' + case['tolerance'].replace('{lang}', lang))
        for name, entry in manifest['sets'].items()
        for size in manifest['sizes'] for lang in manifest['languages']
        for case in entry['cases']
    }
    seen, problems = set(), []
    for file in sorted(Path(directory).glob('TEST-*.xml')):
        try:
            suite = ET.parse(file).getroot()
        except (ET.ParseError, OSError) as error:
            problems.append(f'{file.name}: {error}')
            continue
        class_name = suite.get('name', '').split('.')[-1]
        owned = {name for name, entry in manifest['sets'].items() if class_name in entry['testSuites']}
        if not owned:
            continue
        if any(int(suite.get(key, '0')) for key in ('failures', 'errors', 'skipped')):
            problems.append(f'{class_name}: failed, errored or skipped tests')
        for line in (suite.findtext('system-out') or '').splitlines():
            match = re.match(r'([a-z]+)-compare (\S+) .*ImageDiff\(', line)
            if not match or match[2].startswith('historical/'):
                continue
            key = (match[1], match[2])
            if key[0] not in owned:
                problems.append(f'{class_name}: output belongs to another suite: {key}')
            elif key not in expected:
                problems.append(f'undeclared comparison: {key}')
            else:
                seen.add(key)
    missing = sorted(expected - seen)
    problems.extend(f'missing executed comparison: {name}/{case}' for name, case in missing)
    return {'expected': len(expected), 'observed': len(seen), 'problems': problems}


if __name__ == '__main__':
    manifest = json.loads((Path(__file__).parent / 'coverage.json').read_text())
    result = verify_results(Path(sys.argv[1]) if len(sys.argv) > 1 else ANDROID / 'app/build/test-results/testDebugUnitTest', manifest)
    print(f"reported comparisons: {result['observed']}/{result['expected']}")
    for problem in result['problems'][:15]:
        print(problem)
    if len(result['problems']) > 15:
        print(f"... {len(result['problems']) - 15} more problems")
    sys.exit(bool(result['problems']))
