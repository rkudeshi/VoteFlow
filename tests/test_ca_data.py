import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
import ca_data  # noqa: E402
import refresh_ca  # noqa: E402


class CaliforniaData(unittest.TestCase):
    def test_saved_reports_parse_and_reconcile(self):
        data = ca_data.build()
        self.assertEqual(len(data['counties']), 58)
        dates = [r['d'] for r in data['reports']]
        self.assertEqual(dates, sorted(set(dates)))
        for c in data['counties']:
            self.assertEqual([r[0] for r in c['rows']], dates)
        # County rows add up to the statewide rows for every field and report.
        for k, row in enumerate(data['total']):
            for j in range(1, len(row)):
                self.assertEqual(sum(c['rows'][k][j] for c in data['counties']), row[j])

    def test_report_dates_read_from_the_files(self):
        for day, path in ca_data.saved_reports().items():
            self.assertEqual(ca_data.parse_report(path)['asOf'], day)

    def test_as_of_formats(self):
        self.assertEqual(refresh_ca.as_of('Statistics as of:Monday, October 19, 2026'), '2026-10-19')
        self.assertEqual(refresh_ca.as_of('Ballot Statistics as of: 10/12/26'), '2026-10-12')
        self.assertIsNone(refresh_ca.as_of('November 3, 2026, General Election'))


if __name__ == '__main__':
    unittest.main()
