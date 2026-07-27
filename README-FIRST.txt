M+ TRUST FACTOR — CURSOR MULTI-AGENT STARTER PACK
=================================================

Purpose
-------
This pack contains the shared project context, architecture contracts, external API strategy,
database proposal, execution order, and one detailed English prompt per Cursor agent.

The prompts assume:
- A brand-new repository.
- Cursor agents running in isolated branches/worktrees.
- Agent 0 runs first and establishes the repository contracts.
- Agents 1–9 run in parallel only after Agent 0 is merged.
- Agent 10 runs last to integrate, validate, and prepare the MVP release.

Recommended use
---------------
1. Create an empty Git repository.
2. Copy this entire folder into the repository temporarily, or at least copy the shared files
   into the future `doc/bootstrap/` folder.
3. Launch `agents/00-agent-zero-foundation.txt` in Cursor Plan mode.
4. Review Agent 0's plan, let it implement, then merge its branch.
5. Create isolated branches/worktrees for Agents 1–9 and launch their prompts in Cursor Plan mode.
6. Merge the parallel work.
7. Launch `agents/10-final-integration-release.txt`.

Mandatory reading for every agent
---------------------------------
- COMMON-CONTEXT.txt
- ARCHITECTURE-AND-DB.txt
- PROCESS-FLOWS.txt
- API-SOURCES-AND-REQUEST-BUDGETS.txt
- ENVIRONMENT-AND-SECRETS.txt
- WAVE-EXECUTION-PLAN.txt
- AGENT-OUTPUT-TEMPLATE.txt

Important project rules
-----------------------
- No HTML scraping of Blizzard, Warcraft Logs, Raider.IO, Armory, or other sites.
- No undocumented Raider.IO bulk harvesting.
- Do not commit secrets or real player payloads containing data that is not already public.
- Every external datum must retain source provenance and fetch time.
- Scoring must be deterministic, versioned, explainable, and reproducible.
- "Boost" is always a suspicion score or probabilistic red flag, never a factual accusation.
- The MVP is Retail EU, but region must be a first-class key everywhere.
- The WoW addon must not make HTTP requests; it consumes generated static data.
- All agents must document their work under `doc/`.
- Agents must begin in Plan mode and write their plan before modifying code.

Working name
------------
Use "M+ Trust Factor" as a temporary internal name. Do not spend time on branding.
