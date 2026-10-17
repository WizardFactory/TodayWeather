#!/usr/bin/env python3
"""Target-specific link regression; run before and after the PBX correction."""
import argparse
import re
from pathlib import Path
import unittest


def project_objects(path):
    # Read only the PBX object records needed for target/framework membership.
    # This source check is portable; native builds remain a separate macOS gate.
    source = path.read_text()
    sections = ("PBXNativeTarget", "PBXFrameworksBuildPhase", "PBXBuildFile", "PBXFileReference", "PBXReferenceProxy")
    text = "\n".join(re.search(r"/\* Begin " + section + r" section \*/(.*?)/\* End " + section + r" section \*/", source, flags=re.S)[1] for section in sections)
    text = re.sub(r"/\*.*?\*/", "", text, flags=re.S)
    objects = {}
    for match in re.finditer(r"^\t\t([A-F0-9]{24})\s*=\s*\{(.*?)\};", text, flags=re.M | re.S):
        record = {}
        for field in ("isa", "name", "path", "fileRef"):
            value = re.search(r"\b" + field + r"\s*=\s*([^;\n]+);", match[2])
            if value:
                record[field] = value[1].strip().strip('"')
        for field in ("buildPhases", "files"):
            value = re.search(r"\b" + field + r"\s*=\s*\((.*?)\);", match[2], flags=re.S)
            if value:
                record[field] = re.findall(r"\b[A-F0-9]{24}\b", value[1])
        objects[match[1]] = record
    if not objects:
        raise ValueError("PBX object records were not found")
    return objects


class WidgetProjectTest(unittest.TestCase):
    def test_widget_is_independent_and_main_app_retains_cordova(self):
        objects = project_objects(self.project)
        targets = {o["name"]: o for o in objects.values() if o.get("isa") == "PBXNativeTarget"}

        def links(target):
            result = []
            for phase_id in target["buildPhases"]:
                phase = objects.get(phase_id, {})
                if phase.get("isa") == "PBXFrameworksBuildPhase":
                    for build_id in phase["files"]:
                        ref = objects[objects[build_id]["fileRef"]]
                        result.append(ref.get("path", ref.get("name", "")))
            return result

        self.assertNotIn("libCordova.a", links(targets["widget"]))
        self.assertIn("libCordova.a", links(targets["TodayWeather"]))
        self.assertIn("System/Library/Frameworks/NotificationCenter.framework", links(targets["widget"]))


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--project", type=Path, default=Path(__file__).resolve().parents[2] / "TodayWeather.xcodeproj/project.pbxproj")
    args, remaining = parser.parse_known_args()
    WidgetProjectTest.project = args.project
    unittest.main(argv=[__file__, *remaining])
