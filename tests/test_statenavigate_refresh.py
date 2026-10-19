import json, sys, unittest
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
from refresh_statenavigate import match_day, plan, precinct_code

def day(d, early, mail):
    return {'date': d, 'early': early, 'mail': mail}

def tracker(rows, early, mail):
    return {'current': {'groups': {'county': {'51001': {'name': 'Test County', 'in_person': early, 'mail': mail}}}},
            'precincts': [{'county_name': 'Test County', 'name': n, 'in_person': e, 'mail': m} for n, e, m in rows]}

REGION = {'elections': {'2026': {'localities': [{'id': 'test-county', 'history': [day('2026-10-15', 50, 10), day('2026-10-16', 90, 20), day('2026-10-17', 90, 20)]}]}}}
SAVED = {'dates': ['2026-09-23'], 'precincts': {'101': {'name': 'A', 'history': {'2026-09-23': [5, 1, 400]}}, '201': {'name': 'B', 'history': {'2026-09-23': [7, 2, 600]}}}}

class StateNavigateRefreshTests(unittest.TestCase):
    def test_codes(self):
        self.assertEqual(precinct_code('101 - CHINCOTEAGUE'), '101')
        self.assertEqual(precinct_code('204 WOODLAND HILLS'), '204')
        self.assertEqual(precinct_code('006 - PRECINCT 6'), '6')

    def test_repeated_weekend_totals_take_latest_day(self):
        self.assertEqual(match_day(REGION['elections']['2026']['localities'][0]['history'], 90, 20), '2026-10-17')
        self.assertIsNone(match_day(REGION['elections']['2026']['localities'][0]['history'], 200, 20))

    def test_split_precincts_summed_and_registration_kept(self):
        data = tracker([('101 - A', 30, 5), ('101 - A', 10, 5), ('201 - B', 50, 10)], 90, 20)
        out, report = plan(data, REGION, lambda p: json.dumps(SAVED))
        saved = json.loads(next(iter(out.values())))
        self.assertEqual(report['imported'], {'test-county': '2026-10-17'})
        self.assertEqual(saved['precincts']['101']['history']['2026-10-17'], [40, 10, 400])
        self.assertEqual(saved['dates'], ['2026-09-23', '2026-10-17'])

    def test_fails_closed(self):
        out, report = plan(tracker([('101 - A', 40, 10), ('201 - B', 50, 10)], 91, 20), REGION, lambda p: json.dumps(SAVED))
        self.assertEqual(out, {}); self.assertIn('do not add up', report['skipped']['test-county'])
        out, report = plan(tracker([('101 - A', 90, 20)], 90, 20), REGION, lambda p: json.dumps(SAVED))
        self.assertEqual(out, {}); self.assertIn('lacks precincts 201', report['skipped']['test-county'])

    def test_existing_days_not_overwritten(self):
        saved = json.loads(json.dumps(SAVED))
        for p in saved['precincts'].values():
            p['history']['2026-10-17'] = [1, 1, 1]
        out, _ = plan(tracker([('101 - A', 40, 10), ('201 - B', 50, 10)], 90, 20), REGION, lambda p: json.dumps(saved))
        self.assertEqual(out, {})

if __name__ == '__main__':
    unittest.main()
