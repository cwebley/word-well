# Acquiring a pre-extracted Wiktionary corpus

Checked 2026-10-06. Research only. Findings below come from publisher pages,
versioned extractor documentation, HTTP headers and bounded samples. No full
corpus was downloaded. Recommendations are proposals, not approved source changes.

## Answer

Kaikki publishes the full raw Wiktextract extraction. Downloading it avoids local
template and Lua expansion, including the current job's expansion before English
filtering. The published gzip is 2.8GB. This makes acquisition a download and
JSONL-filtering task, but does **not** establish an hours-to-completion promise.
Download, decompression and acceptance time were not measured. [1], [4]

It is not a verified replacement for our exact pinned extraction. Kaikki identifies
a different pair of parser commits, describes its input as a dump dated
2026-09-02, and does not supply our original-page/revision manifest. No matching
dated Kaikki artifact was found in the checked publisher pages. [1], [2], [5]

```text
Published route
Kaikki's already-expanded raw JSONL.gz
  -> decompress and retain records with lang_code == "en"
  -> preserve nested records, then check field coverage and provenance

Current requirement
official enwiktionary 20260901 + pinned parsers
  -> original pages/revisions + expanded records + diagnostics
```

The published route is a proposal. It would need a source decision before adoption.

## Findings: downloads and counts

Sizes in the second column reproduce publisher wording. Exact bytes come from
HTTP HEAD checks, not a full download. [1], [2], [6]

| Dataset | Published size | Compression and measured HTTP size | Scope |
| --- | --- | --- | --- |
| Kaikki raw English-edition extraction | 23.9GB JSONL; 2.8GB gzip | JSONL 25,614,284,530 bytes; gzip 2,981,058,381 bytes | All extracted languages in **enwiktionary**, not just English words. Filter `lang_code == "en"`. [1], [3] |
| Kaikki English-only website data | 3.1GB JSONL | JSONL 3,335,546,346 bytes; companion `.jsonl.gz` responds HTTP 200 with 523,331,798 bytes | Postprocessed, deprecated. The English landing page links only the uncompressed file. [2] |
| Kaikki Simple English-edition raw extraction | 36.1MB JSONL; 4.5MB gzip | Both variants linked | From **simplewiktionary**, a separate wiki. It cannot supply full enwiktionary coverage. [6] |

Download URLs:

- Full raw gzip: <https://kaikki.org/dictionary/raw-wiktextract-data.jsonl.gz>
- Full raw JSONL: <https://kaikki.org/dictionary/raw-wiktextract-data.jsonl>
- Deprecated English-only JSONL: <https://kaikki.org/dictionary/English/kaikki.org-dictionary-English.jsonl>
- Observed English-only gzip: <https://kaikki.org/dictionary/English/kaikki.org-dictionary-English.jsonl.gz>
- Simple English raw gzip: <https://kaikki.org/simplewiktionary/raw-wiktextract-data.jsonl.gz>

Kaikki's website publishes **1,787,236 English senses** and **1,390,507 distinct
English words**. Its all-language website count is 13,116,893 senses. These are
website counts, not verified raw JSONL line counts, source-page counts, or counts
of lesson candidates. One raw JSONL record can contain several senses. Simple
English's website publishes 73,111 senses. [2], [4], [18]

The smaller English file is not merely a lossless language split. Kaikki says its
website processing removes details, disambiguates information and merges other
sources. The maintainer's deprecation issue says the raw extract is more complete,
postprocessing can lose information, and language-specific postprocessed downloads
will not receive replacements. The maintainer explicitly corrects the filtering
field to `lang_code`. [2], [3]

There is no advertised lossless English-only raw download on the checked pages.
Simple English is a different source, not a simplified encoding of enwiktionary.

## Findings: release identity and bounded HTTP checks

Kaikki's raw-data and English pages agree on this published identity: [1], [2]

| Identity | Kaikki currently publishes | Current project pin |
| --- | --- | --- |
| Input dump date | `2026-09-02` | official release `20260901` |
| Extraction date | `2026-10-03` | project extraction attempt identity |
| Wiktextract | `1a05e46f9efbccda6a2b2f8e21b30a9c0c46513a` | `d6fca2773bc90b9157248b9edf69585da06bf393` |
| wikitextprocessor | `e3d6d4edb77618f4d6680edc66e3f774bea59820` | `65e1673d15c3b06f1de84d1c34303fc8f68c3528` |

Project pins and manifest requirements were checked in `config/sources.lock.json`
and [source-preparation.md](../source-preparation.md). The date difference does not
prove different input bytes. Kaikki does not identify an exact input URL or checksum
on these pages, so equivalence with the official September release is unresolved.
The parser-commit difference is explicit.

Observed headers on 2026-10-06:

| Artifact | Last-Modified, UTC | ETag |
| --- | --- | --- |
| Full raw JSONL | `2026-10-03 08:20:56` | `"6ac0bae8-5f6baf6f2"` |
| Full raw gzip | `2026-10-03 08:24:38` | `"6ac0bbc6-b1af574d"` |
| English website JSONL | `2026-10-03 11:09:08` | `"6ac0e254-c6d065ea"` |
| English website gzip | `2026-10-03 11:09:45` | `"6ac0e279-1f3168d6"` |

All four HEAD responses advertised `Accept-Ranges: bytes`. Actual bounded GETs
confirmed HTTP 206 for raw JSONL bytes `0-262143/25614284530` and raw gzip bytes
`0-1023/2981058381`. The gzip prefix had magic bytes `1f8b`. These checks establish
range support for the current files, not download throughput or immutable releases.

The pages say updates usually occur at least weekly. The checked pages expose
rolling filenames, not a dated archive, a content-hash manifest, a complete
extraction command/configuration, or auxiliary-response identities. ETags are HTTP
validators, not published cryptographic checksums. [1]

## Findings: what the records retain and what they omit

The versioned English extractor model and README support nested senses, glosses,
raw glosses, tags/topics, forms, pronunciation, etymology text/templates/links,
entry-level and sense-level relations, examples, quotation references and
attestations. Optional fields are not a guarantee of complete extraction. The
README describes the output as containing "most" Wiktionary information. [5], [8]

A checkable example came from the raw JSONL range above, which contained two
complete records for `dictionary`:

1. The noun record has six senses. Its first sense contains the usage example
   `If you want to know the meaning of a word, look it up in the dictionary.`
   It also retains a quotation with `type: "quotation"` and a `ref` naming
   Andrew Radford, 1988, chapter 7, page 339.
2. The same record retains plural `dictionaries`, alternative obsolete
   `dictionnary`, and IPA `/ˈdɪk.ʃə.nə.ɹi/` tagged `Received-Pronunciation`.
   First-sense hypernyms include `wordbook` and `reference work`. Separate
   entry-level hypernyms include `catalog`, tagged `US`, and `catalogue`, tagged
   `UK`, with source `Thesaurus:dictionary`.
3. The verb record has three senses. Its first retains
   `raw_glosses: ["(transitive) To look up in a dictionary."]`, cleaned gloss
   `To look up in a dictionary.`, and `tags: ["transitive"]`.
4. The sample was inspected in memory. The persisted research here contains these
   observations, range coordinates and HTTP identity, not the full source rows.
   Neither record contains page/revision IDs or original page wikitext. [7]

This exposes a scope requirement: a filter must retain whole English records.
Flattening or combining relations would erase the distinction between a
sense-level `reference work` and entry-level thesaurus evidence. A bare
`lang_code == "en"` filter also excludes language-neutral hard redirects; the
README documents those separately. Whether the published raw corpus includes
every required redirect was not checked. [5]

| Project requirement | Fit of Kaikki raw data |
| --- | --- |
| English records and rich lexical fields | Closest published match found. Model and sample support the requested field families; corpus-wide completeness remains unverified. [5], [8] |
| Exact pinned source/parser result | Not established. Parser commits differ; exact dump bytes and a matching archived extraction are unverified. [1] |
| Original page/revision manifest, timestamps, duplicate source occurrences | Not supplied by the documented English record model or checked download list. `word`, optional `original_title`, sense IDs and Wikidata IDs are not revision IDs. Original pages require a separate source artifact. [1], [8] |
| Full source quotation metadata | Examples retain `type`, `ref`, text and offsets. The model does not promise every original quote-template argument or a structured bibliography. Original pages remain necessary if "complete" means recoverable source metadata. [5], [8] |
| All original thesaurus relation/scope distinctions | Some merged relations retain `source: "Thesaurus:..."`. No separate original-term/occurrence manifest is advertised. Our documented preservation requirement is stronger than demonstrated stock output. [1], [7] |
| Original raw pages | "Raw" here means unpostprocessed **extracted JSONL**, not original wikitext. Module/template archives are available, but do not substitute for all original article pages and revision identities. [1], [5] |
| Coverage and diagnostics acceptance | Error JSON is published at 859.4MB, or 39.1MB gzip. The diagnostics page lists 10,820 Lua errors, 42,221 other errors and 21,008 warnings across the edition. These are not English-only failure rates or evidence of accepted completeness. [1], [9] |

## Findings: other primary publishers

**DBnary** publishes extracted Wiktionary data as RDF/Turtle with bzip2 compression.
Its current English core is listed as 209M, with etymology 112M, morphology 19K,
LIME metadata 7.0M, and computed translation enhancements 11M. These are separate
files, not one interchangeable replacement for Wiktextract JSONL. [10], [11]

A bounded download of its 20K statistics artifact identifies dump `20261001` and
reports 1,471,422 English pages, 1,516,264 lexical entries, 1,271,722 lexical senses,
and 3,640,819 translations. These metrics are DBnary's, not directly comparable
to Kaikki's website sense count. [12]

DBnary also has a **dated September 2026 extraction**. Its archive lists
`en_dbnary_ontolex_2026-09-01.ttl.bz2` at 208M and September etymology at 111M.
The small September statistics file explicitly says `wiktionaryDumpVersion
"20260901"`, with 1,465,619 pages, 1,509,476 entries and 1,265,684 senses. This
establishes availability of September-derived RDF, not the project's pinned
Wiktextract result or byte-equivalent source input. [13]

DBnary documents LIME metadata and core lexical relations, translations and
separate morphology/etymology. Its computed translation-to-sense links use a
non-perfect heuristic. Exact parser Git identity, original page/revision retention,
quotation-template fidelity and required label/scope coverage were not established.
The 19K morphology file should not be read as proof of full form coverage. [10]

An unexpected relevant finding: DBnary retracted July/August 2026 extracts because
incomplete Wikimedia dumps caused missing entries. Its September notice explains
the new hyphenated dump-date filenames, while RDF metadata keeps `20260901`.
This is a reason to verify actual input identity rather than equate dates across
publishers. [14]

**FreeDict** publishes compressed dictionary packages and source archives, with
versions, headword counts and checksums. The checked English listings are bilingual
dictionaries, not a full monolingual enwiktionary evidence corpus. They do not
offer a demonstrated solution to these preservation requirements. [15]

## Findings: licenses and previous research

Kaikki states that its data uses Wiktionary's CC-BY-SA and GFDL licenses. English
Wiktionary's current footer identifies CC-BY-SA 4.0. Its copyright page explains
that externally sourced material, including quotations, can have separate rights.
That page also marks itself outdated, so retain publisher notices rather than
assuming one blanket license covers quotations or audio. Wiktextract software is
MIT-licensed; that does not make the extracted dictionary data MIT. DBnary's site
states CC-BY-SA 3.0 for its dataset and MIT for its extractor. [4], [16], [17], [19]

Historical `word-well/docs/research/content-pipeline-source-shapes.md` recorded a
33-word Wiktionary API sample with retained revision IDs. It did not retry an
earlier broken Kaikki path. Its findings make sense-level labels, pronunciation
variants and etymology grouping relevant acceptance checks. That historical path
failure is not evidence against today's working bulk downloads.

## Proposals and unresolved choices

Recommend investigating the **full raw Kaikki gzip** for acquisition. The evidence
supports avoiding repeated expansion, without establishing an elapsed-time estimate.
Reject the deprecated website file and Simple English as substitutes for the full
evidence corpus unless requirements explicitly change.

Next evidence check: resolve Kaikki's input identity with the publisher. Ask for
the exact dump URL/checksum behind `2026-09-02`, extraction flags, and any archive
matching `20260901` plus our two pinned parser commits. Then check a small set of
raw records against retained original pages, including `nice` for etymology groups,
`sanction` for sense scope, and quoted examples for metadata fidelity. Website JSON
is postprocessed and cannot stand in for that raw-record comparison.

Requirements still needing a decision:

1. Must the corpus equal the existing source/parser pins, or may a separately
   identified publisher extraction qualify after review?
2. Must every extracted record retain original revision/page evidence, or is
   corpus-level attribution plus separately retained source pages acceptable?
   A manifest from a different dump cannot authenticate Kaikki's records.
3. Does "complete quotation metadata and relations" require every original
   template argument and thesaurus occurrence, or the fields stock Wiktextract
   returns? The published JSONL has not demonstrated the stronger requirement.

## Primary sources

[1]: https://kaikki.org/dictionary/rawdata.html
[2]: https://kaikki.org/dictionary/English/index.html
[3]: https://github.com/tatuylonen/wiktextract/issues/1178
[4]: https://kaikki.org/dictionary/index.html
[5]: https://github.com/tatuylonen/wiktextract/blob/1a05e46f9efbccda6a2b2f8e21b30a9c0c46513a/README.md
[6]: https://kaikki.org/simplewiktionary/rawdata.html
[7]: https://kaikki.org/dictionary/raw-wiktextract-data.jsonl
[8]: https://github.com/tatuylonen/wiktextract/blob/1a05e46f9efbccda6a2b2f8e21b30a9c0c46513a/src/wiktextract/extractor/en/type_utils.py
[9]: https://kaikki.org/dictionary/errors/errors.html
[10]: https://kaiko.getalp.org/about-dbnary/download/
[11]: https://kaiko.getalp.org/static/ontolex/latest/
[12]: https://kaiko.getalp.org/static/ontolex/latest/en_dbnary_statistics.ttl.bz2
[13]: https://kaiko.getalp.org/static/ontolex/en/
[14]: https://kaiko.getalp.org/about-dbnary/july-august-2026-extracts-have-been-retracted/
[15]: https://freedict.org/downloads/
[16]: https://en.wiktionary.org/wiki/Wiktionary:Copyrights
[17]: https://github.com/tatuylonen/wiktextract/blob/1a05e46f9efbccda6a2b2f8e21b30a9c0c46513a/LICENSE
[18]: https://kaikki.org/simplewiktionary/index.html
[19]: https://kaiko.getalp.org/about-dbnary/
