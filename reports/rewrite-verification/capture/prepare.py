"""Stage current client assets for an isolated screenshot harness, without editing client/."""
import argparse
import json
from pathlib import Path
import plistlib
import shutil
import struct
import zlib

p = argparse.ArgumentParser()
p.add_argument('destination', type=Path)
p.add_argument('--product', choices=['todayWeather','todayAir'], default='todayWeather')
p.add_argument('--locale', default='ko-KR', help='navigator.language/languages override, e.g. en-US')
p.add_argument('--photo-feed', action='store_true', help='serve the synthetic weather-photo feed and point weatherPhotosUrl at it')
args = p.parse_args()
root = Path(__file__).resolve().parents[3]
dest = args.destination.resolve()
if dest.exists():
    raise SystemExit('Destination must not exist; choose a new isolated directory.')
dest.mkdir(parents=True)
shutil.copytree(root/'client/www',dest/'www')
shutil.copytree(root/'ta.ios/www/lib',dest/'www/lib')
shutil.copytree(root/'client/scss',dest/'scss')
(dest/'www/css').mkdir(exist_ok=True)
(dest/'evidence').mkdir()
for name in ['RenderCheck.swift','server.py','evaluate.py','inspect.js']:
    shutil.copy2(Path(__file__).with_name(name),dest/name)
harness=(Path(__file__).with_name('render-harness.js')).read_text().replace("var HARNESS_LOCALE = 'ko-KR';",f"var HARNESS_LOCALE = '{args.locale}';")
(dest/'www/render-harness.js').write_text(harness)
index=dest/'www/index.html'
index.write_text(index.read_text().replace('<head>','<head>\n<script src="render-harness.js"></script>'))
config=dest/'www/client.config.js'
config.write_text(config.read_text().replace("serverUrl : 'https://localhost'","serverUrl : 'http://127.0.0.1:8765'").replace('debug : true','debug : false').replace("package : 'todayWeather'",f"package : '{args.product}'"))
def gradient_png(path, top, bottom, w=400, h=700):
    # Synthetic stand-in for a weather photo; not real imagery.
    rows=b''.join(b'\x00'+bytes(int(top[i]*(1-y/(h-1))+bottom[i]*y/(h-1)) for i in range(3))*w for y in range(h))
    chunk=lambda tag,data:struct.pack('>I',len(data))+tag+data+struct.pack('>I',zlib.crc32(tag+data)&0xffffffff)
    path.write_bytes(b'\x89PNG\r\n\x1a\n'+chunk(b'IHDR',struct.pack('>IIBBBBB',w,h,8,2,0,0,0))+chunk(b'IDAT',zlib.compress(rows,9))+chunk(b'IEND',b''))
if args.photo_feed:
    (dest/'www/synthetic-photos').mkdir()
    gradient_png(dest/'www/synthetic-photos/sun-a.png',(40,110,200),(250,200,120))
    gradient_png(dest/'www/synthetic-photos/sun-b.png',(200,30,30),(90,0,0))
    shutil.copy2(root/'docs/rewrite/examples/weather-photos-feed.json',dest/'www/weather-photos.json')
    config.write_text(config.read_text().replace("weatherPhotosUrl : ''","weatherPhotosUrl : 'http://127.0.0.1:8765/weather-photos.json'"))
(dest/'www/cordova.js').write_text("// Test readiness only; no native bridge.\nwindow.addEventListener('load',function(){document.dispatchEvent(new Event('deviceready'))});\n")
for fixture,target in [('screenshot-weather.json','weather/v000903/coord/37.567,126.978'),('screenshot-nation.json','v000903/nation/KR'),('screenshot-special.json','v000903/kma/special')]:
    output=dest/'www'/target
    output.parent.mkdir(parents=True,exist_ok=True)
    shutil.copy2(root/'docs/rewrite/examples'/fixture,output)
app=dest/'RenderCheck.app';app.mkdir()
info={'CFBundleIdentifier':'local.todayweather.rendercheck','CFBundleName':'TW Render Check','CFBundleExecutable':'RenderCheck','CFBundlePackageType':'APPL','CFBundleVersion':'1','CFBundleShortVersionString':'1.0','LSRequiresIPhoneOS':True,'UILaunchScreen':{},'UIDeviceFamily':[1,2],'UISupportedInterfaceOrientations':['UIInterfaceOrientationPortrait'],'NSAppTransportSecurity':{'NSAllowsArbitraryLoads':True},'UIStatusBarHidden':True}
with (app/'Info.plist').open('wb') as f:plistlib.dump(info,f)
(dest/'package.json').write_text(json.dumps({'private':True,'devDependencies':{'sass':'1.93.2'}},indent=2)+'\n')
print(dest)
