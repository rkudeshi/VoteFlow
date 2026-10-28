import json
import unittest
from pathlib import Path
from refresh_arlington import activity_date, decode, site_table_gap, snapshot_lags, total_row_mismatches

CAPTURE = Path(__file__).resolve().parent.parent / 'sources/dashboard-archive/arlington-county/2026-10-18/1731-powerbi-data.json'

class ArlingtonDashboardTests(unittest.TestCase):
    def test_2024_columns_map_to_same_weekday_in_2026(self):
        self.assertEqual(activity_date('9/20/2024'), '2026-09-18')
        self.assertEqual(activity_date('10/19/2024'), '2026-10-17')

    def test_october_17_capture_decodes_to_site_counts(self):
        queries = json.loads(CAPTURE.read_text())['queries']
        rows = {r['Site']: r for r in decode(queries['daily'])}
        self.assertEqual(rows['Total']['10/19/2024'], 2890)
        self.assertEqual(rows['EV2 - Langston Brown']['10/19/2024'], 928)
        self.assertEqual(rows['Total']['Total'], 12703)
        self.assertEqual(decode(queries['totals'])[0]['Early Voting'], 12703)
        self.assertEqual(len(decode(queries['precincts'])), 54)

    def test_small_site_table_gap_is_recorded_not_fatal(self):
        # Oct 25 capture: site table 23,004, Snapshot and precinct tables 23,002.
        days = [{'early': 23004}]
        self.assertEqual(site_table_gap(days, 23004, 23002), 2)
        with self.assertRaises(AssertionError):
            site_table_gap(days, 23004, 22900)
        with self.assertRaises(AssertionError):
            site_table_gap([{'early': 23000}], 23004, 23002)

    def test_total_row_votes_on_a_siteless_day_use_the_site_sum(self):
        # Oct 27 capture: the Total row put 49 on 9/21/2024 with no site, but its grand total matched the sites.
        capture = json.loads((CAPTURE.parent.parent / '2026-10-27/0931-powerbi-data.json').read_text())
        rows = {r['Site']: r for r in decode(capture['queries']['daily'])}
        self.assertEqual(total_row_mismatches(rows, capture['dateColumns']), {'9/21/2024': 49})
        rows['Total']['Total'] += 49
        with self.assertRaises(AssertionError):
            total_row_mismatches(rows, capture['dateColumns'])

    def test_site_table_one_day_ahead_of_snapshot(self):
        # Oct 28 capture: site table 26,340 with 857 for Oct 27, Snapshot still 25,483.
        days = [{'early': 25483}, {'early': 857}]
        self.assertTrue(snapshot_lags(days, 26340, 25483))
        self.assertFalse(snapshot_lags(days, 26340, 26340))
        self.assertFalse(snapshot_lags(days, 26340, 25400))
        self.assertFalse(snapshot_lags([{'early': 857}], 857, 0))

if __name__ == '__main__':
    unittest.main()
