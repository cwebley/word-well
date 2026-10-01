"""Convert the usefulness lab's saved Jev answers into the replay format read by
pipeline/execution/jev.ts (wordwell-jev-answers/v1).

The lab keyed each answer by a digest of endpoint, provider, state, question
and trial. This script recomputes those keys with the lab's own rules, so it
must read the lab's configuration unchanged. The output drops the endpoint and
provider: replay matches on model, state, exact question definition and trial.

Usage:
  python3 tools/usefulness-fit/export_lab_answers.py SNAPSHOT_DIR CONFIG_NAME OUT_PATH
"""

import hashlib
import json
import sys
from pathlib import Path


def digest(value):
    return hashlib.sha256(json.dumps(value, sort_keys=True, ensure_ascii=True,
                                     allow_nan=False, separators=(",", ":")).encode()).hexdigest()


def usefulness_state(word):
    return ("HEADWORD\nword: " + word["headword"] + "\nrecorded parts of speech: "
            + (", ".join(word["parts_of_speech"]) or "none recorded"))


def main(snapshot, config_name, out_path):
    snapshot = Path(snapshot)
    config = json.loads((snapshot / config_name).read_text())
    words = json.loads((snapshot / "words.json").read_text())
    cache = json.loads((snapshot / "measurements.json").read_text())
    group = config["groups"]["usefulness"]
    records = []
    for word in sorted(words.values(), key=lambda w: w["headword"]):
        state = usefulness_state(word)
        for name, question in group["questions"].items():
            for trial in range(1, config["trials"] + 1):
                key = digest({"endpoint": config["endpoint"], "model": group["model"],
                              "provider": group["provider"], "state": state,
                              "name": name, "question": question, "trial": trial})
                if key in cache:
                    records.append({"model": group["model"], "state": state, "question": name,
                                    "trial": trial, "answer": cache[key]["answer"]})
    out = {"schema": "wordwell-jev-answers/v1",
           "source": {"snapshot": str(snapshot), "config": config_name,
                      "endpoint": config["endpoint"], "config_sha256": digest(config)},
           "questions": group["questions"], "answers": records}
    Path(out_path).write_text(json.dumps(out, indent=1))
    print(f"{len(records)} answers for {len(words)} words -> {out_path}")


if __name__ == "__main__":
    main(*sys.argv[1:])
