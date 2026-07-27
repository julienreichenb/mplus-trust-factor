# Addon data format v1

`formatVersion = 1`

## Metadata (`Data/meta.lua`)

| Field | Type | Description |
|-------|------|-------------|
| `formatVersion` | number | Schema version |
| `generatedAt` | ISO-8601 string | Export timestamp (UTC) |
| `region` | string | e.g. `EU` |
| `season` | string | Season slug |
| `scoreModelKey` | string | Active model key |
| `scoreModelVersion` | number | Active model version |
| `characterCount` | number | Eligible rows exported |
| `checksum` | string | SHA-256 over sorted shard contents |
| `shardScheme` | string | `realm_first_char_v1` |

## Shard registry

Each shard file registers into the global:

```lua
MPT_SHARDS["EU/argent-dawn/a"] = {
  ["EU:argent-dawn:aelindra"] = { 92, 5, 3, 0, 0, "vec0" },
}
```

### Shard path

`{REGION}/{realmSlug}/{bucket}`

- `bucket` = first character of normalized name (`[a-z0-9]` or `_`)

### Record tuple

| Index | Field | Type | Notes |
|-------|-------|------|-------|
| 1 | `score` | int | 0–100 Trust Factor |
| 2 | `gradeCode` | int | S=5, A=4, B=3, C=2, D=1 |
| 3 | `confidenceBucket` | int | 0–3 |
| 4 | `redFlags` | int | Public bitset |
| 5 | `freshnessDays` | int | Days between `calculatedAt` and export |
| 6 | `profileKey` | string? | Optional short website key |

### Confidence buckets

| Bucket | Meaning | Internal range |
|--------|---------|----------------|
| 0 | Low | < 40% |
| 1 | Moderate | 40–59% |
| 2 | Good | 60–79% |
| 3 | High | ≥ 80% |

### Red-flag bitset (public only)

| Bit | Key |
|-----|-----|
| 1 | `boost_suspected` |
| 2 | `atypical_progression` |
| 4 | `logs_hidden` |
| 8 | `insufficient_data` |
| 16 | `probable_reroll` |
| 32 | `confirmed_reroll` |

## Excluded fields

The addon dataset must **not** include:

- Dimension scores or contributors
- Authenticity evidence payloads
- Admin flags or premium entitlements
- Raw provider payloads

## Test vectors

`Data/test_vectors.lua` mirrors TypeScript vectors in `tools/addon-exporter/src/constants.ts` for cross-language verification.

## Checksum

SHA-256 over sorted shard paths and sorted lookup keys with JSON-serialized compact records. Implemented in `tools/addon-exporter/src/checksum.ts`.
