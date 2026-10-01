"""Fit the usefulness combiner from a committed dataset and saved Jev answers.

Writes two files:
  - the public combiner (numbers only), read by pipeline/stages/usefulness.ts
  - a private fit report with training rows and cross-validated predictions

Features match the TypeScript stage: usefulness.<question> for Noul and score
answers, usefulness.<question>.<option> for choice answers, each averaged over
three trials. Only complete, non-soft cases train the model.

Usage:
  python3 tools/usefulness-fit/fit.py DATASET_JSON COMBINER_DIR PRIVATE_REPORT_JSON ANSWERS_JSON [ANSWERS_JSON ...]
      [--extra-questions CANDIDATE_JSON] [--threshold 0.6]

--extra-questions adds candidate questions (a JSON file shaped like
pipeline/stages/usefulness-questions.json) to the gate's own, to measure
whether they help before they join the gate.
"""

import argparse
import hashlib
import json
from pathlib import Path

from fitting import fit_model

TRIALS = 3
QUESTIONS_PATH = Path(__file__).resolve().parents[2] / "pipeline/stages/usefulness-questions.json"


def state(case):
    return ("HEADWORD\nword: " + case["headword"] + "\nrecorded parts of speech: "
            + (", ".join(case["partsOfSpeech"]) or "none recorded"))


def load_answers(paths, questions):
    found = {}
    for path in paths:
        data = json.loads(Path(path).read_text())
        for name, question in questions.items():
            if name in data["questions"] and data["questions"][name] != question:
                raise ValueError(f"{path} was answered with different text for {name}")
        for a in data["answers"]:
            found.setdefault((a["state"], a["question"], a["trial"]), a["answer"])
    return found


def features(case, questions, answers):
    result = {}
    for name, question in questions.items():
        trials = [answers.get((state(case), name, t)) for t in range(1, TRIALS + 1)]
        if any(a is None for a in trials):
            return None
        if question["type"] in ("noul", "score"):
            result["usefulness." + name] = sum(a[question["type"]] for a in trials) / TRIALS
        else:
            for option in question["criteria"]:
                result["usefulness." + name + "." + option] = sum(a["probabilities"][option] for a in trials) / TRIALS
    return result


def main(dataset_path, combiner_dir, report_path, answer_paths, extra_questions=None, threshold=0.5):
    dataset_bytes = Path(dataset_path).read_bytes()
    dataset = json.loads(dataset_bytes)
    questions = json.loads(QUESTIONS_PATH.read_text())
    if extra_questions:
        questions.update(json.loads(Path(extra_questions).read_text()))
    answers = load_answers(answer_paths, questions)
    rows, skipped = [], []
    for case in dataset["cases"]:
        if case["category"] == "soft":
            continue
        values = features(case, questions, answers)
        if values is None:
            skipped.append(case["headword"])
            continue
        rows.append({"id": case["id"], "headword": case["headword"], "decision": case["expected"],
                     "strength": "firm", "features": values})
    fit = fit_model(rows, threshold=threshold)
    public = {k: fit[k] for k in ("schema", "id", "method", "C", "threshold", "scaling", "sklearn_version",
                                  "input_feature_names", "excluded_features", "feature_names",
                                  "mean", "scale", "coefficients", "intercept", "training_digest")}
    public["dataset"] = {"name": dataset["name"], "version": hashlib.sha256(dataset_bytes).hexdigest()}
    public["training_cases"] = len(rows)
    out = Path(combiner_dir) / f"usefulness-combiner-{fit['id'][:12]}.json"
    out.write_text(json.dumps(public, indent=2) + "\n")
    Path(report_path).write_text(json.dumps({**fit, "skipped_incomplete": skipped}, indent=1))
    cv = fit["development_cv"]["summary"]
    print(f"trained on {len(rows)} cases, skipped {len(skipped)} incomplete: {', '.join(skipped)}")
    print(f"cross-validated: {cv}")
    print(f"combiner -> {out}\nprivate report -> {report_path}")


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("dataset"); parser.add_argument("combiner_dir"); parser.add_argument("report")
    parser.add_argument("answers", nargs="+"); parser.add_argument("--extra-questions")
    parser.add_argument("--threshold", type=float, default=0.5, help="keep-score cutoff; choose it from development data only")
    a = parser.parse_args()
    main(a.dataset, a.combiner_dir, a.report, a.answers, a.extra_questions, a.threshold)
