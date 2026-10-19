import unittest
from pathlib import Path
from unittest.mock import patch, MagicMock
from urllib.error import HTTPError, URLError
from refresh_fairfax import parse
from source_fetch import fetch_bytes

ROOT = Path(__file__).resolve().parents[1]

class FairfaxRefreshTests(unittest.TestCase):
    def current_text(self):
        return (ROOT / 'sources/fairfax-snapshots/2026-10-14-ed97a342e167.txt').read_text()

    def test_two_and_four_digit_dates_include_same_day_activity(self):
        text = self.current_text()
        for content in (text, text.replace('10/14/26', '10/14/2026')):
            result = parse(content, 'https://example.test/report.pdf', 'test')
            self.assertEqual(result['reportDate'], '2026-10-14')
            self.assertEqual(result['activityThrough'], '2026-10-14')
            self.assertEqual(result['history'][-1]['cumulative'],
                             dict(sent=83762, postal=29070, dropbox=6389, early=38148))
            self.assertFalse(any(row['date'] > '2026-10-14' for row in result['history']))

    def test_archived_reports_remain_parseable(self):
        for path in (ROOT / 'sources/fairfax-snapshots').glob('*.txt'):
            with self.subTest(path=path.name):
                result = parse(path.read_text(), 'https://example.test/report.pdf', 'test')
                self.assertEqual(result['reportDate'], path.name[:10])

    def test_april_special_report_counts_election_day_precinct_drop_boxes(self):
        text = (ROOT / 'sources/fairfax-snapshots/april-2026-special/2026-04-24-61050ee3accb.txt').read_text()
        result = parse(text, 'https://example.test/report.pdf', 'test', election='April 21, 2026', election_day='2026-04-21')
        self.assertEqual(result['history'][-1]['cumulative'], dict(sent=77100, postal=46372, dropbox=10716, early=126536))
        self.assertEqual(next(r for r in result['history'] if r['date'] == '2026-04-21')['dropbox'], 329 + 2375)
        with self.assertRaises(AssertionError):
            parse(text, 'https://example.test/report.pdf', 'test', election='April 21, 2026')

    def test_inconsistent_totals_and_future_detail_are_rejected(self):
        for text in (self.current_text().replace('73,607', '73,608'),
                     self.current_text().replace('10/14/26', '10/13/26')):
            with self.assertRaises(AssertionError):
                parse(text, 'https://example.test/report.pdf', 'test')

    @patch('source_fetch.time.sleep')
    @patch('source_fetch.urllib.request.urlopen')
    def test_transient_network_failure_retries(self, open_url, sleep):
        response = MagicMock()
        response.__enter__.return_value.read.return_value = b'valid source'
        open_url.side_effect = [URLError('temporary'), response]
        self.assertEqual(fetch_bytes('https://example.test/source'), b'valid source')
        self.assertEqual(open_url.call_count, 2)

    @patch('source_fetch.time.sleep')
    @patch('source_fetch.urllib.request.urlopen')
    def test_permanent_errors_do_not_retry(self, open_url, sleep):
        open_url.side_effect = HTTPError('https://example.test/source', 404, 'missing', {}, None)
        with self.assertRaises(HTTPError):
            fetch_bytes('https://example.test/source')
        self.assertEqual(open_url.call_count, 1)
        sleep.assert_not_called()
