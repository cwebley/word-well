# WordWell Variable Type Research

## Decision

Use a **serif + humanist sans pairing**, not because a pairing is inherently required, but because WordWell has two clear jobs: make the headword and its explanation pleasant to read, then make controls and metadata recede. A single family is a credible lower-complexity alternative if it has a strong text optical size, but it gives up this useful role distinction.

**Recommended pairing: Source Serif 4 + Source Sans 3.** It is the calmest, lowest-risk fit: both are official Adobe projects, have roman and italic variable files, expose the same 200-900 weight range, and use SIL OFL 1.1. Use Source Serif for the wordmark, headword, definition, example, and guidance copy; use Source Sans for navigation, pronunciation, labels, controls, and compact metadata. [Source Serif variable CSS](https://raw.githubusercontent.com/adobe-fonts/source-serif/release/source-serif-variable.css) [Source Sans variable CSS](https://raw.githubusercontent.com/adobe-fonts/source-sans/release/source-sans-3VF.css) [Source Serif license](https://raw.githubusercontent.com/adobe-fonts/source-serif/release/LICENSE.md) [Source Sans license](https://raw.githubusercontent.com/adobe-fonts/source-sans/release/LICENSE.md)

## Typography Guidance

- Start with the reading copy, not the display word. Butterick identifies font, size, line spacing, and line length as the decisions that determine body text; current screens support either serif or sans for web body text. That supports a serif for WordWell's short editorial passages, not a claim that serif is universally more legible. [Body text](https://practicaltypography.com/body-text.html)
- For a calm reading card, make body copy roughly 16-20px, then test the actual font rather than treating a CSS size as absolute. Butterick's web guidance is 15-25px, with typeface-specific adjustment. [Typography in ten minutes](https://practicaltypography.com/typography-in-ten-minutes.html)
- Keep explanatory copy at 1.25-1.45 line-height and constrain longer passages to about 45-90 characters per line. The existing 42rem card is directionally appropriate; verify against actual copy and the selected font. [Line spacing](https://practicaltypography.com/line-spacing.html) [Line length](https://practicaltypography.com/line-length.html)
- Do not use variable axes as decoration. Set `wght` deliberately (around 400-450 for reading, 550-650 for restrained UI emphasis); enable `opsz` where provided. Avoid extreme width, grade, softness, or expressive axes in default reading states.

## Open-Licensed Candidates

All licenses below are SIL Open Font License 1.1 (OFL), which permits use, embedding, modification, and redistribution subject to its conditions. Each linked project is the official project repository; no aggregator was used as a license authority.

| Family | Best role | Available variable axes | Official source and license |
| --- | --- | --- | --- |
| **Source Serif 4** | Primary serif for headwords through long-form reading | `wght` 200-900; separate roman and italic variable files | [Variable files/CSS](https://raw.githubusercontent.com/adobe-fonts/source-serif/release/source-serif-variable.css), [OFL](https://raw.githubusercontent.com/adobe-fonts/source-serif/release/LICENSE.md) |
| **Literata** | Reading-first serif, also capable of headlines | `opsz` 7-72, `wght` 200-900; separate roman and italic files | [Project and axis configuration](https://raw.githubusercontent.com/googlefonts/literata/main/sources/config.yaml), [OFL](https://raw.githubusercontent.com/googlefonts/literata/main/OFL.txt) |
| **Roboto Serif** | Flexible single-family serif for text and display | `wdth` 50-150, `opsz` 8-144, `wght` 100-900, `GRAD` -50-100 | [Official designspace](https://raw.githubusercontent.com/googlefonts/roboto-serif/main/sources/RobotoSerif.designspace), [OFL](https://raw.githubusercontent.com/googlefonts/roboto-serif/main/OFL.txt) |
| **Fraunces** | More characterful headword/display serif; use normalized small optical sizes for reading | `opsz` 9-144, `wght` 100-900, `SOFT` 0-100, `WONK` 0-1 | [Official axis documentation](https://raw.githubusercontent.com/undercasetype/Fraunces/master/README.md), [OFL](https://raw.githubusercontent.com/undercasetype/Fraunces/master/OFL.txt) |
| **Source Sans 3** | Humanist UI sans; usable for compact supporting text | `wght` 200-900; separate roman and italic variable files | [Variable files/CSS](https://raw.githubusercontent.com/adobe-fonts/source-sans/release/source-sans-3VF.css), [OFL](https://raw.githubusercontent.com/adobe-fonts/source-sans/release/LICENSE.md) |
| **Atkinson Hyperlegible Next** | Accessibility-oriented UI sans and alternate single-family choice | `wght` (the official variable filenames identify this as its axis); roman and italic | [Variable font files](https://api.github.com/repos/googlefonts/atkinson-hyperlegible-next/contents/fonts/variable), [project rationale](https://raw.githubusercontent.com/googlefonts/atkinson-hyperlegible-next/main/README.md), [OFL](https://raw.githubusercontent.com/googlefonts/atkinson-hyperlegible-next/main/OFL.txt) |

## Pairing Shortlist

1. **Source Serif 4 + Source Sans 3**: first choice. Quiet, coherent, wide weight range, and the fewest implementation surprises. Source Serif carries the adult-learning editorial tone; Source Sans makes functional UI legible without looking clinical.
2. **Literata + Atkinson Hyperlegible Next**: reading-first and most accessibility-forward. Choose when the definition/example may grow into genuinely long sessions or when distinctive character recognition is a priority. The visual contrast is stronger than the Source pairing, so test together on device.
3. **Roboto Serif + Source Sans 3**: choose when one serif must flex across very small metadata, reading text, and very large headwords. Roboto Serif's optical-size and grade axes make it the most adjustable option; keep width at its default and grade at 0 unless testing demonstrates a need.

## One-Family Alternative

If bundle size and implementation simplicity outrank role contrast, use **Roboto Serif** alone: its `opsz` range covers micro through display and its grade axis can strengthen text without changing copyfit. This is sufficient for WordWell, but the preferred pairing remains easier to scan because controls no longer compete with the learning content.

## Visual-Language Prototype: Literata Sans Research (2026-08-26)

### Bookerly

**Do not use Amazon Bookerly as a WordWell webfont.** Amazon presents Bookerly as the font used by Kindle reading products, rather than publishing it as a downloadable webfont or under a public font licence. [Amazon Kindle Paperwhite announcement](https://www.aboutamazon.com/news/devices/new-amazon-kindle-paperwhite-our-best-reviewed-kindle-ever) The official Amazon and Dalton Maag public materials located for this review provide no `@font-face` delivery, font download, web-embedding terms, or permission for independent redistribution. It is therefore not legally available for this PWA without a direct licence from Amazon.

**No official Bookerly variable-font files were found.** The public material does not identify a variable release or any OpenType variation axes. Do not infer a variable font from files extracted from Kindle software: they are not an authorised webfont distribution. This is a distribution-and-licensing conclusion, not a claim that Amazon could never create a variable version.

### Open Variable Sans Shortlist

All six candidates are SIL Open Font License 1.1 (OFL) releases. OFL expressly permits embedding and redistribution with software, subject to its conditions, so self-hosting the unmodified fonts in the PWA is permitted. [SIL OFL 1.1](https://openfontlicense.org/open-font-license-official-text/)

| Family | Variable axes and official files | Official source and licence | Literata pairing rationale |
| --- | --- | --- | --- |
| **Instrument Sans** | `wdth` 75-100; `wght` 400-700; roman and italic variable files | [Project source](https://github.com/Instrument/instrument-sans), [OFL](https://raw.githubusercontent.com/Instrument/instrument-sans/master/OFL.txt) | First prototype choice. Its restrained range and compact, contemporary shapes keep navigation and controls quiet beside Literata's bookish texture. |
| **Host Grotesk** | `wght` 300-800; roman and italic variable files | [Project source](https://github.com/Element-Type/HostGrotesk), [OFL](https://raw.githubusercontent.com/Element-Type/HostGrotesk/main/OFL.txt) | A warmer grotesk contrast with enough low-end weight for unobtrusive metadata. It reads adult and editorial without mimicking the serif. |
| **Anek Latin** | `wdth` 75-125; `wght` 100-800; roman variable file | [Project source](https://github.com/EkType/Anek), [OFL](https://raw.githubusercontent.com/EkType/Anek/main/OFL.txt) | The most flexible spatial option. Its broad width range can make terse labels feel deliberate, but leave `wdth` at 100 for default UI to avoid a lively, poster-like tone. |
| **Bricolage Grotesque** | `opsz` 12-96; `wdth` 75-100; `wght` 200-800; roman variable file | [Project source](https://github.com/ateliertriay/bricolage), [OFL](https://raw.githubusercontent.com/ateliertriay/bricolage/main/OFL.txt) | The most expressive candidate, suited to the wordmark and selected headword treatment while Literata retains reading copy. Keep its expressive axes at defaults in functional UI. |
| **Figtree** | `wght` 300-900; roman and italic variable files | [Project source](https://github.com/erikdkennedy/figtree), [OFL](https://raw.githubusercontent.com/erikdkennedy/figtree/master/OFL.txt) | A calm, friendly humanist fallback for controls and onboarding. Its open forms soften Literata's formality without pushing the product toward a children's-learning aesthetic. |
| **Lexend** | `wght` 100-900; roman variable file | [Project source](https://github.com/googlefonts/lexend), [OFL](https://raw.githubusercontent.com/googlefonts/lexend/main/OFL.txt) | A deliberately high-recognition alternative for dense vocabulary lists and accessibility testing. Its broad, rounded voice is less editorial than the top choices, so validate the adult tone in the prototype. |

The axis ranges and filenames above are from the official Google Fonts source metadata, which names the upstream project repository and the shipped variable file for each family: [Instrument Sans metadata](https://raw.githubusercontent.com/google/fonts/main/ofl/instrumentsans/METADATA.pb), [Host Grotesk metadata](https://raw.githubusercontent.com/google/fonts/main/ofl/hostgrotesk/METADATA.pb), [Anek Latin metadata](https://raw.githubusercontent.com/google/fonts/main/ofl/aneklatin/METADATA.pb), [Bricolage Grotesque metadata](https://raw.githubusercontent.com/google/fonts/main/ofl/bricolagegrotesque/METADATA.pb), [Figtree metadata](https://raw.githubusercontent.com/google/fonts/main/ofl/figtree/METADATA.pb), and [Lexend metadata](https://raw.githubusercontent.com/google/fonts/main/ofl/lexend/METADATA.pb).

### Recommendation

Prototype **Literata + Instrument Sans** first, with **Host Grotesk** as the nearest alternative. Both leave Literata clearly responsible for definitions and examples while giving the PWA a contemporary, quiet interface. Test **Anek Latin** if label fit becomes a real constraint. Reserve **Bricolage Grotesque** for a more authored brand direction, and treat **Figtree** and **Lexend** as usability alternatives rather than the default visual-language choice.
