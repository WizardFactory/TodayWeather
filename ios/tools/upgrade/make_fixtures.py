#!/usr/bin/env python3
"""Writes the synthetic storage fixtures of TWStorageTests (ios/Core/Tests/TWStorageTests/Fixtures).

    python3 ios/tools/upgrade/make_fixtures.py

The captured fixtures (containers/simulator, containers/device, suites/current.plist) come from a seeded Cordova
1.1.1 run on the iOS 26.5 simulator (README "Data migration from the Cordova app"); this script does not touch
them. It writes:
- containers/legacy: the single-directory WebKit layout (`WebsiteData/LocalStorage/app_localhost_0.localstorage`)
  holding an old state (guideVersion, standalone startupPage/refreshInterval, legacy pushData);
- containers/other-origin: the per-origin layout with only an `https://localhost` origin;
- suites/types.plist: one key per value type the plugin can store (string, number, boolean, data, and types it
  never writes);
- suites/v1.0.10.plist: a suite as an update straight from 1.0.10 has it (no settingsInfo, legacy pushData).
"""
import os
import plistlib
import shutil
import sqlite3
import struct

ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "..", "Core", "Tests", "TWStorageTests",
                    "Fixtures")


def item_table(path, items):
    if os.path.exists(path):
        os.remove(path)
    db = sqlite3.connect(path)
    db.execute("CREATE TABLE ItemTable (key TEXT UNIQUE ON CONFLICT REPLACE, value BLOB NOT NULL ON CONFLICT FAIL)")
    for key, value in items:
        db.execute("INSERT INTO ItemTable VALUES (?, ?)", (key, value.encode("utf-16-le")))
    db.commit()
    db.close()


def origin_file(scheme, host):
    def string(s):
        return struct.pack("<IB", len(s), 1) + s.encode("latin-1")
    one = string(scheme) + string(host) + b"\x00"
    return one + one


LEGACY_CITIES = ('[{"currentPosition":true,"address":"대한민국 서울특별시 중구 명동","location":{"lat":37.5636,'
                 '"long":126.9826},"disable":false,"currentWeather":{"t1h":3}},{"currentPosition":false,'
                 '"name":"부산","address":"대한민국 부산광역시","location":{"lat":35.18,"long":129.07},"disable":false}]')
LEGACY_PUSH = ('{"registrationId":"legacy-registration","type":"ios","alarmList":[{"cityIndex":1,'
               '"time":"2017-03-01T22:30:00.000Z","name":"부산"}]}')


def main():
    legacy = os.path.join(ROOT, "containers", "legacy", "Library", "WebKit", "WebsiteData", "LocalStorage")
    os.makedirs(legacy, exist_ok=True)
    item_table(os.path.join(legacy, "app_localhost_0.localstorage"), [
        ("cities", LEGACY_CITIES), ("cityIndex", "1"), ("guideVersion", "1"), ("startupPage", "2"),
        ("refreshInterval", "60"), ("pushData", LEGACY_PUSH),
    ])

    simulator = os.path.join(ROOT, "containers", "simulator")
    other = os.path.join(ROOT, "containers", "other-origin")
    shutil.rmtree(other, ignore_errors=True)
    shutil.copytree(simulator, other)
    for top, dirs, files in os.walk(other):
        if "origin" in files:
            with open(os.path.join(top, "origin"), "wb") as f:
                f.write(origin_file("https", "localhost"))

    suites = os.path.join(ROOT, "suites")
    os.makedirs(suites, exist_ok=True)
    with open(os.path.join(suites, "types.plist"), "wb") as f:
        plistlib.dump({
            "cities": '[{"currentPosition":true,"disable":true},{"name":"London","address":"United Kingdom London",'
                      '"location":{"lat":51.51,"long":-0.13},"disable":false}]',
            "cityIndex": 1,
            "expandShortChart": True,
            "units": b'{"temperatureUnit":"F","windSpeedUnit":"kt","pressureUnit":"inHg","distanceUnit":"mi",'
                     b'"precipitationUnit":"in","airUnit":"aqicn"}',
            "settingsInfo": '{"startupPage":"3","refreshInterval":"0","theme":"photo"}',
            "startVersion": 1.5,
            "pushData2": b"\xff\xfe not utf-8",
            "appVersion": ["1.1.1"],
            "_twHandBack": '{"schema":1,"generation":1,"writer":"cordova","complete":true,"keys":[]}',
        }, f, fmt=plistlib.FMT_BINARY)
    with open(os.path.join(suites, "v1.0.10.plist"), "wb") as f:
        plistlib.dump({
            "cities": LEGACY_CITIES,
            "cityIndex": "1",
            "pushData": LEGACY_PUSH,
            "startVersion": "1",
        }, f, fmt=plistlib.FMT_BINARY)


if __name__ == "__main__":
    main()
