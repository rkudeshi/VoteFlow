import unittest
from provisional import record

class ProvisionalTests(unittest.TestCase):
    def test_record_is_idempotent_and_replaces_corrections(self):
        data = {}
        self.assertTrue(record('loudoun-county', '2026-10-18', {'early': 18983}, 'Loudoun County dashboard', 't1', data))
        self.assertFalse(record('loudoun-county', '2026-10-18', {'early': 18983}, 'Loudoun County dashboard', 't1', data))
        self.assertTrue(record('loudoun-county', '2026-10-18', {'early': 18990}, 'Loudoun County dashboard', 't2', data))
        self.assertEqual(data['provisional']['loudoun-county']['2026-10-18']['early'], 18990)

if __name__ == '__main__':
    unittest.main()
