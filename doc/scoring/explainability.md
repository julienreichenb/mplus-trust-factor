# Explainability

`explainScore` / snapshot `explanation` includes:

- Top 3 positive metric contributors
- Top 3 negative metric contributors
- Missing high-impact metrics (by configured weight)
- Source provider categories present
- Major authenticity evidence highlights
- Short **public** summary (no event-by-event gaming surface)
- Detailed **admin** summary (model key/version, dimension scores, tags)

Public copy uses probabilistic language for boost tags. Model metadata (`modelKey`, `modelVersion`, `inputFingerprint`) is always present for reproducibility.
