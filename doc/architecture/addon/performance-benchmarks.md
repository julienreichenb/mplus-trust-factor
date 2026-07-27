# Performance benchmarks

Hardware: developer workstation (Windows 10), Node 22, 2026-07-27.

Method: `pnpm --filter @mplus/addon-exporter benchmark` using synthetic EU records and default eligibility rules.

## Results

| Dataset | Input rows | Eligible | Shards | Build time | 1000 lookups | Est. Lua bytes |
|---------|------------|----------|--------|------------|--------------|----------------|
| Synthetic | 10,000 | 7,399 | 40 | 29 ms | 10 ms | ~1.05 MB |
| Synthetic | 100,000 | 73,990 | 40 | 209 ms | 8 ms | ~10.6 MB |

Full JSON: `tools/addon-exporter/dist/benchmark-report.json`

## Observations

- Shard scheme `realm_first_char_v1` keeps shard count bounded (~36 buckets × realms in synthetic set).
- Exporter build time scales roughly linearly with eligible row count.
- Lookup scans shard map key only; with `MPT_SHARDS` registry, lookup is O(1) per shard path + O(1) hash key.
- WoW loads all `.toc`-listed Lua files at login; true lazy IO is not available within a single addon. Deferred **parsing** could be a future optimization by storing shard blobs as strings.

## MVP fixture export

| Metric | Value |
|--------|-------|
| Eligible characters | 6 |
| Shard files | 6 |
| Package ZIP | `tools/addon-exporter/dist/MPlusTrust-0.1.0.zip` |

## Memory guidance

| Scale | Guidance |
|-------|----------|
| < 10k characters | Safe for single-region MVP ZIP shipped with addon |
| 10k–50k | Monitor compressed ZIP size; consider per-region packages |
| 100k+ | Split by region or ship companion data addons (future) |

Re-run benchmarks after changing eligibility, shard scheme, or record encoding.
