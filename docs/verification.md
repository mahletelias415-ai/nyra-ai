# Verification scope

This source snapshot includes Scout missions, reviewed natural-language drafts, observation history, Telegram authoring/editing and Scout briefs. The matching hosted application was checked on 26 November 2026.

## Repeatable local checks

Run `npm test`, `npm run typecheck` and `npm run build`. The 45 tests use temporary local databases, synthetic account identifiers, controlled provider responses and no live production keys.

Coverage includes account isolation; origin/webhook gates; strict source and model-tool validation; stale/partial evidence; shared capacity; atomic/idempotent confirmation; mission edit conflicts; pause/remove during scans; Telegram context, replay and reconnect boundaries; research billing/refunds; new/change/missing classification; UTC recap schedules; competing scheduler ticks; retry and opt-out.

## Hosted checks performed separately

Temporary unfunded wallet accounts exercised real source scans, direct-model draft parsing, reload persistence and repeated confirmation without creating a second mission. Five model cases covered English/Russian amounts and time windows, unsupported filters, vague conditions and follow-up edits.

A real Scout scan produced 12 saved results; the recap classified five first recorded matches and seven results needing evidence. It restored after reload, used no AI request and left daily delivery disabled. The delivery-hour preference restored after reload. At a 390px viewport the recap had no horizontal overflow.

The hosted health endpoint returned 200. Unauthenticated private workspace/brief access was rejected, and the Telegram webhook rejected requests without its independent secret.

## What those checks do not establish

Controlled Telegram responses validate routing, retries and account boundaries; they are not evidence that a particular person's message was delivered. A real first-time chat should still be checked after linking. Local tests and unfunded accounts do not establish a live financial burn transaction or an external contract audit. No token purchase, transfer or trade is required by these checks.

There are no QA account keys, chat IDs, private prompts, session cookies, production exports or raw verification traces in this repository.
