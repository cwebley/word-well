"""Mapping checks at the raw supplemental qualifier boundary."""
import unittest
from scoped_bundle import qualifier_labels, page_meanings


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

    def test_nested_definitions_preserve_paths_and_stop_at_any_next_language(self):
        text = '\n'.join(['==English==', '===Adjective===', '# Vanishing.',
            '#* Quotation.', '## {{lb|en|electromagnetism}} Near its source.',
            '## {{lb|en|mathematics}} Tending to zero.', '# Fleeting.',
            '## {{lb|en|botany}} Shed.', '==Catalan==', '===Adjective===', '# Another language.'])
        meanings = page_meanings(text)
        self.assertEqual([m['path'] for m in meanings], [[1], [1, 1], [1, 2], [2], [2, 1]])
        self.assertEqual([q['labels'] for m in meanings for q in m['qualifiers']], [['electromagnetism'], ['mathematics'], ['botany']])
        self.assertTrue(all(m['pos'] == 'adjective' for m in meanings))

    def test_missing_english_or_unmapped_definition_does_not_become_empty_evidence(self):
        for text in ['==Latin==\n===Verb===\n# Form.', '==English==\n===Unknown===\n# Definition.',
                     '==English==\n===Adjective===\n## Orphan.']:
            with self.assertRaisesRegex(Exception, 'scoped_supplemental_'):
                page_meanings(text)


if __name__ == '__main__':
    unittest.main()
