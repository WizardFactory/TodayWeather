import unittest
from pathlib import Path

import kma_asos_journal as q


class JournalSyntax(unittest.TestCase):
    def test_completed_rain_intervals_cover_the_preceding_hour(self):
        actual = q.hourly_types("{비}0615-0630. {비}0840-{비}{강도0}0900-{비}{강도2}1500-1845.")
        self.assertEqual([h for h, pty in enumerate(actual, 1) if pty == 1],
                         [7, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19])
        self.assertEqual(actual[19:], [0] * 5)

    def test_cross_midnight_continuation_and_type_changes(self):
        actual = q.hourly_types("-{비}-{비}{강도0}0030-{진눈깨비}0045-{눈}0120-0245.")
        self.assertEqual(actual[:4], [2, 2, 3, 0])
        late = q.hourly_types("{비}2310-{눈}2340-{눈}{강도0}2400-")
        self.assertEqual(late[23], 2)
        self.assertEqual(late[:23], [0] * 23)

    def test_visibility_decimal_and_mist_never_become_precipitation(self):
        actual = q.hourly_types("{박무}0015-0545. {눈}0615-{시정(미만)}{0.5km}{눈}0625-0645.")
        self.assertEqual(actual[:6], [0] * 6)
        self.assertEqual(actual[6], 3)
        self.assertEqual(actual[7:], [0] * 17)

    def test_exact_hour_start_is_explicitly_ambiguous(self):
        actual = q.hourly_types("{비}0100-0245.")
        self.assertIsNone(actual[0], "do not invent a minute-endpoint convention")
        self.assertEqual(actual[1:4], [1, 1, 0])

    def test_initial_intensity_is_not_evidence_of_a_dry_earlier_hour(self):
        actual = q.hourly_types("{비}{강도0}0300-{비}{강도0}0600-0645.")
        self.assertEqual(actual[:3], [None, None, None])
        self.assertEqual(actual[3:7], [1, 1, 1, 1])
        self.assertEqual(actual[7:], [0] * 17)

    def test_drizzle_name_in_the_actual_journal_is_precipitation(self):
        self.assertEqual(q.hourly_types("{안개비}0115-0145.")[1], 1)

    def test_empty_is_distinct_from_absent_and_malformed(self):
        self.assertEqual(q.hourly_types(""), [0] * 24)
        for invalid in (None, "{비}0615-", "{비}0615-0630", "{비}2560-2700.",
                        "{비}0630-0615.", "{비}0615-0615.", "{우박}0615-0630.",
                        "{비}0615-{새부호}0630-0645.", "{눈}0615-{0.5km}0625-0645."):
            with self.subTest(invalid=invalid), self.assertRaises(q.JournalError):
                q.hourly_types(invalid)


def day(**changes):
    return {"stnId": "108", "tm": "2026-10-18", "minTa": "10", "maxTa": "20",
            "sumRn": "0.0", "sumRnDur": "0.5", "iscs": "{비}0015-0045.", **changes}


def hour(tm, **changes):
    return {"stnId": "108", "tm": "2026-10-18 " + tm, "rn": "", "rnQcflg": "",
            "dmstMtphNo": "", "ta": "17", **changes}


class JournalControls(unittest.TestCase):
    def test_invalid_hour_is_reported_without_losing_the_failure_receipt(self):
        actual = q.compare([hour("invalid")], [day()], "108")
        self.assertFalse(actual["control_gate_passed"])
        self.assertTrue(actual["errors"])

    def test_missing_next_day_continuation_cannot_silently_become_dry(self):
        actual = q.compare([hour("01:00")],
                           [day(tm="2026-10-17", iscs="{비}2315-{비}{강도0}2400-"),
                            day(iscs="", sumRn="", sumRnDur="")], "108")
        self.assertIn("2026-10-18 01:00", actual["ambiguous"])
        self.assertFalse(actual["control_gate_passed"])

    def test_an_unobserved_hour_is_not_a_dry_control(self):
        actual = q.compare([hour("01:00", rn="0.0", dmstMtphNo="01"), hour("02:00"),
                            hour("03:00", ta="")], [day()], "108")
        self.assertEqual(actual["compared"], 2)
        self.assertEqual(actual["unknown_reference"][0]["tm"], "2026-10-18 03:00")

    def test_unknown_nonblank_codes_fail_the_gate_instead_of_being_dropped(self):
        actual = q.compare([hour("01:00", rn="0.0", dmstMtphNo="01"), hour("02:00"),
                            hour("03:00", dmstMtphNo="999")], [day()], "108")
        self.assertFalse(actual["control_gate_passed"])

    def test_matching_controls_do_not_upgrade_qc9_or_quantities(self):
        actual = q.compare([hour("01:00", rn="0.0", dmstMtphNo="01"), hour("02:00"),
                            hour("03:00", rnQcflg="9")], [day()], "108")
        self.assertTrue(actual["control_gate_passed"])
        self.assertEqual((actual["compared"], actual["mismatches"]), (2, []))
        self.assertEqual(actual["unknown_reference"][0]["tm"], "2026-10-18 03:00")
        self.assertFalse(actual["full_history_qualified"])

    def test_mismatch_and_unparseable_day_cannot_pass(self):
        actual = q.compare([hour("01:00"), hour("02:00", rn="0.0", dmstMtphNo="01")],
                           [day()], "108")
        self.assertFalse(actual["control_gate_passed"])
        self.assertEqual(len(actual["mismatches"]), 2)
        actual = q.compare([hour("01:00")], [day(iscs="{新現象}0015-0045.")], "108")
        self.assertFalse(actual["control_gate_passed"])
        self.assertTrue(actual["errors"])

    def test_first_midnight_requires_the_previous_daily_journal(self):
        actual = q.compare([hour("00:00"), hour("01:00", rn="0.0", dmstMtphNo="01"),
                            hour("02:00")], [day()], "108")
        self.assertEqual(actual["outside_daily_window"], ["2026-10-18 00:00"])
        self.assertEqual(actual["compared"], 2)

    def test_missing_identity_duplicate_day_or_missing_measurements_fails(self):
        for rows in ([day(stnId="159")], [day(), day()], [day(iscs=None)],
                     [day(minTa="", maxTa="")], [day(iscs="")]):
            actual = q.compare([hour("01:00")], rows, "108")
            self.assertFalse(actual["control_gate_passed"])
            self.assertTrue(actual["errors"])


class RecordedJournalControls(unittest.TestCase):
    fixtures = Path(__file__).resolve().parents[2] / "tests/domestic/fixtures"

    def recorded(self, station, period):
        return q.compare(q.read_rows(self.fixtures / f"asos-hourly-{station}-{period}.json"),
                         q.read_rows(self.fixtures / f"asos-daily-{station}-{period}.json"), station)

    def test_jeju_checkpoint_cannot_make_the_earlier_hours_dry(self):
        actual = self.recorded("184", "20261018-20261024")
        self.assertFalse(actual["control_gate_passed"])
        self.assertEqual(actual["mismatches"], [])
        for hour in ("01:00", "02:00", "03:00"):
            self.assertIn("2026-10-21 " + hour, actual["ambiguous"])

    def test_winter_gauge_check_uses_three_hours_and_reports_no_dry_controls(self):
        actual = self.recorded("108", "20241126-20241128")
        self.assertEqual(actual["gauge"]["mismatches"], [])
        self.assertEqual((actual["gauge"]["compared"], actual["gauge"]["wet"],
                          actual["gauge"]["dry"]), (19, 19, 0))
        self.assertFalse(actual["control_gate_passed"], "no winter gauge absence qualification")

    def test_replayed_busan_drizzle_matches_without_dropping_the_day(self):
        actual = self.recorded("159", "20261018-20261024")
        self.assertEqual(actual["errors"], [])
        self.assertEqual(actual["mismatches"], [])
        self.assertEqual(actual["gauge"]["mismatches"], [])
        self.assertTrue(actual["control_gate_passed"], "post-correction replay, not fresh qualification")

    def test_fresh_winter_gauge_contradiction_fails_despite_code_consistency(self):
        actual = self.recorded("112", "20250127-20250130")
        self.assertEqual(actual["mismatches"], [], "codes are derived from the journal")
        self.assertEqual(actual["gauge"]["mismatches"], [
            {"tm": "2025-01-28 21:00", "journal_wet": False,
             "rain_field_wet": True, "hours": 3}])
        self.assertFalse(actual["control_gate_passed"])

    def test_fresh_rainy_days_with_empty_journals_are_rejected(self):
        actual = self.recorded("105", "20250302-20250305")
        self.assertEqual(len(actual["errors"]), 4)
        self.assertTrue(all(e["reason"] == "reported precipitation without a journal event"
                            for e in actual["errors"]))
        self.assertEqual(actual["gauge"]["compared"], 0)
        self.assertFalse(actual["control_gate_passed"])

    def test_fresh_odd_reference_code_is_preserved_as_a_gate_failure(self):
        actual = self.recorded("165", "20261011-20261014")
        self.assertIn({"hour": "2026-10-13 23:00",
                       "reason": "unsupported nonblank reference code"}, actual["errors"])
        self.assertFalse(actual["control_gate_passed"])
        self.assertFalse(actual["full_history_qualified"])


if __name__ == "__main__":
    unittest.main()
