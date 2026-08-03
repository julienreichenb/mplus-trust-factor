# Definition of done (agents)

An agent task is done when:

1. **Scope** matches the prompt (no opportunistic refactors).
2. **Code vs docs** conflicts found during the work are either fixed in-scope or listed under deviations / follow-ups.
3. **Tests:** narrowest relevant tests plus lint / typecheck / build for affected areas; full `pnpm test` when practical.
4. **Commands + results** recorded in the handoff.
5. **No live WCL spend** unless the prompt allows it.
6. **Commit** on the assigned branch; no merge unless the prompt requires it.
7. **Probes / calibration artifacts** not deleted unless the prompt explicitly allows it.

Docs-only agents must still keep lint/build/typecheck/tests green if they touch tracked code (for example design tokens or brand assets).
