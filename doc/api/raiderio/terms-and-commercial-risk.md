# Raider.IO terms and commercial risk

## Published API terms (OpenAPI v0.62.5)

### Rate limiting

> Unauthenticated requests are limited to 200 requests per minute. Exceeding this limit will result in HTTP 429 responses.

Register applications at [raider.io/settings/apps](https://raider.io/settings/apps) for higher limits.

### Attribution

> Public-facing applications that use data from this API must include a link back to [raider.io](https://raider.io).

Normalized DTOs include:

```typescript
{
  displayText: "Data from Raider.IO",
  homepageUrl: "https://raider.io",
  profileUrl: "<character profile when applicable>"
}
```

Frontend (Agent 6) must display attribution wherever Raider.IO-derived values are shown.

### Acceptable use

> This API is provided for community and personal use. You may not use it to build competing services, resell data, or engage in any activity that harms the Raider.IO platform or its users. Automated scraping beyond the published endpoints is prohibited. Raider.IO reserves the right to revoke API access at any time.

## Product risk assessment

M+ Trust Factor is a **commercially oriented** product. Raider.IO data is treated as:

1. **Accelerator only** — not sole source of identity, equipment, or scores
2. **Replaceable** — system functions with reduced richness when disabled
3. **Pre-launch review required** — contact Raider.IO before monetization or broad public launch

## Mitigations implemented

- Strict minimal field sets and call budgets
- No HTML scraping, no bulk `/runs` ingestion
- Provider behind interface with disable switch
- Field dependency documentation for legal review
- Fixture mode for CI without live API dependency

## References

- [API documentation](https://raider.io/api)
- [M+ cutoffs page](https://raider.io/mythic-plus/cutoffs)
- [API capacity FAQ](https://support.raider.io/kb/frequently-asked-questions/how-does-the-mythic-plus-leaderboard-slash-api-capacity-work)
