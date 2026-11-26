<img src="public/assets/nyra-avatar.png" alt="Nyra" width="112" />

# Nyra AI

An AI research desk for Robinhood Chain. Ask about a wallet, compare Stock Tokens or follow a Pons launch. Inspect the sources and tool calls, save the context, and return to the same workspace.

[Open Nyra](https://nyra-ai-kappa.vercel.app/) · [X](https://x.com/Nyraaihq) · [MCP guide](docs/mcp.md) · [Deployment](docs/deployment.md)

## What works

- Wallet-message sign-in and a persistent private workspace.
- Server-side AI that selects from seven live Robinhood Chain tools.
- Source links, quote timestamps, saved tool traces and explicit retries.
- Standing watches with a baseline, hourly checks and alerts on crossings or changes.
- Daily briefs assembled from the account's saved readings.
- A public MCP endpoint exposing the same seven source tools.

Tools cover network status, wallet balances, Stock Token quotes, Pons launches, transactions and contract code/owner reads. Supported stocks: NVDA, AAPL, TSLA, MSFT, GOOGL, AMZN, SPY and QQQ.

Nyra reads public data; it does not execute trades, request token approvals or hold funds. Contract reads are not audits. Source failures and stale quotes are reported rather than replaced with invented values. This is an independent project, not an official Robinhood service.

## Run locally

Requires Node.js 24 and npm. Use a separate development database.

```sh
npm ci
cp .env.example .env.local
```

Set `TURSO_DATABASE_URL` and `TURSO_AUTH_TOKEN` for your own Turso database. For local AI, set your own server-only `AI_GATEWAY_API_KEY`; the UI and live source tools do not need an AI credential. See [.env.example](.env.example) for optional settings.

```sh
node --env-file=.env.local scripts/migrate.mjs
node --env-file=.env.local --import tsx scripts/dev-server.mjs
```

Open `http://127.0.0.1:4193`. The local server binds to loopback. Sign in with a wallet message; no transaction is needed. Leave `NYRA_BACKGROUND_ENABLED=false` until a scheduler and independent `CRON_SECRET` are configured.

## Checks

```sh
npm test
npm run typecheck
npm run build
```

The 20 deterministic tests cover watch plans, crossing logic and the agent tool loop. They use no production database, private wallet or paid AI credential. CI runs the same checks on pushes and pull requests.

Separately, the hosted release was checked with temporary unfunded wallets: sign-in and nonce replay rejection, real two-source AI reads, saved history after a new sign-in, account isolation, watch persistence and MCP discovery. A due watch read a real quote; the private scheduler relay also reached the public updater and saved its heartbeat. These live checks are not run by CI.

## Structure

| Path | Responsibility |
| --- | --- |
| `public/` | Browser interface, animated point portrait and local plan builder |
| `api/handler.ts` | HTTP entry point and same-origin routing |
| `lib/auth.ts` | Wallet challenges and cookie sessions |
| `lib/agent-core.mjs` | Bounded model/tool loop |
| `lib/agent-service.ts` | Research reservations and saved traces |
| `lib/tools.mjs` | Live source tools and MCP |
| `lib/watch-core.mjs` | Canonical plans and change detection |
| `lib/workspace-service.ts` | Account data, watches, briefs and background runner |
| `drizzle/` | Schema migrations; no user data |

## Current limits and optional integrations

Watches are checked hourly, not continuously. AI research is limited to 30 requests per wallet and 200 across the application per UTC day, with one active request per account. A run permits up to six tool calls and five model turns.

The production scheduler is configured outside this repository. A fresh deployment does not start background checks automatically. [Deployment instructions](docs/deployment.md) describe the authenticated updater and scheduling requirements.

Telegram linking/delivery code is included, but the public release has no configured bot. MCP exposes public source reads; it does not expose private account history or accept a wallet session through the MCP config.

No API keys, runtime secrets, user records, QA wallet keys or production database exports belong in this repository.
