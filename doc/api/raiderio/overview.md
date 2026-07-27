# Raider.IO integration overview

Agent 3 owns a **minimal, replaceable** Raider.IO provider at `@mplus/provider-raiderio`. Wave 3 (Agent 13) hardens the live character profile path.

## Purpose

Supplement Blizzard and Warcraft Logs with:

- Current-season Mythic+ score summaries
- Gear / talent presence markers
- Run candidates (recent, best) with roster when available
- Regional rank context
- Optional EU season cutoffs (non-blocking; may be unavailable)
- Static season/dungeon mapping with versioned expansion resolution

## Design principles

1. **Minimal** — one profile request per stale character refresh in the common case
2. **Replaceable** — all logic behind `RaiderIoProvider`; disable via `RAIDERIO_ENABLED=false`
3. **No scraping** — documented REST endpoints only
4. **No bulk crawl** — `/api/v1/mythic-plus/runs` is not used
5. **Attribution** — every normalized DTO includes `RaiderIoAttribution`
6. **Partial success** — season-cutoffs failures must not block character refresh

## Factory

```typescript
import { createRaiderIoProvider } from "@mplus/provider-raiderio";

const provider = createRaiderIoProvider("fixture"); // or "live"
if (provider.enabled) {
  const profile = await provider.getCharacterProfile(identity, ctx);
}
```

## Fixture mode

Default for tests. Fixtures live in `tools/fixtures/raiderio/`.

## Related docs

- [OpenAPI observations](./openapi-observations.md)
- [Minimal call matrix](./minimal-call-matrix.md)
- [Cache and rate policy](./cache-and-rate-policy.md)
- [Terms and commercial risk](./terms-and-commercial-risk.md)
- [Replaceability](./replaceability.md)
- [Wave 3 research notes](../../research/providers/raiderio-live-api.md)
