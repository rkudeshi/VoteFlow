import unittest
from election_day import parse, tidy

SAMPLE = """Summary Results Report
Registered Voters - Total                808,757

Ballots Cast - Total                     448,792   137,213   241,792    56,881    5,943     5,453    1,510

104 - CHAPEL
Registered Voters - Total                2,605

Ballots Cast - Total                     1,712    440      1,025         210         17          13       7
Governor
   Contest Totals                        1,712    440      1,025         210         17          13       7
"""
COLS = ['ev', 'ed', 'enm', 'prov', 'pem', 'hand']

class ElectionDayTests(unittest.TestCase):
    def test_parses_county_and_precinct_ballots_by_method(self):
        county, reg, precincts = parse(SAMPLE, COLS, COLS)
        self.assertEqual(reg, 808757)
        self.assertEqual(county['ed'], 241792)
        p = tidy(precincts['104'])
        self.assertEqual((p['r'], p['ed'], p['ev'], p['mail'], p['prov'], p['hand'], p['t']), (2605, 1025, 440, 223, 17, 7, 1712))

    def test_rejects_rows_with_missing_columns(self):
        with self.assertRaises(ValueError):
            parse(SAMPLE.replace('    17  ', '  '), COLS, COLS)

if __name__ == '__main__':
    unittest.main()
