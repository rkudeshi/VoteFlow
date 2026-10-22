import io
import json
import shutil
import sys
import tempfile
import unittest
from contextlib import redirect_stdout
from pathlib import Path
from unittest import mock

import refresh_sites

ROOT = Path(__file__).resolve().parent.parent
FEEDS = ROOT / 'sources/dashboard-archive/loudoun-county'


class LoudounStaleFeedTest(unittest.TestCase):
    def setUp(self):
        self.tmp = Path(tempfile.mkdtemp())
        (self.tmp / 'dist').mkdir()
        shutil.copy(ROOT / 'dist/region.json', self.tmp / 'dist/region.json')
        shutil.copytree(ROOT / 'sources/site-snapshots/loudoun', self.tmp / 'sources/site-snapshots/loudoun')

    def tearDown(self):
        shutil.rmtree(self.tmp)

    def run_feed(self, feed):
        out = io.StringIO()
        with mock.patch.object(refresh_sites, 'ROOT', self.tmp), mock.patch.object(sys, 'argv', ['refresh_sites.py', '--file', str(feed)]), redirect_stdout(out):
            refresh_sites.main()
        return json.loads(out.getvalue().strip().splitlines()[-1])

    def test_new_date_with_previous_days_counts_is_skipped(self):
        # Oct 22 7:08 p.m.: Date_Updated moved to Oct 22 but every EV field still held Oct 21's numbers.
        before = (self.tmp / 'dist/region.json').read_text()
        result = self.run_feed(FEEDS / '2026-10-22/1908-arcgis-feed.json')
        self.assertTrue(result.get('stale'))
        self.assertEqual((self.tmp / 'dist/region.json').read_text(), before)
        self.assertFalse(list((self.tmp / 'sources/site-snapshots/loudoun').glob('2026-10-22-*')))

    def test_same_day_snapshots_keep_larger_county_total(self):
        self.run_feed(FEEDS / '2026-10-21/1808-arcgis-feed.json')
        history = json.loads((self.tmp / 'dist/region.json').read_text())['siteReports']['loudoun-county']['2026']['history']
        self.assertEqual({r['date']: r['countyCumulative'] for r in history}['2026-10-21'], 27745)


if __name__ == '__main__':
    unittest.main()
