# Threat model (MVP)

## Assets

- Provider OAuth credentials (Blizzard, WCL, Raider.IO)
- Admin API key
- PostgreSQL (characters, scores, raw payloads)
- Redis (queues, cache)
- Raw artifact storage
- Public website and addon static dataset

## Threats and controls

| Threat | Impact | Control | Test |
|--------|--------|---------|------|
| Provider secret leakage | Account abuse, cost | Pino redaction, no secrets in browser | `tests/security/redaction-and-ssrf.test.ts` |
| SSRF via user URLs | Internal network scan | Allowlisted provider hosts only | `isAllowedProviderHost` |
| SQL injection | Data breach | Prisma parameterized queries | Convention + review |
| GraphQL injection | Data exfiltration | Static documents + variables | Agent 2 convention |
| Admin API brute force | Config tampering | Constant-time key compare, rate limit (Agent 5) | `constantTimeEqual` test |
| Refresh abuse / cost amplification | Provider bill, 429 | Per-character cooldown, WCL budget stops | Failure injection + budget helper |
| Queue poisoning / oversized payload | Worker crash | Zod job schemas, size limits (documented) | `packages/contracts/src/jobs.test.ts` |
| Decompression bomb / artifact abuse | Disk/CPU exhaustion | Retention, max size (Agent 5) | `ArtifactWriteFailure` injection |
| Path traversal in artifacts | File read/write | Canonical paths under `RAW_ARTIFACTS_DIR` | Documented for Agent 5 |
| Stored XSS via names | User compromise | `escapeHtml` on output | observability security test |
| Unicode confusables | Wrong character matched | NFKC normalization | `domain.test.ts` |
| Malicious provider payload | Bad data persisted | Zod boundary schemas | Contract tests |
| Stale/replayed OAuth token | Unauthorized access | Short TTL, in-memory cache | Env validation |
| Red-flag defamation | Legal/reputational harm | Probabilistic language policy | `red-flag-language.md` |
| Entitlement bypass | Premium data leak | Server-side checks (Agent 5) | Documented |
| Addon dataset tampering | In-game trust | Checksum-ready export metadata | `assertAddonExportSafe` |

## Out of scope (MVP)

- WAF / DDoS at edge (Agent 8 Caddy/production)
- Dependency/container scanning (Agent 8 CI)
- Live credential tests on PRs

## Review cadence

Revisit before public launch and monetization.
