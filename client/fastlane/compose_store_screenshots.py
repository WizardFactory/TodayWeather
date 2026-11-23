#!/usr/bin/env python3
"""Build the store screenshot package (#3122) from ad-free native captures and rewrite its manifest.

Play: each Android capture (android/tools/store/capture.sh) is cropped to the app's viewport (the status and
navigation bars removed, no pixel of the app changed) and placed in screenshot-frame.html with the locale's heading,
then rendered at 1080x1920 by headless Chromium and saved as JPEG.
App Store: each iOS capture (ios/tools/manual/run-manual-capture.sh --no-ads --store) is placed whole (the full native
frame as a rectangle, nothing cropped or masked, only its alpha channel dropped) in screenshot-frame-ios.html with the
Korean heading; the capture is scaled down to fit inside the frame's white border. The page is rendered at the
capture's own size (the display size the App Store asks for) and saved as an opaque PNG.

Usage (Pillow required; run from the repository root):
  python3 client/fastlane/compose_store_screenshots.py --out <new dir> --android <dir with device.txt, ko-KR/ en-US/ ja-JP/> \
      --crop-top N --crop-bottom N --iphone <raw dir> --ipad <raw dir> --chromium <chrome-headless-shell> \
      --commit <app source sha> --capture-commit <capture tooling sha> --captured-on <date>
Writes the whole package into --out, which must not exist yet, with the layout of client/fastlane:
metadata/android/<locale>/images/phoneScreenshots/0N-*.jpg, screenshots/ios/ko/{iphone69,ipad13}-0N-*.png and
screenshots/manifest.json. It never changes the maintained package: after inspecting the output, copy it over
client/fastlane (`cp -R <out>/. client/fastlane/`) and review `git diff`; Git holds the previous package. Every input
is checked first (the Android display from <android>/device.txt, each image's size, the crop).
"""
import argparse
import hashlib
import html
import json
import re
import subprocess
import tempfile
from pathlib import Path

from PIL import Image

FASTLANE = Path(__file__).resolve().parent
SCREENS = ["01-compare", "02-hourly", "03-daily", "04-air"]
# Play also shows the launcher page with the forecast and clock widgets and the one with the current and air widgets;
# the App Store shows one Home Screen with the widgets.
PLAY_SCREENS = SCREENS + ["05-widgets", "06-widgets"]
IOS_SCREENS = SCREENS + ["05-widgets"]
TEXT = {
    "ko-KR": ("ko", "오늘날씨", ["어제와 오늘을 한눈에", "시간별 날씨 변화", "일별 예보 확인", "미세먼지와 대기질",
                               "예보와 시계 위젯", "현재 날씨와 대기질 위젯"],
              "표시 정보는 지역과 자료 제공 상황에 따라 달라질 수 있습니다."),
    "en-US": ("en", "TodayWeather", ["Compare yesterday & today", "Follow hourly changes", "Check daily forecasts",
                                     "See air quality clearly", "Forecast & clock widgets", "Weather & air widgets"],
              "Information varies by region and data availability."),
    "ja-JP": ("ja", "今日天気", ["昨日と今日を比べる", "時間ごとの天気の変化", "日ごとの予報を確認", "空気質をひと目で",
                               "予報と時計のウィジェット", "天気と空気質のウィジェット"],
              "表示される情報は地域やデータ提供状況によって異なります。"),
}
# App Store display type, capture and output size, and the frame's unit in pixels (the Play frame is laid out in 1 px
# units on a 1080 px wide canvas; the iPhone canvas keeps that proportion, the wider iPad canvas uses a smaller one).
IOS = {"iphone69": ("APP_IPHONE_67", (1320, 2868), 1320 / 1080), "ipad13": ("APP_IPAD_PRO_3GEN_129", (2064, 2752), 1.5)}
# The App Store package has Korean screens only (the other locales fall back to them): the four app headings of Play's
# ko-KR set and one for the Home Screen with the widgets.
IOS_TEXT = ("ko", TEXT["ko-KR"][1], TEXT["ko-KR"][2][:4] + ["홈 화면 날씨 위젯"], TEXT["ko-KR"][3])


def sha(path):
    return hashlib.sha256(Path(path).read_bytes()).hexdigest()


def android_display(path):
    """The display of the Android run (device.txt of android/tools/store/capture.sh): size in pixels, density (an
    override wins over the physical value, as for the size) and the Android release from the build fingerprint."""
    text = path.read_text()
    sizes = re.findall(r"(?:Physical|Override) size: (\d+)x(\d+)", text)
    override = re.search(r"Override density: (\d+)", text)
    density = override or re.search(r"Physical density: (\d+)", text)
    release = re.search(r"^[^/\s]+/[^/]+/[^:]+:(\d+)/", text, re.M)
    if not sizes or not density or not release or "ads: off" not in text:
        raise SystemExit(f"{path}: no display size, density, build fingerprint or 'ads: off'")
    return tuple(int(v) for v in sizes[-1]), int(density.group(1)), release.group(1)


def opaque(shot, size):
    """The rendered page as an RGB image without transparency data; a render of another size stops the run."""
    with Image.open(shot) as rendered:
        if rendered.size != size:
            raise SystemExit(f"{shot}: rendered {rendered.size}, expected {size}")
        image = rendered.convert("RGB")
    image.info.pop("transparency", None)
    return image


def play(args, stage, work, files, display):
    template = (FASTLANE / "screenshot-frame.html").read_text()
    for locale, (lang, brand, headings, note) in TEXT.items():
        out_dir = stage / "metadata/android" / locale / "images/phoneScreenshots"
        out_dir.mkdir(parents=True)
        assert len(headings) == len(PLAY_SCREENS), locale
        for screen, heading in zip(PLAY_SCREENS, headings):
            raw = Path(args.android) / locale / f"store-{screen}.png"
            with Image.open(raw) as image:
                if image.size != display:
                    raise SystemExit(f"{raw}: {image.size} is not the run's display {display}")
                rgb = image.convert("RGB")
                view = rgb.crop((0, args.crop_top, rgb.width, rgb.height - args.crop_bottom))
            view_path = work / f"{locale}-{screen}.png"
            view.save(view_path)
            page = work / f"{locale}-{screen}.html"
            page.write_text(template.replace("{{LANG}}", lang).replace("{{BRAND}}", html.escape(brand))
                            .replace("{{HEADING}}", html.escape(heading)).replace("{{NOTE}}", html.escape(note))
                            .replace("{{ALT}}", html.escape(heading)).replace("{{IMAGE}}", view_path.name)
                            .replace("{{VIEW_WIDTH}}", str(view.width)).replace("{{VIEW_HEIGHT}}", str(view.height)))
            shot = work / f"{locale}-{screen}.render.png"
            subprocess.run([args.chromium, "--headless", "--hide-scrollbars", "--force-device-scale-factor=1",
                            "--window-size=1080,1920", f"--screenshot={shot}", page.as_uri()],
                           check=True, capture_output=True)
            out = out_dir / f"{screen}.jpg"
            opaque(shot, (1080, 1920)).save(out, quality=92, optimize=True)
            files.append({"file": str(out.relative_to(stage)), "platform": "android", "locale": locale,
                          "display_type": "phoneScreenshots", "width": 1080, "height": 1920, "sha256": sha(out),
                          "raw_source_sha256": sha(raw)})


def ios(args, stage, work, files):
    template = (FASTLANE / "screenshot-frame-ios.html").read_text()
    lang, brand, headings, note = IOS_TEXT
    assert len(headings) == len(IOS_SCREENS)
    out_dir = stage / "screenshots/ios/ko"
    out_dir.mkdir(parents=True)
    for prefix, source in (("iphone69", args.iphone), ("ipad13", args.ipad)):
        display, size, unit = IOS[prefix]
        for screen, heading in zip(IOS_SCREENS, headings):
            raw = Path(source) / f"store-{screen}.png"
            out = out_dir / f"{prefix}-{screen}.png"
            with Image.open(raw) as image:
                if image.size != size:
                    raise SystemExit(f"{raw}: {image.size}, expected {size}")
                view = image.convert("RGB")
            view.info.pop("transparency", None)
            view_path = work / f"{prefix}-{screen}.png"
            view.save(view_path)
            page = work / f"{prefix}-{screen}.html"
            page.write_text(template.replace("{{LANG}}", lang).replace("{{BRAND}}", html.escape(brand))
                            .replace("{{HEADING}}", html.escape(heading)).replace("{{NOTE}}", html.escape(note))
                            .replace("{{ALT}}", html.escape(heading)).replace("{{IMAGE}}", view_path.name)
                            .replace("{{WIDTH}}", str(size[0])).replace("{{HEIGHT}}", str(size[1]))
                            .replace("{{UNIT}}", f"{unit:.4f}")
                            .replace("{{VIEW_WIDTH}}", str(view.width)).replace("{{VIEW_HEIGHT}}", str(view.height)))
            shot = work / f"{prefix}-{screen}.render.png"
            subprocess.run([args.chromium, "--headless", "--hide-scrollbars", "--force-device-scale-factor=1",
                            f"--window-size={size[0]},{size[1]}", f"--screenshot={shot}", page.as_uri()],
                           check=True, capture_output=True)
            opaque(shot, size).save(out, optimize=True)
            files.append({"file": str(out.relative_to(stage)), "platform": "ios", "locale": "ko",
                          "display_type": display, "width": size[0], "height": size[1], "sha256": sha(out),
                          "raw_source_sha256": sha(raw)})


def main():
    parser = argparse.ArgumentParser()
    for name in ("--out", "--android", "--iphone", "--ipad", "--chromium", "--commit", "--capture-commit", "--captured-on",
                 "--version"):
        parser.add_argument(name, required=name != "--version")
    parser.add_argument("--crop-top", type=int, required=True)
    parser.add_argument("--crop-bottom", type=int, required=True)
    args = parser.parse_args()
    display, density, release = android_display(Path(args.android) / "device.txt")
    if args.crop_top < 0 or args.crop_bottom < 0 or args.crop_top + args.crop_bottom >= display[1]:
        raise SystemExit(f"crop {args.crop_top}/{args.crop_bottom} does not fit a {display[0]}x{display[1]} display")
    out = Path(args.out).resolve()
    if out.exists():
        raise SystemExit(f"{out} exists: give a new output directory")
    files = []
    out.parent.mkdir(parents=True, exist_ok=True)
    # Built beside the output (same file system), then renamed: the output directory appears only complete.
    with tempfile.TemporaryDirectory(dir=out.parent, prefix=f".{out.name}.") as tmp:
        stage, work = Path(tmp) / "stage", Path(tmp) / "work"
        work.mkdir()
        play(args, stage, work, files, display)
        ios(args, stage, work, files)
        write_manifest(args, stage, files, display, density, release)
        stage.rename(out)
    print(f"wrote {len(files)} images and screenshots/manifest.json to {out}")


def write_manifest(args, stage, files, display, density, release):
    manifest = {
        "captured_on": args.captured_on,
        "version": args.version or "2.0 native (Android 2.0.0, iOS 2.0.1 in the stores)",
        "source_base_commit": args.commit,
        "capture_tooling_commit": args.capture_commit,
        "source_state": "Debug builds of the native apps (app sources of source_base_commit) with private inputs, driven by "
                        "the capture tests and scripts of capture_tooling_commit; not the store binaries.",
        "selected_city": "Seoul (서울) saved; no current location.",
        "screens": ["comparison", "expanded hourly weather", "daily forecast", "air quality",
                    "home-screen widgets (Play: forecast and clock, then current weather and air quality)"],
        "devices": {
            "android": f"Disposable Android {release} AVD created by the run, display {display[0]}x{display[1]} at "
                       f"density {density}, freshly booted in each locale's system language",
            "ios_iphone": "iPhone 17 Pro Max simulator created by the run (Korean), iOS 26.5",
            "ios_ipad": "iPad Pro 13-inch (M5) simulator created by the run (Korean), iOS 26.5",
        },
        "composition": {
            "android": f"HTML marketing frame (screenshot-frame.html) around the actual screen with the status bar "
                       f"({args.crop_top} px) and navigation bar ({args.crop_bottom} px) removed: the app for 01-04, the "
                       f"launcher's home-screen pages with the pinned widgets for 05-06; UI/data not retouched.",
            "ios": "HTML marketing frame (screenshot-frame-ios.html) with the Korean heading around the full native "
                   "framebuffer (the app for 01-04, the Home Screen with the added widgets for 05), scaled down to fit "
                   "inside the frame's border, not cropped or masked; UI/data not retouched.",
        },
        "advertising": "Ad-free captures (#3122): Android NoAdsPlatform (test APK only), iOS build without ad units; "
                       "the shipped apps show ads.",
        "locale_fallbacks": {"android": ["de-DE", "zh-CN", "zh-TW"], "ios": ["en-US", "ja", "zh-Hans", "zh-Hant"]},
        "review_limit": "Live weather of the capture time; recapture if the visible UI changes.",
        "files": sorted(files, key=lambda f: f["file"]),
    }
    (stage / "screenshots").mkdir(parents=True, exist_ok=True)
    (stage / "screenshots/manifest.json").write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + "\n")


if __name__ == "__main__":
    main()
