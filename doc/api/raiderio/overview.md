# Raider.IO integration overview

Agent 3 owns a **minimal, replaceable** Raider.IO provider at `@mplus/provider-raiderio`.

## Purpose

Supplement Blizzard and Warcraft Logs with:

- Mythic+ score summaries (current and previous season)
- Run candidates (recent, best, highest level) with roster when available
- Regional rank context
- Raid progression summary
- EU season cutoffs (top 25% threshold)
- Static season/dungeon mapping

## Design principles

1. **Minimal** — one profile request per stale character refresh in the common case
2. **Replaceable** — all logic behind `RaiderIoProvider`; disable via `RAIDERIO_ENABLED=false`
3. **No scraping** — documented REST endpoints only
4. **No bulk crawl** — `/api/v1/mythic-plus/runs` is not used
5. **Attribution** — every normalized DTO includes `RaiderIoAttribution`

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
