#!/usr/bin/env python3
"""Check the resolved ad configuration of a TodayWeather distribution app without printing identifiers."""
import argparse
import plistlib
import re
import sys
from pathlib import Path


def check(info):
    if info.get("CFBundleIdentifier") != "net.wizardfactory.todayweather":
        raise ValueError("Unexpected app bundle identifier")
    app = re.fullmatch(r"(ca-app-pub-[0-9]{16})~[0-9]{10}", info.get("GADApplicationIdentifier", ""))
    if not app or app[1] in {"ca-app-pub-0000000000000000", "ca-app-pub-3940256099942544"}:
        raise ValueError("Release app ID is missing, malformed, a placeholder or a test ID")
    native = info.get("TWAdMobNativeUnit", "")
    interstitial = info.get("TWAdMobInterstitialUnit", "")
    banner = info.get("TWAdMobBannerUnit", "")
    for key, unit in (("TWAdMobNativeUnit", native), ("TWAdMobInterstitialUnit", interstitial),
                      ("TWAdMobBannerUnit", banner)):
        if not re.fullmatch(re.escape(app[1]) + r"/[0-9]{10}", unit):
            raise ValueError(f"{key} needs a release unit from the same publisher")
    if len({native, interstitial, banner}) != 3:
        raise ValueError("Native, interstitial and banner require distinct units")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("app", type=Path, help="TodayWeather.app in the archive or distribution export")
    args = parser.parse_args()
    try:
        with (args.app / "Info.plist").open("rb") as f:
            check(plistlib.load(f))
    except (OSError, ValueError, TypeError, plistlib.InvalidFileException) as error:
        parser.exit(1, f"Release ad configuration failed: {error}\n")
    print("Release ad configuration contains a production app ID and three distinct same-publisher units.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
