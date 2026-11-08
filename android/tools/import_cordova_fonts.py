#!/usr/bin/env python3
"""Copy the Ionicons font of the Cordova build into the Android app (AN-07, #2886).

  python3 android/tools/import_cordova_fonts.py <cordova-debug.apk>

The Cordova app draws its tab bar, header and menu glyphs with Ionicons 2.0.1 from Ionic 1.3.5, which Bower
installs from client/bower.json into client/www/lib (ignored by Git), so the font is taken from the Cordova
build that ships it:

  src/main/res/font/ionicons.ttf        assets/www/lib/ionic/fonts/ionicons.ttf of the APK
  provenance/cordova-fonts.json         APK and font hashes, versions and license

The Gradle build reads only the copy; ImportedClientAssetsTest checks its hash against the provenance record.
"""
import hashlib
import json
import sys
import zipfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
APP = ROOT / "android" / "app"
FONT = APP / "src" / "main" / "res" / "font" / "ionicons.ttf"
PROVENANCE = APP / "provenance" / "cordova-fonts.json"
ENTRY = "assets/www/lib/ionic/fonts/ionicons.ttf"
CSS = "assets/www/lib/ionic/css/ionic.css"


def sha256(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def main():
    if len(sys.argv) != 2:
        sys.exit("usage: import_cordova_fonts.py <cordova-debug.apk>")
    apk = Path(sys.argv[1])
    with zipfile.ZipFile(apk) as z:
        font = z.read(ENTRY)
        css = z.read(CSS).decode("utf-8", "replace")
    if "Ionicons, v2.0.1" not in css:
        sys.exit("the APK does not ship Ionicons 2.0.1")
    FONT.parent.mkdir(parents=True, exist_ok=True)
    FONT.write_bytes(font)
    PROVENANCE.write_text(json.dumps({
        "tool": "android/tools/import_cordova_fonts.py",
        "files": [{
            "source": f"{ENTRY} in the Cordova debug APK (Ionic 1.3.5 from client/bower.json)",
            "apk_sha256": sha256(apk.read_bytes()),
            "source_sha256": sha256(font),
            "output": FONT.relative_to(APP).as_posix(),
            "output_sha256": sha256(font),
            "version": "Ionicons 2.0.1",
            "license": "MIT (Ionicons, Drifty Co.)",
        }],
    }, indent=1) + "\n", encoding="utf-8")
    print(f"copied {ENTRY} ({len(font)} bytes); provenance in {PROVENANCE.relative_to(ROOT)}")


if __name__ == "__main__":
    main()
