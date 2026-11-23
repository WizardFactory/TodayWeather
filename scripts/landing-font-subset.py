#!/usr/bin/env python3
"""Subset Pretendard Variable to the characters the landing pages render.

Reads every landing/*/index.html, keeps the body text plus printable ASCII,
and writes landing/assets/landing-sans.woff2 with the covered characters
listed in landing/assets/landing-sans.chars.txt.

Pretendard reserves its font name under the SIL OFL 1.1, so the subset is a
Modified Version and carries the family name "TW Landing Sans". The original
copyright notice and license stay in web/src/assets/Pretendard-OFL.txt, which
ships beside the font.

Requires fonttools and brotli (pip install fonttools brotli). Rerun after
editing landing copy; landing-font-coverage.test.mjs fails until the
character list matches the pages.
"""
from html.parser import HTMLParser
from pathlib import Path

from fontTools import subset
from fontTools.ttLib import TTFont

ROOT = Path(__file__).resolve().parent.parent
SOURCE = ROOT / "web/src/assets/PretendardVariable.woff2"
OUTPUT = ROOT / "landing/assets/landing-sans.woff2"
CHARS = ROOT / "landing/assets/landing-sans.chars.txt"
FAMILY = "TW Landing Sans"
POSTSCRIPT = "TWLandingSans"


class BodyText(HTMLParser):
    def __init__(self):
        super().__init__()
        self.depth = 0
        self.chars = set()

    def handle_starttag(self, tag, attrs):
        if tag == "body":
            self.depth = 1

    def handle_data(self, data):
        if self.depth:
            self.chars.update(data)


def page_characters():
    parser = BodyText()
    for page in sorted((ROOT / "landing").glob("*/index.html")):
        parser.depth = 0
        parser.feed(page.read_text(encoding="utf-8"))
    wanted = {chr(code) for code in range(0x20, 0x7F)} | parser.chars
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
        elif record.nameID in (6, 25) or record.nameID >= 256:
            record.string = str(record).replace("PretendardVariable", POSTSCRIPT)
    font.flavor = "woff2"
    font.save(OUTPUT)
    CHARS.write_text("".join(covered) + "\n", encoding="utf-8")
    missing = "".join(sorted(wanted - set(covered)))
    print(f"{OUTPUT.relative_to(ROOT)}: {OUTPUT.stat().st_size} bytes, {len(covered)} characters")
    if missing:
        print(f"not in Pretendard, left to the fallback stack: {missing}")


if __name__ == "__main__":
    main()
