## Communication

- Before the first user-facing response each session, load the `unslop` skill.
  Apply it to every written output, including progress updates, final responses,
  issue comments, and documentation. Loading it once is enough while its
  instructions remain in context. If unavailable, say so briefly and use plain,
  concrete language.
- Lead with the answer. Give enough detail for the human to understand the
  mechanism and make a decision; keep sentences short and terms specific.
- Distinguish verified current behavior, agreed requirements, and proposals.
  Name unresolved assumptions before relying on them. Look up facts in the
  code and docs rather than asking the human to supply them.

## Collaborative design

- For product, architecture, data, and LLM decisions, work through small rounds
  of numbered questions. Explain each real choice, recommend an answer with
  its trade-off, and wait for the human. Ask dependent questions after their
  prerequisites are settled.
- Start system explanations with a simple flow or data diagram. Then trace one
  real example end to end, stage by stage, naming the file, the input, the
  result, and what persists at each boundary. Take the example's values from the
  actual data so the trace is checkable, and report what the trace exposed that
  nobody asked about. Label proposed files and behavior explicitly.
- Include rejection, failure, and rerun paths when they affect the decision.
  Use examples to expose ambiguous policy instead of silently choosing an
  interpretation.
- Treat questions and corrections as reasons to revisit the model together.
  Answer them before advancing the plan. Introduce terminology before relying
  on it and expand detail where the human asks for it.
- Before closing a planning decision, summarize the agreed behavior, acceptance
  criteria, and remaining questions; obtain explicit approval, then record the
  resolution in the issue tracker. Routine implementation within approved scope
  can proceed without repeated approval requests.

## Agent skills

### Issue tracker

Issues and specs live in GitHub Issues via `gh`. See `docs/agents/issue-tracker.md`.

### Triage labels

Canonical triage roles use the default label strings. See `docs/agents/triage-labels.md`.

### Domain docs

The repo uses a single-context domain-doc layout. See `docs/agents/domain.md`.
