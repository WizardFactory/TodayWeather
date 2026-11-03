import io
import json
import tempfile
import unittest
from pathlib import Path
from urllib.request import Request

import kma_public_history_qualification as q


class PublicHistoryQualification(unittest.TestCase):
    def test_profile_is_fixed_and_has_no_key(self):
        self.assertEqual(len(q.TIMES), 4)
        self.assertIn("tm=2026.10.18.01%3A00", q.request_url("202610180100"))
        with self.assertRaises(ValueError):
            q.request_url("202610180200")

    def test_redirect_rejects_credentials_other_hosts_and_insecure_transport(self):
        for url in ("http://www.weather.go.kr/a", "https://example.com/a",
                    "https://secret@www.weather.go.kr/a", "https://www.weather.go.kr:444/a"):
            with self.subTest(url=url), self.assertRaises(ValueError):
                q.public_url(url)

    def test_redirect_cap(self):
        redirects = q.WeatherRedirects()
        request = Request(q.BASE)
        for _ in range(2):
            redirects.redirect_request(request, None, 302, "Found", {}, q.BASE + "?a=1")
        with self.assertRaises(ValueError):
            redirects.redirect_request(request, None, 302, "Found", {}, q.BASE)

    def test_body_cap(self):
        self.assertEqual(q.bounded_body(io.BytesIO(b"test")), b"test")
        with self.assertRaises(ValueError):
            q.bounded_body(io.BytesIO(b"a" * (q.LIMIT + 1)))

    def test_form_time_never_certifies_returned_time(self):
        body = '<input name="tm" value="2026.10.18.01:00"><table><tr><td><a href="?stn=108">서울</a></td><td>맑음</td><td></td><td>0.0</td></tr></table>'.encode()
        result = q.inspect(body, "202610180100")
        self.assertFalse(result["time_and_field_qualified"])
        self.assertEqual(result["displayed_dates"], [])
        self.assertFalse(result["single_page_time_match"])
        self.assertEqual(result["station_108_rows"][0]["cells"], ["서울", "맑음", "", "0.0"])

    def test_observation_header_must_match_exact_requested_time(self):
        body = '<div class="cmp-table-topinfo"><strong>기상실황표</strong>2026.10.18.1:00</div>'.encode()
        self.assertTrue(q.inspect(body, "202610180100")["single_page_time_match"])
        self.assertFalse(q.inspect(body, "202610180000")["single_page_time_match"])

    def test_station_profile_is_only_two_fixed_pages(self):
        profile = "city-station-day-20261025-two-pages"
        self.assertEqual(len(q.PROFILES[profile][0]), 2)
        self.assertIn("stn=108", q.request_url("202610242300", profile))
        with self.assertRaises(ValueError):
            q.request_url("202610240000", profile)

    def test_capture_cannot_overwrite_existing_evidence(self):
        with tempfile.TemporaryDirectory() as directory:
            with self.assertRaises(FileExistsError):
                q.capture(Path(directory))

    def test_offline_replay_rejects_tampered_original(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory)
            (path / "report.json").write_text(json.dumps({"attempts": [{
                "requested_kst": q.TIMES[0], "sha256": "0" * 64}]}))
            (path / (q.TIMES[0] + ".html")).write_bytes(b"changed")
            with self.assertRaisesRegex(ValueError, "original hash mismatch"):
                q.analyze(path)

    def test_offline_replay_rejects_unprofiled_file_path(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory)
            (path / "report.json").write_text(json.dumps({"attempts": [{
                "requested_kst": "../../outside", "sha256": "0" * 64}]}))
            with self.assertRaisesRegex(ValueError, "outside fixed qualification"):
                q.analyze(path)


if __name__ == "__main__":
    unittest.main()
