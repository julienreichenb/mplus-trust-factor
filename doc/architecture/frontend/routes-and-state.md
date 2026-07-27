# Frontend routes and state

## Routes

| Path | Name | Page |
|------|------|------|
| `/` | `home` | Character search |
| `/character/:region/:realm/:name` | `character` | Profile |
| `/compare` | `compare` | Multi-character comparison |
| `/admin/models` | `admin-models` | Score model admin |

Canonical search navigation uses uppercased region, slugified realm, trimmed name.

## API mode

- `VITE_API_MODE=mock` (default): typed in-app fixtures; no backend required.
- `VITE_API_MODE=live`: HTTP client against `VITE_API_BASE_URL`.

Badge in the header shows the active mode.

## Pinia stores

| Store | Persistence | Purpose |
|-------|-------------|---------|
| `recentSearches` | `localStorage` | Last 8 lookups, no account |

Avoid global score caches. Profile/compare/admin state lives in page composables.

## Query lifecycle

- `useAbortableQuery` aborts fetch on route leave.
- `useRefreshPolling` polls refresh status with exponential backoff (1s→8s), stops on FRESH/FAILED/STALE or 2 minutes.
- Stale/queued profiles keep the last snapshot visible under a status banner.
- Realm autocomplete is debounced (250ms).

## Ownership

`apps/web/**` — Agent 6. Domain routes — Agent 5.
