import datetime as dt
import unittest

from build_voteflow import parse_rules


class ScheduleRulesTest(unittest.TestCase):
    def test_weekday_named_rules(self):
        wk, ex, closed = parse_rules(['Monday, Wednesday, Friday: 10 a.m. to 5 p.m.', 'Tuesday/Thursday: Noon to 7 p.m.',
                                      'Saturday (Excluding Oct. 17): 9 a.m. to 5 p.m.', 'Sunday: 11 a.m. to 4 p.m.'])
        self.assertEqual(sorted(wk), [0, 1, 2, 3, 4, 5, 6])
        self.assertEqual(wk[1], (12, 19))
        self.assertEqual(wk[6], (11, 16))
        self.assertEqual(closed, {dt.date(2026, 10, 17)})
        self.assertEqual(ex, {})

    def test_ranges_dates_and_closures(self):
        wk, ex, closed = parse_rules(['Monday-Friday (CLOSED Oct. 12): 9 a.m. to 5 p.m.', 'Thursday-Friday: 2 p.m. to 7 p.m.',
                                      'Sundays (Oct. 18 and Oct. 25): Noon to 5 p.m.', 'Oct. 1 and Oct. 15: open until 6:30 p.m.'])
        self.assertEqual(wk[0], (9, 17))
        self.assertEqual(wk[3], (14, 19))
        self.assertEqual(sorted(ex), [dt.date(2026, 10, 18), dt.date(2026, 10, 25)])
        self.assertEqual(closed, {dt.date(2026, 10, 12)})


if __name__ == '__main__':
    unittest.main()
