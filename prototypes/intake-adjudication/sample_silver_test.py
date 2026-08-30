import unittest

from sample_silver import CandidateClaim, select_stratified, stable_rank


class SilverSamplingTest(unittest.TestCase):
    def test_rank_is_stable_and_seeded(self):
        self.assertEqual(
            stable_rank("rebut|affix_strip", "calibration-v1"),
            stable_rank("rebut|affix_strip", "calibration-v1"),
        )
        self.assertNotEqual(
            stable_rank("rebut|affix_strip", "calibration-v1"),
            stable_rank("rebut|affix_strip", "another-seed"),
        )

    def test_selection_keeps_required_coverage_before_hash_filling(self):
        claims = [
            CandidateClaim(
                lemma=f"word{i}",
                rule_kind="affix_strip",
                tags=frozenset({tag}) if tag else frozenset(),
            )
            for i, tag in enumerate(
                ["endorsed", "polysemous", "multi_flag", "wiktionary_label", None, None]
            )
        ]

        selected = select_stratified(
            claims,
            quota=5,
            seed="test",
            coverage_tags=("endorsed", "polysemous", "multi_flag", "wiktionary_label"),
            minimum_per_tag=1,
        )

        selected_tags = set().union(*(claim.tags for claim in selected))
        self.assertEqual(len(selected), 5)
        self.assertTrue(
            {"endorsed", "polysemous", "multi_flag", "wiktionary_label"}.issubset(
                selected_tags
            )
        )

    def test_selection_fails_instead_of_silently_weakening_a_stratum(self):
        claims = [
            CandidateClaim("plain", "affix_strip", frozenset({"unendorsed"}))
        ]

        with self.assertRaisesRegex(ValueError, "endorsed"):
            select_stratified(
                claims,
                quota=1,
                seed="test",
                coverage_tags=("endorsed",),
                minimum_per_tag=1,
            )


if __name__ == "__main__":
    unittest.main()
