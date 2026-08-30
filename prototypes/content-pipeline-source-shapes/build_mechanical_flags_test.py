import unittest

from build_mechanical_flags import (
    DOMINANT_SHARE_MIN,
    RARE_SINGULAR_ZIPF,
    display_shift,
    is_place_adjective,
)


class FakeSynset:
    def __init__(self, pos, definition):
        self.pos = pos
        self._definition = definition

    def definition(self):
        return self._definition


def row(**overrides):
    base = {
        "lemma": "shenanigan",
        "pos": "n",
        "zipf_own": 1.53,
        "zipf_summed": 3.22,
        "dominant_form": "shenanigans",
        "dominant_share": 0.98,
    }
    base.update(overrides)
    return base


class DisplayShiftTest(unittest.TestCase):
    def test_promotes_a_plural_whose_singular_nobody_writes(self):
        shift = display_shift(row())
        self.assertIsNotNone(shift)
        self.assertEqual(shift["serve"], "shenanigans")

    def test_leaves_a_verb_alone_so_a_participle_never_replaces_its_lemma(self):
        # `underrate` -> `underrated` clears every frequency test and is still
        # the wrong word to teach: the participle is an inflection, not a lemma.
        self.assertIsNone(
            display_shift(
                row(lemma="underrate", pos="v", dominant_form="underrated", zipf_own=1.9)
            )
        )

    def test_leaves_a_singular_people_actually_write(self):
        # `guideline` is common on its own, so nothing is gained by switching.
        self.assertIsNone(
            display_shift(
                row(lemma="guideline", dominant_form="guidelines", zipf_own=3.25)
            )
        )

    def test_requires_the_plural_to_dominate(self):
        self.assertIsNone(display_shift(row(dominant_share=DOMINANT_SHARE_MIN - 0.01)))

    def test_requires_a_regular_plural_not_any_commoner_form(self):
        self.assertIsNone(display_shift(row(dominant_form="shenaniganry")))

    def test_boundary_singular_frequency_is_excluded(self):
        self.assertIsNone(display_shift(row(zipf_own=RARE_SINGULAR_ZIPF)))


class PlaceAdjectiveTest(unittest.TestCase):
    def test_flags_an_adjective_glossed_only_as_relating_to_a_proper_noun(self):
        self.assertTrue(
            is_place_adjective(
                FakeSynset("a", "of or relating to or characteristic of Texas or its residents")
            )
        )

    def test_ignores_a_general_sense(self):
        self.assertFalse(
            is_place_adjective(FakeSynset("s", "brief and to the point; effectively cut short"))
        )

    def test_ignores_nouns(self):
        self.assertFalse(is_place_adjective(FakeSynset("n", "of or relating to Texas")))

    def test_requires_a_proper_noun_not_merely_a_relational_gloss(self):
        self.assertFalse(
            is_place_adjective(FakeSynset("a", "of or relating to the study of birds"))
        )


if __name__ == "__main__":
    unittest.main()
