"""Regenerate the screenshot gallery and README table from docs/rewrite/screenshots/manifest.json."""
import html
import json
from pathlib import Path
import re

root = Path(__file__).resolve().parents[3]
shots = root/'docs/rewrite/screenshots'
manifest = json.loads((shots/'manifest.json').read_text())

def order(item):
    sid = item['screen_id']
    group = {'S': 0, 'O': 1}.get(sid[:1], 2)
    number = int(re.sub(r'\D', '', sid) or 0)
    return (group, number, item['file'])

items = sorted(manifest, key=order)

def device(item):
    return f"{item['device']} · iOS {item['ios']}"

def variant(item):
    parts = [item['product'], item['locale'], item['theme']]
    if 'android' in item['host']:
        parts.append('Ionic android mode')
    return ' · '.join(parts)

figures = []
for item in items:
    note = item.get('notes') or item['fixture']
    figures.append(
        '<figure><a href="{f}"><img loading="lazy" src="{f}" alt="{t}"></a>'
        '<figcaption><b>{s} · {t}</b><p>{d}<br>{v}</p><small>{n}</small></figcaption></figure>'.format(
            f=html.escape(item['file']), t=html.escape(item['title']), s=html.escape(item['screen_id']),
            d=html.escape(device(item)), v=html.escape(variant(item)), n=html.escape(note)))

dates = sorted({item['captured_date'] for item in items})
page = (
    '<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">'
    '<title>TodayWeather / TodayAir — screen evidence</title><style>'
    'body{margin:0;background:#f3f5f8;color:#172333;font:16px/1.5 system-ui,sans-serif}header{padding:32px;max-width:1080px;margin:auto}'
    'h1{margin:0 0 12px;font-size:28px}p{margin:8px 0}a{color:#165eb7}main{display:grid;grid-template-columns:repeat(auto-fit,minmax(250px,1fr));'
    'gap:24px;padding:0 32px 40px;max-width:1500px;margin:auto}figure{margin:0;padding:18px;background:white;border:1px solid #dce3eb;border-radius:12px}'
    'img{width:100%;height:auto;display:block;border:1px solid #edf0f3}figcaption{padding-top:14px}small{color:#4c5d73;overflow-wrap:anywhere}</style>'
    '<header><h1>TodayWeather / TodayAir screen evidence</h1>'
    f'<p>Current web source in an iOS WKWebView test shell · {" and ".join(dates)} · {len(items)} captures. '
    'S = screen, O = overlay/dialog/loading state.</p>'
    '<p><strong>Synthetic weather, warning and photo data. These are not production observations or complete Cordova integration tests.</strong></p>'
    '<p><a href="../screen-specifications.md">Screen definitions</a> · <a href="../screen-overlays.md">Overlay definitions</a> · '
    '<a href="README.md">Provenance and limits</a> · <a href="manifest.json">Manifest</a></p></header><main>'
    + ''.join(figures) + '</main></html>\n')
(shots/'index.html').write_text(page)

rows = ['| ID | View | Device | Variant | Data |', '| --- | --- | --- | --- | --- |']
for item in items:
    rows.append('| {s} | [{t}]({f}) | {d} | {v} | {x} |'.format(
        s=item['screen_id'], t=item['title'], f=item['file'], d=f"{item['device']} / iOS {item['ios']}",
        v=variant(item), x=item['fixture']))
readme = shots/'README.md'
text = readme.read_text()
start, end = '<!-- capture-table:start -->', '<!-- capture-table:end -->'
if start not in text:
    raise SystemExit('README.md needs capture-table markers')
text = re.sub(re.escape(start) + r'.*?' + re.escape(end), start + '\n' + '\n'.join(rows) + '\n' + end, text, flags=re.S)
readme.write_text(text)
print(f'{len(items)} captures written to index.html and README.md')
