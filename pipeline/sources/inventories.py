"""Verify OEWN XML and materialize the complete pinned English frequency list."""

from collections import Counter
import gzip
import hashlib
import importlib.metadata
import importlib.resources
import json
import math
from pathlib import Path

from prepare import PreparationError, atomic_json, file_identity


def write_line(output, data):
    output.write(json.dumps(data, ensure_ascii=False, separators=(",", ":")) + "\n")


def oewn(root, directory):
    from lxml import etree
    counts = Counter()
    identifiers = set()
    referenced = set()
    declared_concepts = set()
    with gzip.open(root / "downloads/english-wordnet-2025.xml.gz", "rb") as source:
        for _, element in etree.iterparse(source, events=("end",), tag=("LexicalEntry", "Synset")):
            kind = element.tag
            identifier = element.get("id")
            if not identifier or identifier in identifiers:
                raise PreparationError("invalid_oewn_source_identity")
            identifiers.add(identifier)
            if kind == "LexicalEntry":
                lemma = element.find("Lemma")
                if lemma is None or not lemma.get("writtenForm") or not lemma.get("partOfSpeech"):
                    raise PreparationError("missing_oewn_lemma_or_pos")
                for meaning in element.findall("Sense"):
                    meaning_id = meaning.get("id")
                    if not meaning_id or meaning_id in identifiers or not meaning.get("synset"):
                        raise PreparationError("invalid_oewn_meaning_identity")
                    identifiers.add(meaning_id)
                    referenced.add(meaning.get("synset"))
                    counts["source_meanings"] += 1
            else:
                declared_concepts.add(identifier)
                if not element.findall("Definition"):
                    raise PreparationError("missing_oewn_definition")
            counts[kind] += 1
            element.clear(keep_tail=True)
            while element.getprevious() is not None:
                del element.getparent()[0]
    if not counts["LexicalEntry"] or not counts["Synset"] or referenced - declared_concepts:
        raise PreparationError("incomplete_oewn_inventory")
    atomic_json(directory / "oewn-coverage.json", {"status": "verified", "counts": dict(counts),
               "unresolvedConceptReferences": 0, "originalXmlRetained": True})
    return dict(counts)


def frequency(root, directory):
    import wordfreq
    if importlib.metadata.version("wordfreq") != "3.1.1":
        raise PreparationError("wordfreq_version_mismatch")
    data_path = Path(wordfreq.available_languages(wordlist="large")["en"])
    frequencies = wordfreq.get_frequency_dict("en", wordlist="large")
    target = directory / "frequency.jsonl"
    counts = Counter()
    with target.open("w", encoding="utf-8") as output:
        for order, form in enumerate(wordfreq.iter_wordlist("en", wordlist="large"), 1):
            tokens = wordfreq.tokenize(form, "en")
            direct = len(tokens) == 1 and tokens[0] in frequencies
            write_line(output, {"order": order, "form": form, "tokens": tokens,
                       "storedFrequency": frequencies[form],
                       "directZipf": wordfreq.zipf_frequency(form, "en", wordlist="large") if direct else None})
            counts["forms"] += 1
            counts["direct" if direct else "unscored"] += 1
    if counts["forms"] != len(frequencies) or not counts["forms"]:
        raise PreparationError("incomplete_frequency_inventory")
    data_identity = file_identity(data_path)
    # Keep the exact data bytes separately from the package for later import.
    data_target = directory / data_path.name
    data_target.write_bytes(data_path.read_bytes())
    atomic_json(directory / "frequency-coverage.json", {
        "status": "verified", "version": "3.1.1", "language": "en", "wordlist": "large",
        "counts": dict(counts), "dataArtifact": {"filename": data_path.name, **data_identity},
        "output": {"filename": target.name, **file_identity(target)},
    })
    return dict(counts)
