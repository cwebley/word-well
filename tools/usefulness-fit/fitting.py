"""Inclusion fitting and ordinal comparisons. Familiarity is never a target here."""

import math
import numpy as np
import sklearn
from sklearn.linear_model import LogisticRegression
from sklearn.model_selection import StratifiedKFold, cross_val_predict
from sklearn.pipeline import make_pipeline
from sklearn.preprocessing import FunctionTransformer, StandardScaler

from storage import digest, now


def metrics(rows):
    return {"cases": len(rows), "correct": sum(r["expected"] == r["predicted"] for r in rows),
            "wrong_admits": sum(r["expected"] == "exclude" and r["predicted"] == "keep" for r in rows),
            "wrong_excludes": sum(r["expected"] == "keep" and r["predicted"] == "exclude" for r in rows)}


def divide_by_ranges(data, scales):
    return data / np.asarray(scales)


def fit_model(rows, *, c=1.0, threshold=.5, scaling="standard", answerability="include", ranges=None):
    if not math.isfinite(c) or c <= 0 or not math.isfinite(threshold) or not 0 < threshold < 1:
        raise ValueError("C must be positive and threshold strictly between zero and one")
    if len({r["headword"].casefold() for r in rows}) != len(rows):
        raise ValueError("Each headword must have exactly one aggregated training row")
    if scaling not in ("standard", "natural") or answerability not in ("include", "diagnostic"):
        raise ValueError("Unknown scaling or answerability mode")
    input_names = sorted(rows[0]["features"]) if rows else []
    if not input_names or any(sorted(r["features"]) != input_names for r in rows):
        raise ValueError("Training features must be complete and consistent")
    excluded = [n for n in input_names if answerability == "diagnostic"
                and (n == "usefulness.answerability" or n.startswith("usefulness.answerability."))]
    names = [n for n in input_names if n not in excluded]
    if not names:
        raise ValueError("No predictive features remain")
    if any(r["decision"] not in ("keep", "exclude") or r["strength"] != "firm" for r in rows):
        raise ValueError("Only firm keep/exclude labels may train the inclusion model")
    x = np.array([[r["features"][n] for n in names] for r in rows])
    y = np.array([int(r["decision"] == "keep") for r in rows])
    if not np.isfinite(x).all() or min(sum(y == 0), sum(y == 1)) < 2:
        raise ValueError("Finite features and at least two labels of each class are required")
    if scaling == "natural":
        if ranges is None or set(ranges) != set(input_names) or any(not math.isfinite(v) or v <= 0 for v in ranges.values()):
            raise ValueError("Natural scaling requires a positive rubric range for every measurement")
        if any(not math.isfinite(r["features"][n]) or not 0 <= r["features"][n] <= ranges[n] + 1e-9 for r in rows for n in input_names):
            raise ValueError("Measurement outside its rubric range")
        scales = [ranges[n] for n in names]
        transformer = FunctionTransformer(divide_by_ranges, kw_args={"scales": scales}, validate=True)
    else:
        transformer = StandardScaler()
    estimator = make_pipeline(transformer, LogisticRegression(C=c, solver="lbfgs", max_iter=2000, random_state=23))
    folds = min(5, int(min(sum(y == 0), sum(y == 1))))
    # All three Jev trials are averaged before splitting. The scaler fits only
    # the training portion of each fold, never the left-out words.
    cv = StratifiedKFold(n_splits=folds, shuffle=True, random_state=23)
    splits = list(cv.split(x, y))
    fold_ids = [[rows[i]["id"] for i in test] for _, test in splits]
    probabilities = cross_val_predict(estimator, x, y, cv=splits, method="predict_proba")[:, 1]
    diagnostics = [{"id": r["id"], "headword": r["headword"], "expected": r["decision"],
                    "predicted": "keep" if p >= threshold else "exclude", "keep_score": float(p)}
                   for r, p in zip(rows, probabilities)]
    estimator.fit(x, y)
    scaler, model = estimator.steps[0][1], estimator.steps[1][1]
    result = {"schema": "wordwell-inclusion-fit/v2", "created_at": now(), "sklearn_version": sklearn.__version__,
              "method": "L2 logistic regression", "scaling": scaling, "answerability": answerability,
              "C": c, "threshold": threshold, "input_feature_names": input_names, "excluded_features": excluded,
              "rubric_ranges": ranges if scaling == "natural" else None,
              "feature_names": names, "mean": scaler.mean_.tolist() if scaling == "standard" else [0.] * len(names),
              "scale": scaler.scale_.tolist() if scaling == "standard" else scales,
              "coefficients": model.coef_[0].tolist(), "intercept": float(model.intercept_[0]),
              "training": rows, "training_digest": digest(rows), "cv_folds": folds,
              "cv_test_case_ids": fold_ids, "cv_split_digest": digest(fold_ids),
              "development_cv": {"summary": metrics(diagnostics), "rows": diagnostics,
                                 "status": "Development diagnostic on previously inspected words, not held-out accuracy"},
              "score_status": "Uncalibrated inclusion-model score, not familiarity or measured correctness probability"}
    result["id"] = digest({k: v for k, v in result.items() if k != "created_at"})
    return result


def predict(model, values):
    if set(values) != set(model.get("input_feature_names", model["feature_names"])):
        raise ValueError("Prediction features do not match the fitted model")
    if any(type(v) not in (int, float) or not math.isfinite(v) for v in values.values()):
        raise ValueError("Prediction measurements must be finite numbers")
    if model.get("scaling") == "natural" and any(not 0 <= values[n] <= bound + 1e-9 for n, bound in model["rubric_ranges"].items()):
        raise ValueError("Prediction measurement outside its rubric range")
    terms = {n: ((values[n] - m) / s) * c for n, m, s, c in
             zip(model["feature_names"], model["mean"], model["scale"], model["coefficients"])}
    logit = model["intercept"] + sum(terms.values())
    score = 1 / (1 + math.exp(-logit)) if logit >= 0 else math.exp(logit) / (1 + math.exp(logit))
    return {"decision": "keep" if score >= model["threshold"] else "exclude", "keep_score": score,
            "threshold": model["threshold"], "contributions": terms}


def compare_placements(cases, records, value):
    """Both Zipf and school understanding increase toward the familiar end."""
    levels = {"easy": 0, "middle": 1, "advanced": 2}
    placed = [(c, records[c["id"]]["placement"]) for c in cases
              if records[c["id"]]["decision"] == "keep" and records[c["id"]]["placement"] in levels
              and value(c) is not None]
    result = {"placed_keeps": len(placed), "comparable_pairs": 0, "agree": 0, "disagree": 0,
              "model_ties": 0, "within_owner_band_pairs": 0}
    for i, (a, level_a) in enumerate(placed):
        for b, level_b in placed[i + 1:]:
            owner_gap = levels[level_a] - levels[level_b]
            if owner_gap == 0:
                result["within_owner_band_pairs"] += 1
                continue
            result["comparable_pairs"] += 1
            model_gap = value(b) - value(a)
            result["model_ties" if abs(model_gap) < 1e-12 else
                   "agree" if model_gap * owner_gap > 0 else "disagree"] += 1
    return result
