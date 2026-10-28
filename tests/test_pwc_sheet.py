import unittest
from refresh_pwc_sheet import complete_days, county_series, mail_totals, parse_mail, parse_sites

HEAD = """Grand Total,,,,,,,,,,,,,,,
Date,,OFFICE,,DMV,,HAYMARKET,,BRENTSVILLE,,DUMFRIES,,FERLAZZO,,DAILY TOTAL,
,,VOTERS,DROPBOX,VOTERS,DROPBOX,VOTERS,DROPBOX,VOTERS,DROPBOX,VOTERS,DROPBOX,VOTERS,DROPBOX,VOTERS,DROPBOX
Fri,9/18,382,62,541,33,0,0,0,0,0,0,0,0,923,95
Sat,9/19,0,,0,,0,0,0,0,0,0,0,0,0,0
Mon,9/21,337,62,460,75,0,0,0,0,0,0,0,0,797,137
"""
MAIL = """"November, 2026 General Election",,,,,,,,Late,"TOTAL
 Delivered",,,Outgoing,"26,733",,Undeliverable,601
Date,,Outgoing,,Returned,,,Undeliverable,,,,,Returned,"1,628",,,
,,Mail,Email,Mail,Emailed,Dropbox,Mail,,,,,,,,,
,9/14/2026,"26,008",579,0,0,0,0,,,,,,,,,
,9/18/2026,1,17,0,1,2,0,,,,,,,,,
,9/22/2026,99,29,"1,381",11,140,0,,,,,,,,,
,9/23/2026,,,,,,601,,,,,,,,,
"""


class PwcSheetTests(unittest.TestCase):
    def test_sites_skip_closed_days_and_keep_blank_drop_boxes_unknown(self):
        days = parse_sites(HEAD + "Tue,9/22,235,,328,52,0,0,0,0,0,0,0,0,563,52\nTOTALS,,954,124,1329,160,0,0,0,0,0,0,0,0,2283,284\n")
        self.assertEqual([d['date'] for d in days], ['2026-09-18', '2026-09-21', '2026-09-22'])
        self.assertIsNone(days[-1]['dropbox']['office'])
        self.assertEqual(days[0]['voters']['dmv'], 541)

    def test_half_typed_last_day_waits(self):
        days = parse_sites(HEAD + "Tue,9/22,235,,0,,0,0,0,0,0,0,0,0,235,0\n")
        self.assertEqual(complete_days(days)[-1]['date'], '2026-09-21')
        later = parse_sites(HEAD + "Tue,9/22,235,,0,,0,0,0,0,0,0,0,0,235,0\nWed,9/23,1,,0,,0,0,0,0,0,0,0,0,1,0\n")
        self.assertIn('2026-09-22', [d['date'] for d in complete_days(later)])

    def test_site_counts_must_add_up(self):
        with self.assertRaises(AssertionError):
            parse_sites(HEAD + "Tue,9/22,235,,328,52,0,0,0,0,0,0,0,0,999,52\n")

    def test_mail_rows_reconcile_and_series_runs_to_last_site_day(self):
        mail = parse_mail(MAIL)
        self.assertEqual([m['date'] for m in mail], ['2026-09-14', '2026-09-18', '2026-09-22'])  # 9/23 not typed in yet
        totals = mail_totals(MAIL)
        self.assertEqual(totals, {'sent': 26733, 'returned': 1628, 'undeliverable': 601})
        self.assertEqual(sum(m['sentMail'] + m['sentEmail'] for m in mail), totals['sent'])
        series = county_series(parse_sites(HEAD), mail)
        self.assertEqual(series[-1]['date'], '2026-09-21')
        self.assertEqual(series[-1]['cumulative'], {'sent': 26605, 'postal': 1, 'dropbox': 2, 'early': 1720})


if __name__ == '__main__':
    unittest.main()
