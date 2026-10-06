"""Mapping checks at the raw supplemental qualifier boundary."""
import unittest
from scoped_bundle import qualifier_labels


class ScopedMappingTests(unittest.TestCase):
    def test_joined_raw_labels_preserve_the_phrase_and_negation(self):
        self.assertEqual(qualifier_labels(['now', '_', 'rare']), ['now rare'])
        self.assertEqual(qualifier_labels(['not', '_', 'offensive']), ['not offensive'])
        self.assertEqual(qualifier_labels(['literary', 'not', '_', 'offensive']), ['literary', 'not offensive'])

    def test_separate_labels_stay_separate(self):
        self.assertEqual(qualifier_labels(['literary', 'rare']), ['literary', 'rare'])

    def test_unmapped_join_is_a_technical_failure(self):
        with self.assertRaisesRegex(Exception, 'scoped_qualifier_mapping_failed'):
            qualifier_labels(['not', '_'])


if __name__ == '__main__':
    unittest.main()
