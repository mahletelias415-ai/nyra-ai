# Scout searches and recaps

## Sources and discovery

`lib/scout-sources.ts` reads bounded feeds: two newest-launch pages from Pons, Corbel's pool index and two HEY change pages, with up to 16 linked RH project snapshots. Candidates rotate between scans. A mission checks at most 12 candidates per scan. Provider deadlines may defer work; unavailable evidence stays unknown.

`lib/scout-core.mjs` evaluates requested filters against identified, dated observations. Public repository status is independently checked against GitHub's repository API. HEY supplies project-to-contract and meaningful-update evidence. Corbel supplies Token Check observations and simulated buy/sell results. Other Token Check warnings stay visible even if the user did not require those filters.

Supported filters include public code, HEY contract association, meaningful-update age, minimum USD liquidity, indexed creator launches, simulated round-trip loss, indexed ticker collisions and optional Pons stage/progress/launch age. Unsupported conditions include volume/market-cap/holder thresholds, guaranteed safety or returns, LP-lock requirements, social sentiment and faster check intervals. A repository, match or successful simulation is not a safety verdict.

## Drafts and confirmation

`lib/scout-planner.mjs` defines a strict private planning tool. It copies requested filters, keeps omitted filters open, and preserves ambiguities and unsupported requirements. This tool is available to authenticated application research; the public MCP remains limited to seven source reads.

`lib/scout-drafts.ts` saves one-hour account-scoped drafts. Creating or refining a draft does not start a search or allocate a watch slot. Only explicit confirmation creates a mission or applies an edit. Confirmation is transactional and idempotent. Edits require the original mission revision, preserve pause state, cancel pending alerts based on old conditions and mark previous results as awaiting recheck.

The website allows explicit acknowledgement of omitted unsupported conditions. Telegram confirmation stays blocked until its questions/unsupported requirements are resolved.

## Telegram

Link a private chat through the wallet-authenticated workspace. The one-use connection link expires after 15 minutes. The bot never needs a wallet key or seed phrase.

Send a project-search request in ordinary text. Review the returned conditions, refine them by message, and use the provided confirmation control. `/missions` lists searches for explicit selection; `/new` starts a separate draft. With multiple missions, an ambiguous edit asks which one to change.

The implementation uses ordinary messages and reply keyboards, not callback queries. A per-chat lease serializes planning. A user-scoped research request key prevents duplicate model charges after webhook replay. Queued private replies are bound to the account/chat that requested them; disconnection invalidates that delivery boundary.

## Observation history

`lib/scout-history-core.mjs` extracts compact source snapshots. `lib/scout-history.ts` returns up to 20 saved observations for an owned result. Freshness and contract identity must pass before a metric is comparable. Equal source timestamps do not create a numeric change. Missing data does not become zero. Legacy snapshots without known filters do not imply that a filter changed.

History preserves observed checks; it does not reconstruct a token's entire past. Source-value changes and search-condition changes are separate. History itself does not send additional Telegram alerts.

## Scout brief

`lib/scout-brief.ts` and `lib/scout-brief-core.mjs` build a deterministic rolling 24-hour recap from saved results. The recap separates first recorded matches for a mission, comparable changes and missing evidence. It covers at most the 100 most recently checked results and discloses truncated coverage. Changes compare the period's baseline with its latest saved check, so intermediate changes can have reverted.

`/scoutbrief` builds a recap immediately. Manual builds within one minute reuse the same snapshot. The website at `/#scout-brief` restores the latest saved recap, source links and schedule settings.

Daily Telegram delivery is off by default. Choose a UTC hour on the website or use `/daily on 4`; `/daily off` disables it. The existing hourly runner queues at most one recap per account/date/hour slot on the first available cycle after that time. Missed days coalesce into one current recap. A changed schedule revision or opt-out cancels pending recaps. Delivery retries through the existing outbox and rechecks opt-in before sending.

## Costs and storage

Mission scans and Scout briefs do not use an AI-request credit. Each successful model-backed preparation/refinement uses the same research allowance as the website. Watches and missions share capacity. Account tables store drafts, confirmed conditions, results, observation history and recap snapshots.

Apply all numbered SQL migrations through `0010_scout_briefs.sql` before running this release. Use your own database and secrets; schema files contain no user records.
