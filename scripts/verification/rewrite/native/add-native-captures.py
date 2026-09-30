"""Copy selected native-harness screenshots into docs/rewrite/screenshots and append manifest entries.

Usage: python3 add-native-captures.py <selection.json>
selection.json: [{"src": "<verify dir>/<png>", "file": "native-...png", "screen_id": "S03", "title": "...",
                  "state": "tab.forecast", "platform": "android"|"ios", "trigger": "...", "notes": "..."}]
Re-running replaces entries with the same file name.
"""
import hashlib
import json
import shutil
import struct
import sys
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parents[4]
SHOTS = ROOT/'docs/rewrite/screenshots'
PLATFORM = {
    'android': {'device': 'Pixel Fold emulator (folded)', 'android': '15 (API 35)', 'locale': 'en-US',
                'host': 'Cordova native debug build (cordova-android 15.1.0, Android System WebView)'},
    'ios': {'device': 'iPhone 17 Pro', 'ios': '26.5', 'locale': 'ko-KR',
            'host': 'Cordova native debug build (cordova-ios 8.1.1, WKWebView)'},
}
BASE = 'b8a3c504 + uncommitted PoC changes on branch review-cordova-ios-android-deployment (#2605)'

selection = json.loads(Path(sys.argv[1]).read_text())
manifest = json.loads((SHOTS/'manifest.json').read_text())
by_file = {item['file']: i for i, item in enumerate(manifest)}
for sel in selection:
    src = Path(sel['src'])
    dest = SHOTS/sel['file']
    shutil.copyfile(src, dest)
    data = dest.read_bytes()
    assert data[:8] == b'\x89PNG\r\n\x1a\n', src
    p = PLATFORM[sel['platform']]
    entry = {
        'file': sel['file'], 'screen_id': sel['screen_id'], 'title': sel['title'], 'state': sel['state'],
        'product': 'todayWeather', 'source_commit': BASE, 'captured_date': '2026-09-27',
        'capture_file_mtime_utc': datetime.fromtimestamp(src.stat().st_mtime, timezone.utc).isoformat(),
        'device': p['device'], **({'android': p['android']} if 'android' in p else {'ios': p['ios']}),
        'pixels': list(struct.unpack('>II', data[16:24])), 'locale': p['locale'], 'theme': sel.get('theme', 'light'),
        'fixture': 'live production API (2026-09-27)', 'host': p['host'], 'safe_area': True,
        'native_status_bar': 'shown', 'evidence_kind': 'emulator/simulator screenshot of a native debug build; live production API; harness-driven taps',
        'visual_review': 'inspected', 'sha256': hashlib.sha256(data).hexdigest(), 'acceptance_baseline': False,
        'trigger': sel['trigger'], 'notes': sel['notes'],
    }
    if sel['file'] in by_file:
        manifest[by_file[sel['file']]] = entry
    else:
        by_file[sel['file']] = len(manifest)
        manifest.append(entry)
(SHOTS/'manifest.json').write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + '\n')
print(f'{len(selection)} captures copied; manifest has {len(manifest)} entries')
