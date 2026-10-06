"""Harmless checks of the pinned English parser's evidence-bearing fields."""

from pathlib import Path
import tempfile
import unittest

from extract import context
from wiktextract.page import parse_page


class MappingTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.addCleanup(self.temporary.cleanup)
        self.wxr = context(Path(self.temporary.name) / "resources.sqlite")
        self.addCleanup(self.wxr.remove_unpicklable_objects)

    def test_nested_labels_inherit_without_losing_path_or_negation(self):
        data = parse_page(self.wxr, "fixture", """==English==
===Noun===
# (literary) A test object.
## A specific object.
## A second specific object.
# (not offensive) A neutral test object.
""")
        meanings = data[0]["senses"]
        self.assertEqual(meanings[0]["glosses"], ["A test object.", "A specific object."])
        self.assertIn("literary", meanings[0]["tags"])
        self.assertIn("literary", meanings[1]["tags"])
        self.assertIn("(literary)", meanings[0]["raw_glosses"][0])
        self.assertNotIn("offensive", meanings[-1].get("tags", []))
        self.assertIn("not offensive", str(meanings[-1]))

    def test_lexical_meanings_and_directed_form_targets_coexist(self):
        data = parse_page(self.wxr, "fixtures", """==English==
===Noun===
# Plural of [[fixture]].
# A collection used in a test.
""")
        meanings = data[0]["senses"]
        self.assertEqual(meanings[0]["form_of"], [{"word": "fixture"}])
        self.assertIn("form-of", meanings[0]["tags"])
        self.assertEqual(meanings[1]["glosses"], ["A collection used in a test."])
        self.assertNotIn("form_of", meanings[1])

    def test_alternative_spelling_relation_points_to_target_without_claiming_preference(self):
        data = parse_page(self.wxr, "colour", """==English==
===Noun===
# (British) Alternative spelling of [[color]].
""")
        meaning = data[0]["senses"][0]
        self.assertEqual(data[0]["word"], "colour")
        self.assertEqual(meaning["alt_of"], [{"word": "color"}])
        self.assertIn("British", meaning["tags"])
        # A British label plus generic alt_of does not establish preference.
        self.assertIn("Alternative spelling", meaning["glosses"][0])

    def test_pronunciation_and_origin_stay_with_their_etymology(self):
        self.wxr.wtp.add_page("Template:IPA", 10,
            '[[Wiktionary:International Phonetic Alphabet|IPA]]<sup>([[Appendix:English pronunciation|key]])</sup>:&#32;<span class="IPA">{{{2}}}</span>')
        data = parse_page(self.wxr, "tee", """==English==
===Etymology 1===
Etymology 1
====Pronunciation====
* {{IPA|en|/ˈtiː/}}
====Noun====
# The name of the letter T.
====Verb====
# To redirect output to multiple destinations.
===Etymology 2===
Etymology 2
====Pronunciation====
* {{IPA|en|/ˈtaː/}}
====Noun====
# A flat area of ground.
""")
        self.assertEqual([entry["pos"] for entry in data], ["noun", "verb", "noun"])
        self.assertEqual(data[0]["sounds"], [{"ipa": "/ˈtiː/"}])
        self.assertEqual(data[1]["sounds"], data[0]["sounds"])
        self.assertEqual(data[2]["sounds"], [{"ipa": "/ˈtaː/"}])
        self.assertEqual(data[0]["etymology_text"], "Etymology 1")
        self.assertEqual(data[2]["etymology_text"], "Etymology 2")


if __name__ == "__main__":
    unittest.main()
