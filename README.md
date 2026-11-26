<img src="public/assets/nyra-avatar.png" alt="Nyra" width="112" />

# Nyra AI

A research desk for Robinhood Chain. Give Nyra a project search, review the conditions and keep the results, sources and changes in one private workspace. Manage the same Scout searches from the website or your linked Telegram chat.

[Website](https://nyraagent.online/) · [Telegram](https://t.me/nyraagent_rhbot) · [X](https://x.com/Nyraaihq) · [MCP guide](docs/mcp.md) · [Checks](https://github.com/mahletelias415-ai/nyra-ai/actions/workflows/checks.yml)

## What works

- **Scout searches:** public repositories, meaningful updates, liquidity, launch history, simulated buy/sell loss and optional Pons filters.
- **Reviewed drafts:** describe a search in your own words, refine it, then explicitly confirm. Unsupported conditions remain visible.
- **Telegram management:** create searches by message, choose an existing mission with `/missions`, and review changes before applying them.
- **Saved history:** compare dated checks, source observations and changes. Missing evidence is never replaced with zero or a passed check.
- **Scout brief:** `/scoutbrief` recaps the last 24 hours of saved results. Daily delivery is opt-in, with a configurable UTC hour.
- **Live research tools:** Robinhood Chain network, wallets, Stock Token quotes, Pons launches, transactions and contract reads.
- **Wallet sign-in and persistence:** message-based authentication, account-scoped server storage, source traces and explicit retries.
- **Public MCP:** seven stateless source-read tools. It does not expose private missions or account history.

Nyra does not execute trades or hold funds. Optional NYRA packs require a separate, explicit wallet burn transaction. Search matches and contract reads are not recommendations or security audits. This is an independent project, not an official Robinhood service.

## Try a Scout mission

1. [Sign in with a wallet](https://nyraagent.online/#desk); no transaction is needed for sign-in.
2. Connect your private Telegram chat using the one-use link from the workspace.
3. Send a request such as:

   > Find RH projects with public GitHub code, a meaningful update within 7 days and at least $5k liquidity.

4. Review the draft. Reply “make it $10k, keep the other conditions” to refine it. Nothing starts until you confirm.
5. Use `/missions` to choose a saved search to edit. Confirmed edits preserve its identity, history and pause state.
6. Use `/scoutbrief` for a recap now, `/daily on 4` for daily delivery at 04:00 UTC, or `/daily off` to stop daily delivery.

The website shows the same drafts, confirmed conditions, check history and latest recap. [Scout behavior and limits](docs/scout.md) explains discovery coverage, freshness and review rules.

## Run your own instance

Requires Node.js 24 and npm. Provision your own Turso/libSQL development database.

```sh
npm ci
cp .env.example .env.local
```

Set your own `TURSO_DATABASE_URL` and server-only `TURSO_AUTH_TOKEN`. Choose one AI route:

| Route | Server configuration |
| --- | --- |
| AI Gateway | `NYRA_AI_PROVIDER=gateway`, `NYRA_AI_MODEL=openai/gpt-4.1-mini`, your own `AI_GATEWAY_API_KEY` locally; Vercel OIDC is also supported |
| Direct OpenAI | `NYRA_AI_PROVIDER=openai`, `NYRA_AI_MODEL=openai/gpt-6.2-sol`, your own `OPENAI_API_KEY` |

No provider credentials are included. Direct OpenAI uses Responses with strict function tools; it does not silently switch to Gateway when a request fails. Source-read tools and MCP do not need an AI credential.

```sh
node --env-file=.env.local scripts/migrate.mjs
node --env-file=.env.local --import tsx scripts/dev-server.mjs
```

Open `http://127.0.0.1:4193`. The dev server binds to loopback. Keep `NYRA_BACKGROUND_ENABLED=false` until your own authenticated hourly scheduler is configured. Telegram requires your own bot and webhook secrets. [Deployment guide](docs/deployment.md).

## Validation

```sh
npm test
npm run typecheck
npm run build
```

The current suite has **45 deterministic tests**. It covers wallet/account boundaries, tool gates, research billing, Scout review and confirmation, Telegram editing and replay, source history, brief scheduling, delivery retry and opt-out. Tests use isolated local databases and controlled provider responses. CI runs the same commands without production secrets.

Separately, the hosted application has been checked with temporary unfunded accounts: real source scans, model-backed draft parsing, server persistence after reload, idempotent confirmation and real-data Scout brief generation. Mocked Telegram tests do not establish delivery to a real person's chat. [Verification scope](docs/verification.md).

## Limits and token packs

- Scout runs hourly through a configured server scheduler. Each mission checks up to 12 candidates from bounded Pons, Corbel and HEY feeds; it does not inspect every chain transaction.
- Source outages, partial reports and stale observations remain visible. Supported Stock Tokens: NVDA, AAPL, TSLA, MSFT, GOOGL, AMZN, SPY and QQQ.
- Accounts have five shared watch/mission slots. Preparing or refining a draft uses one AI request; deterministic scans and Scout briefs do not.
- Free research allows up to 30 successful requests per wallet and 200 shared free requests per UTC day. Purchased requests are used after that allowance. Failed/interrupted paid requests return their credit once. A separate 1,000-run daily service ceiling applies.
- NYRA on chain 4663: `0xb087f8bbc80654f2cf84907052551375a7a413c5`. Burning 10,000 NYRA activates 25 AI requests; burning 25,000 NYRA adds five permanent slots, up to 25 additional slots. No token approval or custody wallet is used. The server verifies the prepared intent, receipt, exact burn event, canonical block and RH safe block before crediting a pack.

## Source and privacy

This repository contains application code, schema migrations, generated artwork and synthetic test fixtures. The dated `public/scout-example.json` is an explicitly labelled public-source receipt; it omits private account and Telegram identifiers.

Production databases, user messages, wallet sessions, Telegram chat IDs, private mission records, QA exports, local environment files and internal deployment journals are excluded. Migrations describe tables; they contain no production records. The private scheduler installation and its credentials are not part of this repository.

See [deployment](docs/deployment.md), [Scout](docs/scout.md) and [MCP](docs/mcp.md) for the relevant implementation paths and configuration.
