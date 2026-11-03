"""Town elevation table builder: name joins, tile layout and estimates, without network or tiles."""
import array
import gzip
import pathlib
import sys
import tempfile
import unittest

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1] / 'migration'))
from build_town_elevations import Official, Terrain, estimates, norm_town  # noqa: E402


def write_tile(directory, name, size, height):
    cells = array.array('h', [height(row, col) for row in range(size) for col in range(size)])
    if sys.byteorder == 'little':
        cells.byteswap()
    (pathlib.Path(directory) / name).write_bytes(gzip.compress(cells.tobytes()))


class NameJoinTest(unittest.TestCase):
    def setUp(self):
        self.official = Official([
            ('강원특별자치도', '평창군', '진부면', 37.6, 128.5),
            ('부산광역시', '북구', '구포3동', 35.2, 129.0),
            ('부산광역시', '부산진구', '당감1동', 35.1, 129.0),
            ('부산광역시', '부산진구', '당감2동', 35.3, 129.2),
        ])

    def test_renamed_province_and_numbered_spelling_join(self):
        self.assertEqual(self.official.coordinate('강원도', '평창군', '진부면'), (37.6, 128.5))
        self.assertEqual(self.official.coordinate('부산광역시', '북구', '구포제3동'), (35.2, 129.0))
        self.assertEqual(norm_town('금호2.3가동'), '금호2·3가동')

    def test_numbered_parts_use_their_mean(self):
        lat, lon = self.official.coordinate('부산광역시', '부산진구', '당감동')
        self.assertAlmostEqual(lat, 35.2)
        self.assertAlmostEqual(lon, 129.1)

    def test_an_unknown_town_stays_unverified(self):
        self.assertIsNone(self.official.coordinate('충청북도', '제천시', '모산동'))


class TerrainTest(unittest.TestCase):
    def test_rows_start_at_the_north_edge_and_interpolate(self):
        with tempfile.TemporaryDirectory() as tmp:
            write_tile(tmp, 'N37E128.hgt.gz', 3, lambda row, col: 100 * row + 10 * col)
            terrain = Terrain(tmp)
            self.assertAlmostEqual(terrain.at(38.0 - 1e-12, 128.0), 0, places=3)
            self.assertAlmostEqual(terrain.at(37.5, 128.0), 100, places=6)
            self.assertAlmostEqual(terrain.at(37.25, 128.25), 155, places=6)
            self.assertIsNone(terrain.at(36.5, 128.5))

    def test_voids_are_skipped_and_sea_noise_is_clamped(self):
        with tempfile.TemporaryDirectory() as tmp:
            write_tile(tmp, 'N37E128.hgt.gz', 3, lambda row, col: -32768 if row == 0 else -50)
            terrain = Terrain(tmp)
            self.assertEqual(terrain.at(37.5, 128.5), -50)
            self.assertEqual(estimates(terrain, 37.5, 128.5), (0, 0, 0))


if __name__ == '__main__':
    unittest.main()
