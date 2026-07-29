Implement relevant Battle.net owned-character discovery, automatic Trust Score refresh, and a redesigned Account character list.

Repository
- julienreichenb/mplus-trust-factor
- Frontend: Vue
- Backend: Fastify, Prisma, BullMQ
- Existing character route:
  /character/:region/:realm/:name
- Existing ownership sync:
  Battle.net OAuth → refreshOwnershipForUser → syncVerifiedOwnership
- Existing full analysis queue:
  refresh-character
- Active score model target: default v6

Product goals

1. The Account page must display only relevant owned characters.
2. Relevance must be evaluated automatically after Battle.net ownership sync.
3. Relevant characters must automatically receive an M+ Trust Score refresh.
4. Score generation must happen asynchronously and must not block OAuth login.
5. Account character rows must show portraits, class styling, refresh status and Trust Score badges.
6. Every relevant character row must link to its CharacterPage.vue.

Current issues

- Ownership sync stores almost every character from the Battle.net account.
- Accounts may contain dozens of level-one, abandoned or irrelevant characters.
- GET /api/v1/me/characters currently returns CURRENT and HISTORICAL ownership rows without relevance filtering.
- AccountPage.vue currently displays only:
  - name
  - realm
  - region
  - ownership status
  - primary status
- Characters are not links to CharacterPage.vue.
- There is no score-generation status or Trust Score badge.
- Ownership sync already persists character level and Blizzard playable class ID, but these values are not exposed by the current account DTO.
- OAuth completion currently awaits ownership sync as a best-effort operation. Do not add full score refreshes to that awaited path.

Architecture requirement

Implement a two-stage asynchronous workflow:

  Battle.net OAuth or manual ownership refresh
  → ownership sync
  → enqueue account-character discovery job
  → evaluate cheap relevance data
  → ensure local Character records exist
  → enqueue refresh-character jobs for relevant characters
  → Account page polls score states until complete

The OAuth callback must return promptly after ownership sync and discovery enqueueing. It must not wait for character rating lookups, WCL requests or Trust Score computation.

Part A — Versioned relevance policy in code

Create one centralized, versioned product policy, for example:

  OWNED_CHARACTER_RELEVANCE_POLICY_V1

This policy must live in code, not in environment variables.

Initial V1 rules:

1. Ownership status must be CURRENT.
2. Character must be at the current expansion maximum level.
3. Character must satisfy at least one of:
   - current-season Mythic+ rating meets the minimum relevance threshold
   - it already has a valid public Trust Score for the active season
   - it currently has an active or queued Trust Score refresh
   - it is an explicitly selected primary character

The Mythic+ rating threshold must be one named, versioned code constant.

Do not introduce environment variables such as:

  OWNED_CHARACTER_MIN_LEVEL
  OWNED_CHARACTER_MIN_RATING
  OWNED_CHARACTER_LIMIT

If no existing product policy defines a minimum current-season rating, use 1000 for V1, keep it clearly centralized and report this choice in the implementation summary.

The maximum character level must also come from centralized, versioned game metadata or an existing active-expansion configuration. Do not duplicate a numeric level throughout the code and do not put it in `.env`.

Do not permanently delete irrelevant ownership records.

Persist all verified ownership records privately so that:

- future level or activity changes can make a character relevant
- ownership history remains auditable
- users do not need to relink Battle.net
- manual ownership refresh can reevaluate relevance

The Account API should filter them from the default response rather than deleting them.

Part B — Account-character discovery job

Add a dedicated background job, for example:

  discover-owned-characters

or:

  refresh-account-characters

Trigger it after:

1. successful Battle.net OAuth ownership sync
2. POST /api/v1/me/characters/refresh-ownership
3. an explicit future account discovery retry

The job must:

1. Load CURRENT verified ownerships for the Battle.net account.
2. Use the level already supplied by the Battle.net account profile as the first cheap filter.
3. Avoid Mythic+ rating requests for non-max-level characters.
4. For max-level characters, retrieve the current-season Mythic+ rating using the cheapest existing provider path.
5. Do not use Warcraft Logs during relevance discovery.
6. Respect provider rate limits and existing request/cache abstractions.
7. Use bounded concurrency.
8. Persist discovery state and provenance.
9. Evaluate the centralized relevance policy.
10. Ensure each relevant ownership is linked to a local Character record.
11. Enqueue the existing full refresh-character pipeline for relevant characters.

Do not implement a second scoring pipeline.

Reuse the existing refresh-character queue and refresh logic.

Discovery must be idempotent and deduplicated by at least:

  Battle.net account
  current season
  ownership sync revision or timestamp

Repeated logins must not enqueue duplicate jobs for the same characters.

Part C — Local Character creation and ownership linking

Currently, ownership.characterId can remain null when no local Character already exists.

For every relevant character:

1. Resolve the Region and Realm using existing canonical realm logic.
2. Create or reuse the canonical Character row using:
   - region
   - realm
   - normalized name
   - Blizzard character ID
3. Update VerifiedCharacterOwnership.characterId.
4. Preserve identity safeguards and avoid duplicate Character records.
5. Reuse existing character lookup/create services if available.
6. Do not create full Character records for every level-one alt unless needed.

The CharacterPage route must work immediately once the local Character row exists:

  {
    name: "character",
    params: {
      region,
      realm,
      name
    }
  }

Part D — Automatic Trust Score refresh

For each relevant character:

- If no valid current-season score exists, enqueue refresh-character.
- If the score is stale, enqueue refresh-character.
- If a refresh is already QUEUED or ACTIVE, do not enqueue another.
- If a recent valid v6 score exists, do not recompute it unnecessarily.
- If a previous refresh failed, allow a controlled retry.
- Respect cooldowns, rate limits and WCL cost controls.
- Use the existing job dedupe mechanism.
- Prioritize:
  1. primary character
  2. highest current-season Mythic+ rating
  3. remaining relevant characters

Do not run every relevant WCL analysis in parallel without limits.

Use a controlled queue concurrency so linking an account with many characters cannot exhaust WCL quotas.

A failed character refresh must not fail the account discovery job as a whole.

Return and persist counters:

  ownershipCount
  maxLevelCount
  ratingCheckedCount
  relevantCount
  irrelevantCount
  existingFreshScoreCount
  refreshQueuedCount
  alreadyQueuedCount
  failedCount
  providerRequestCount

Part E — Persistence and DTO

Extend the model only where needed.

Persist or expose enough information to provide:

  relevance:
    policyVersion
    eligible
    reasons
    evaluatedAt

  currentSeasonMythic:
    rating
    seasonId
    fetchedAt
    source
    state

  trustScore:
    status
    jobId
    score
    grade
    confidence
    modelVersion
    calculatedAt
    errorCode
    errorMessage

Suggested Trust Score statuses:

  NOT_REQUESTED
  DISCOVERING
  QUEUED
  RUNNING
  AVAILABLE
  PARTIAL
  STALE
  FAILED
  UNAVAILABLE

Do not duplicate score values if they can be reliably read from the current public score snapshot.

Do not derive status only on the frontend. Build a server-side account-character view service that combines:

- verified ownership
- Character
- latest refresh job
- current published score
- class metadata
- character media
- relevance state

Change GET /api/v1/me/characters so its default response contains only relevant CURRENT characters.

Suggested response:

  {
    characters: [
      {
        ownershipId,
        characterId,
        region,
        realmSlug,
        realmName,
        name,
        level,
        isPrimary,

        characterClass: {
          id,
          slug,
          name,
          color
        },

        media: {
          portraitUrl
        },

        currentSeasonMythic: {
          rating,
          state,
          fetchedAt
        },

        trustScore: {
          status,
          jobId,
          score,
          grade,
          confidence,
          modelVersion,
          calculatedAt,
          errorCode,
          errorMessage
        },

        relevance: {
          policyVersion,
          eligible,
          reasons,
          evaluatedAt
        }
      }
    ],

    discovery: {
      status,
      jobId,
      startedAt,
      finishedAt,
      error
    },

    hiddenCharacterCount,
    totalOwnedCharacterCount
  }

The private endpoint may support an explicit internal/debug option to inspect all ownerships, but the normal Account page must only receive relevant characters.

Historical ownerships must not appear in the normal list.

Part F — Portrait and class metadata

Expose:

- character portrait URL
- playable class
- canonical class slug
- canonical class display name
- canonical WoW class color

Reuse existing Blizzard media, CharacterSnapshot or class metadata when available.

Do not hardcode class-color CSS separately in AccountPage.vue.

Create or reuse a centralized class-color map or class presentation helper.

Until the character media refresh finishes:

- display a class icon or neutral portrait placeholder
- update the portrait automatically when data becomes available
- do not hide the row

Part G — Redesign AccountPage.vue

Replace the current plain ownership list with polished character rows.

Each row must contain:

Left:
- character portrait
- character name using its class color
- realm and region
- level
- current-season Mythic+ rating when available

Center:
- lifecycle status:
  - Discovering
  - Queued
  - Analysing
  - Available
  - Partial data
  - Failed
  - Stale
- concise failure explanation when applicable

Right:
- existing Trust Score badge component when a score is available
- otherwise a status badge or spinner
- Primary marker
- Set primary action when applicable

The complete row must be a RouterLink to CharacterPage.vue.

Use the existing named route:

  name: "character"

with:

  params: {
    region: character.region.toLowerCase(),
    realm: character.realmSlug,
    name: character.name
  }

Interactive controls such as “Set primary” must use event propagation protection so clicking the button does not navigate:

  @click.prevent.stop

Do not nest an invalid interactive button inside an anchor. Structure the row accessibly using an overlay link or separate actions area.

Sorting:

1. primary character
2. available Trust Score descending
3. current-season Mythic+ rating descending
4. character name

While Trust Scores are still loading, use current-season Mythic+ rating as the secondary ordering signal.

The page must display:

- “Analysing your characters…” while discovery is active
- number of relevant characters
- number of hidden irrelevant characters
- a useful empty state when no character meets the policy

Do not render dozens of irrelevant characters and do not add a large “show all” list to the main screen.

Part H — Live status updates

AccountPage.vue must update statuses without a full page reload.

Implement one of:

- polling the account-character endpoint every 3–5 seconds while at least one discovery/refresh status is non-terminal
- reusing an existing job polling abstraction

Stop polling when:

- discovery is terminal
- no character has QUEUED or RUNNING status
- the component unmounts

Prevent overlapping polling requests.

Refresh only the account view data, not the entire authentication state on each poll.

When a character becomes AVAILABLE:

- replace the loading status with the Trust Score badge
- update portrait and score details
- keep row order stable enough to avoid excessive UI jumping

Part I — Primary-character behavior

Preserve the existing primary-character action.

A manually selected primary character is considered relevant by explicit user choice.

If an old primary character is no longer CURRENT:

- do not expose it as a normal relevant row
- do not silently transfer primary status without an explicit documented rule
- expose a diagnostic or neutral Account-page message if no current primary exists

Setting a new primary must not trigger duplicate score refreshes.

Part J — Failure behavior

The workflow must handle independently:

- Battle.net profile failure
- character rating unavailable
- unsupported or missing realm
- local Character creation failure
- refresh queue failure
- WCL rate limiting
- full score refresh failure
- missing public logs

A single broken character must not block all other relevant characters.

When Mythic+ rating cannot be fetched temporarily:

- retain the last successful relevance result when reasonably fresh
- expose stale provenance
- retry through the queue
- do not suddenly remove every character from the Account page

Characters with no usable WCL logs can remain relevant based on their current-season Mythic+ activity.

Their Trust Score status should become UNAVAILABLE or PARTIAL according to existing scoring semantics, not “irrelevant”.

Relevance and score availability are separate concepts.

Part K — Security and privacy

- The owned-character list remains private and authenticated.
- Never expose Battle.net provider tokens.
- Never expose another user’s ownership records.
- Preserve account unlink semantics.
- Unlinking must stop future discovery and score auto-refreshes.
- Existing public Character pages remain public.
- Log/audit account discovery enqueue and completion without storing sensitive tokens.

Part L — Tests

Add or update tests for:

Ownership and relevance
1. Ownership sync still persists all verified CURRENT characters.
2. Historical characters are excluded from the Account response.
3. Non-max-level characters do not trigger Mythic+ rating requests.
4. Max-level characters trigger rating discovery.
5. Rating below the V1 threshold is irrelevant.
6. Rating at or above the threshold is relevant.
7. An explicitly selected primary remains relevant.
8. A character with an existing current public score remains relevant.
9. Relevance thresholds cannot be overridden through environment variables.
10. Relevance policy version is returned in diagnostics.

Async orchestration
11. OAuth completion enqueues account discovery without awaiting full character analysis.
12. Manual ownership refresh enqueues discovery.
13. Repeated login is deduplicated.
14. Relevant characters enqueue refresh-character exactly once.
15. Fresh score prevents unnecessary refresh.
16. Queued or active refresh prevents duplicate enqueue.
17. One failed character does not abort the batch.
18. Queue concurrency and provider rate-limit guards are respected.
19. Discovery makes zero WCL calls.

Character identity
20. Relevant owned character creates or reuses the canonical Character.
21. Verified ownership is linked to Character.id.
22. Existing characters are not duplicated.
23. Character route params resolve correctly.

Account API
24. Default response returns only relevant CURRENT characters.
25. DTO includes level, class, media, rating, score and job state.
26. Hidden and total ownership counts are correct.
27. Score status is derived consistently from jobs and snapshots.
28. No private provider token is serialized.

Frontend
29. Character row links to CharacterPage.vue.
30. Character name uses centralized class color.
31. Portrait displays with fallback.
32. QUEUED and RUNNING states display correctly.
33. AVAILABLE displays the existing Trust Score badge.
34. FAILED displays a concise error state.
35. Set-primary action does not navigate.
36. Polling starts only for active states.
37. Polling stops on unmount and terminal state.
38. Only relevant characters are rendered.
39. Responsive and keyboard-accessible behavior.

Validation

Run:

- lint
- typecheck
- build
- API unit and integration tests
- IAM and ownership tests
- queue orchestration tests
- provider cache/rate-limit tests
- frontend component tests
- production web build

Perform a live staging validation with an account containing many characters.

Report:

- total owned characters
- max-level characters
- rating-checked characters
- relevant characters
- hidden characters
- score jobs queued
- score jobs deduplicated
- provider request counts
- time until OAuth redirect
- time until first score becomes available
- time until all relevant characters reach terminal state

Deliverables

Provide:

1. Root architecture and workflow.
2. Exact files changed.
3. Database migration details.
4. Relevance policy V1 and its centralized constants.
5. API before/after payload.
6. Screenshots or component-state descriptions for:
   - discovering
   - queued
   - available
   - partial
   - failed
7. Test commands and results.
8. Live staging validation results.
9. Remaining provider-cost or rate-limit limitations.

Do not:

- block OAuth while Trust Scores are calculated
- analyze every owned character
- make WCL calls during relevance discovery
- place relevance thresholds in `.env`
- delete irrelevant ownership records
- duplicate the refresh-character pipeline
- fabricate a Trust Score for missing data