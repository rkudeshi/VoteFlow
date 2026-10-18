import json
import unittest
from pathlib import Path
from refresh_arlington import activity_date, decode

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

if __name__ == '__main__':
    unittest.main()
