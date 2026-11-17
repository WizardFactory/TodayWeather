#!/usr/bin/env python3
"""The scene sessions UIKit keeps for an app (IN-17): one line per session with the strings of its archived configuration.

    scene_sessions.py <data-container>

A configuration from Info.plist is kept as its name and role; one made in code also keeps its delegate's class name
(SwiftUI's App: `SwiftUI.AppSceneDelegate`) and the bundle versions that encoded it.
"""
import glob
import plistlib
import sys

for path in glob.glob(sys.argv[1] + "/Library/Saved Application State/*/KnownSceneSessions/data.data"):
    for key, blob in plistlib.load(open(path, "rb")).items():
        strings = [o for o in plistlib.loads(blob)["$objects"] if isinstance(o, str) and o not in ("$null", key)]
        print(key, strings)
