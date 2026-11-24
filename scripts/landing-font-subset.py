#!/usr/bin/env python3
"""Subset Pretendard Variable to the characters the landing pages render.

Reads every landing/*/index.html, keeps the body text plus printable ASCII,
and writes landing/assets/landing-sans.woff2 with a copy of the license as
landing/assets/landing-sans-OFL.txt.

Pretendard reserves its font name under the SIL OFL 1.1, so the subset is a
Modified Version and carries the family name "TW Landing Sans". Copyright,
trademark, designer and license records stay in the font.

Requires fonttools and brotli (pip install fonttools brotli). Rerun after
editing landing copy; scripts/verification/landing-page.test.mjs fails while
the font lacks a character the pages render.
"""
import re
from html.parser import HTMLParser
from pathlib import Path
from shutil import copyfile

from fontTools import subset
from fontTools.ttLib import TTFont

ROOT = Path(__file__).resolve().parent.parent
SOURCE = ROOT / "web/src/assets/PretendardVariable.woff2"
LICENSE = ROOT / "web/src/assets/Pretendard-OFL.txt"
OUTPUT = ROOT / "landing/assets/landing-sans.woff2"
FAMILY = "TW Landing Sans"
POSTSCRIPT = "TWLandingSans"
# Family, unique ID, full name, PostScript names and named instances. Copyright (0),
# trademark (7), designer credits (8, 9) and license (13, 14) keep the original text.
RENAMED = {1, 3, 4, 6, 16, 25}
RESERVED = re.compile(r"Pretendard[ -]?Variable|Pretendard")


class BodyText(HTMLParser):
    def __init__(self):
        super().__init__()
        self.in_body = False
        self.chars = set()

    def handle_starttag(self, tag, attrs):
        if tag == "body":
            self.in_body = True

    def handle_data(self, data):
        if self.in_body:
            self.chars.update(data)


def page_characters():
    wanted = {chr(code) for code in range(0x20, 0x7F)}
    for page in sorted((ROOT / "landing").glob("*/index.html")):
        parser = BodyText()
        parser.feed(page.read_text(encoding="utf-8"))
        wanted |= parser.chars
    return {char for char in wanted if char.isprintable()}


def main():
    wanted = page_characters()
    options = subset.Options()
    options.flavor = "woff2"
    options.layout_features = ["*"]
    options.notdef_outline = True
    options.recalc_timestamp = False
    options.name_IDs = ["*"]
    font = TTFont(SOURCE, recalcTimestamp=False)
    covered = sorted(wanted & {chr(code) for code in font.getBestCmap()})
    subsetter = subset.Subsetter(options)
    subsetter.populate(text="".join(covered))
    subsetter.subset(font)

    version = font["name"].getDebugName(5).split(";")[0].removeprefix("Version ")
    for record in font["name"].names:
        if record.nameID in (1, 4, 16):
            record.string = FAMILY
        elif record.nameID == 3:
            record.string = f"{POSTSCRIPT}-{version}"
        elif record.nameID in RENAMED or record.nameID >= 256:
            record.string = RESERVED.sub(POSTSCRIPT, str(record))
    font.flavor = "woff2"
    font.save(OUTPUT)
    copyfile(LICENSE, OUTPUT.with_name("landing-sans-OFL.txt"))
    print(f"{OUTPUT.relative_to(ROOT)}: {OUTPUT.stat().st_size} bytes, {len(covered)} characters")
    missing = "".join(sorted(wanted - set(covered)))
    if missing:
        print(f"not in Pretendard, left to the fallback stack: {missing}")


if __name__ == "__main__":
    main()
