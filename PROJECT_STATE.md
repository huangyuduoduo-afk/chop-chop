# Chop chop project state

5.0 implementation, 2026-09-21. Actual static application is index.html plus assets/v5*. The older assets/app.js is not its runtime entry. See docs/v5/BASELINE.md for the 4.5.8 baseline, IMPLEMENTATION.md for additive data contracts, ACCEPTANCE.md for honest tested/untested boundaries and RELEASE.md for deployment evidence.

Never clear user storage, rewrite the whole legacy entry, alter protected merge/deletion semantics, or force-push the stale local checkout. Preserve stable record IDs. Only synthetic data in isolated origins for tests.
