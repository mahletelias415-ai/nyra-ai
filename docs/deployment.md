# Deploying Nyra

## Infrastructure

Use a Node.js 24 Vercel project and a separate Turso/libSQL database. `vercel.json` serves `public/` and routes the API/MCP to `api/handler.ts`. `npm run build` validates the application shell; Vercel builds the TypeScript function.

1. Install with `npm ci`.
2. Configure the server environment from `.env.example`.
3. Apply migrations to your own database with `node --env-file=.env.local scripts/migrate.mjs`.
4. Run the test, typecheck and build commands in the README.
5. Deploy the project and check `/api/health` and `/mcp`.
6. Check a fresh wallet sign-in, saved reading, logout and new sign-in.

No production database contents, local environment files or QA accounts are included in the source. Never run development migrations against another operator's database.

## Environment

| Variable | Purpose |
| --- | --- |
| `TURSO_DATABASE_URL` | Your own database URL |
| `TURSO_AUTH_TOKEN` | Server-only database credential |
| `NYRA_AI_MODEL` | Gateway model ID; default `openai/gpt-4.1-mini` |
| `AI_GATEWAY_API_KEY` | Optional server-only Gateway credential, principally for local development |
| `APP_ORIGIN` | Exact custom-domain origin, including HTTPS and excluding a trailing slash |
| `CRON_SECRET` | Independent unpredictable secret for your scheduler |
| `NYRA_BACKGROUND_ENABLED` | Set `true` only after configuring a scheduler |
| `NYRA_TELEGRAM_BOT_TOKEN` | Optional server-only Telegram bot token |
| `NYRA_TELEGRAM_BOT_USERNAME` | Optional bot username |
| `NYRA_TELEGRAM_WEBHOOK_SECRET` | Optional independent Telegram webhook secret |

On Vercel, enable project OIDC; `@vercel/oidc` obtains the request-scoped token for AI Gateway. Do not copy it into the browser or commit a token. The allowed host list uses `APP_ORIGIN` plus Vercel deployment/production host variables. Keep API requests on the same origin as the UI.

## Background watches

The updater is `POST /api/internal/tick`. Status is `GET /api/internal/status`. Both require `Authorization: Bearer <CRON_SECRET>`. A scheduler must call the updater every hour. A deployed function alone is not a scheduler.

The current public installation uses a separate owner-private controller that forwards hourly ticks to the exact public origin with its own secret. That controller, its deployment and credentials are outside this repository. To self-host, supply your own trusted scheduler. Keep credentials in the scheduler's secret store, disable redirects and target only your configured HTTPS origin. Do not put secrets in a URL or issue body.

Per-watch and global leases are stored in the database. Changes use revisions to avoid overwriting another tab's update. A baseline and the last completed result survive process restarts. After setup, verify a due watch performs a read and advances its saved check count; a successful empty tick is only a heartbeat check.

## Sessions and AI calls

Wallet sign-in uses a five-minute, single-use challenge, exact origin, chain ID 4663 and an HttpOnly browser binding. Seven-day session tokens are stored only as hashes. HTTPS cookies are Secure, HttpOnly, SameSite=Lax and use the `__Host-` prefix. Signing out revokes the current session; it does not delete saved history or pause intentional watches.

The model runs only on the server. Source tools are allowlisted. Research reservations and daily allowances are checked atomically. Failed/interrupted runs retain completed reads and require an explicit retry. Production API responses are not cached.

## Telegram

The public release currently has no bot. If you configure one, all three Telegram variables are required. Linking starts from the authenticated workspace and uses an expiring one-use token in a private bot chat. Never publish the bot token or webhook secret.
