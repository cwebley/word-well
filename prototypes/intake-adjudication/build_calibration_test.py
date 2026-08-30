import unittest

from build_calibration import GOLDEN_CLAIMS, select_members


class CalibrationSelectionTest(unittest.TestCase):
    def test_selects_two_or_more_claims_from_every_rule_kind(self):
        claims = [
            {
                "claim_id": claim_id,
                "input_digest": f"digest-{index}",
                "claim": {"rule_kind": claim_id.split("|")[1]},
            }
            for index, claim_id in enumerate(GOLDEN_CLAIMS)
        ]
        metadata = {
            claim_id: {"coverage_tags": ["unendorsed"]} for claim_id in GOLDEN_CLAIMS
        }

        members = select_members(claims, metadata)

        self.assertEqual(len(members), 12)
        self.assertTrue(all(member["partition"] == "development" for member in members))
        counts = {}
        for member in members:
            counts[member["rule_kind"]] = counts.get(member["rule_kind"], 0) + 1
        self.assertTrue(all(count >= 2 for count in counts.values()))


if __name__ == "__main__":
    unittest.main()
