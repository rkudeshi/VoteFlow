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
                if row[j] is not None:
                    self.assertEqual(sum(c['rows'][k][j] for c in data['counties']), row[j])

    def test_in_person_columns(self):
        # The state added in-person columns with the Oct 23 report (its workbook also gained a blank column A).
        r = ca_data.parse_report(ca_data.saved_reports()['2026-10-23'])
        self.assertEqual(r['total']['inperson'], 6929)
        self.assertEqual(r['total']['ipacc'], 6909)
        self.assertEqual(r['counties']['Calaveras']['inperson'], 228)
        self.assertIsNone(ca_data.parse_report(ca_data.saved_reports()['2026-10-19'])['total']['inperson'])

    def test_report_dates_read_from_the_files(self):
        for day, path in ca_data.saved_reports().items():
            self.assertEqual(ca_data.parse_report(path)['asOf'], day)

    def test_as_of_formats(self):
        self.assertEqual(refresh_ca.as_of('Statistics as of:Monday, October 19, 2026'), '2026-10-19')
        self.assertEqual(refresh_ca.as_of('Ballot Statistics as of: 10/12/26'), '2026-10-12')
        self.assertIsNone(refresh_ca.as_of('November 3, 2026, General Election'))


if __name__ == '__main__':
    unittest.main()
