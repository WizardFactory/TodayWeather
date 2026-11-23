"""Regression checks for the benchmark's diagnostic output validation on macOS."""
from pathlib import Path
from tempfile import TemporaryDirectory
import unittest

from run import FIXTURES, verify_png


class DiagnosticPNGTests(unittest.TestCase):
    image = FIXTURES / "NationReference/nation-nation-air-co.png"
    expected_size = [1179, 2394]

    def test_valid_png_decodes_at_expected_size(self):
        verify_png(self.image, self.expected_size)

    def test_wrong_dimensions_fail(self):
        with self.assertRaisesRegex(RuntimeError, "Unexpected decoded PNG size"):
            verify_png(self.image, [1179, 1])

    def test_invalid_and_undecodable_pngs_fail(self):
        good = self.image.read_bytes()
        broken = (b"bad PNG", good[:-12], good[:8] + good[-12:])
        with TemporaryDirectory() as scratch:
            image = Path(scratch) / "diagnostic.png"
            for data in broken:
                with self.subTest(size=len(data)):
                    image.write_bytes(data)
                    with self.assertRaises(RuntimeError):
                        verify_png(image, self.expected_size)


if __name__ == "__main__":
    unittest.main()
