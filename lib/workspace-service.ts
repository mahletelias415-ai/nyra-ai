import { database as runtimeDatabase } from './database.js';
import { sessionUser, serviceAuthorized } from './auth.js';
import { agentConfiguration, agentHistory, askAgent } from './agent-service.js';
import { runTool } from './tools.mjs';
import { canonicalPlan, fingerprint, CHECK_INTERVAL, nextCheckAt, MAX_WATCHES, compareReading, makeBrief, telegramText } from './watch-core.mjs';
type Row = Record<string, any>;
const config=()=>process.env;
const database=runtimeDatabase;
class HttpError extends Error {
    constructor(public status: number, message: string) { super(message); }
}
const now = () => Date.now();
const json = (value: unknown, status = 200) => Response.json(value, { status, headers: { 'Cache-Control': 'no-store' } });
async function userId(r:Request){const id=await sessionUser(r);if(!id)throw new HttpError(401,'Sign in with your wallet to save your Nyra workspace.');return id;}
function sameOrigin(r: Request) { const origin = r.headers.get('origin'); if (!origin || origin !== new URL(r.url).origin)
    throw new HttpError(403, 'Open this action from Nyra.'); }
async function body(r: Request) { const t = await r.text(); if (t.length > 8000)
    throw new HttpError(413, 'This request is too large.'); try {
    return JSON.parse(t);
}
catch {
    throw new HttpError(400, 'Send a valid JSON request.');
} }
async function profile(user: string) { const db = database(); await db.prepare('INSERT OR IGNORE INTO nyra_profiles (user_id,created_at) VALUES (?,?)').bind(user, now()).run(); return (await db.prepare('SELECT * FROM nyra_profiles WHERE user_id=?').bind(user).first()) as Row; }
const telegramReady = () => !!(config().NYRA_TELEGRAM_BOT_TOKEN && config().NYRA_TELEGRAM_BOT_USERNAME && config().NYRA_TELEGRAM_WEBHOOK_SECRET);
function watchView(w: Row) { return { id: w.id, plan: JSON.parse(w.plan), paused: !!w.paused, checks: w.checks, revision: w.revision, lastAt: new Date(w.last_at).toISOString(), nextAt: new Date(w.next_at).toISOString(), error: w.error }; }
function readView(r: Row) { return { id: r.id, watchId: r.watch_id, plan: JSON.parse(r.plan), result: JSON.parse(r.result), type: r.kind, message: r.message, at: new Date(r.created_at).toISOString() }; }
async function workspace(user: string) {
    const db = database(), p = await profile(user);
    const [w, r, b, d, s] = await Promise.all([
        db.prepare('SELECT * FROM nyra_watches WHERE user_id=? ORDER BY created_at DESC').bind(user).all(),
        db.prepare('SELECT * FROM nyra_readings WHERE user_id=? ORDER BY created_at DESC LIMIT 50').bind(user).all(),
        db.prepare('SELECT payload FROM nyra_briefs WHERE user_id=? ORDER BY day DESC LIMIT 1').bind(user).first(),
        db.prepare('SELECT status,COUNT(*) as count FROM nyra_deliveries WHERE user_id=? GROUP BY status').bind(user).all(),
        db.prepare("SELECT last_finished_at,last_result FROM nyra_runner_state WHERE id='main'").first(),
    ]);
    return { ai: await agentConfiguration(), agentRuns: await agentHistory(user), signedIn: true, wallet: p.wallet, walletVerifiedAt: p.wallet_verified_at, telegram: { configured: telegramReady(), linked: !!p.telegram_chat_id, botUsername: telegramReady() ? config().NYRA_TELEGRAM_BOT_USERNAME : null, deliveries: d.results }, watches: w.results.map(x => watchView(x)), readings: r.results.map(x => readView(x)), brief: b ? JSON.parse(String(b.payload)) : null, runner: { lastFinishedAt: s?.last_finished_at ?? null, lastResult: s?.last_result ? JSON.parse(String(s.last_result)) : null, intervalSeconds: CHECK_INTERVAL / 1000, scheduleConfigured: config().NYRA_BACKGROUND_ENABLED === 'true' }, maxWatches: MAX_WATCHES };
}
async function saveReading(user: string, data: Row) { const plan = data.plan; const p = canonicalPlan(plan, { requireWatch: false }); const result = await runTool(p.tool, p.args); const t = Date.parse(result.readAt), id = crypto.randomUUID(); await database().prepare('INSERT INTO nyra_readings (id,user_id,plan,result,kind,created_at) VALUES (?,?,?,?,?,?)').bind(id, user, JSON.stringify(p), JSON.stringify(result), 'reading', t).run(); return { id, result, plan: p }; }
async function createWatch(user: string, data: Row) {
    const db = database(), p = await profile(user);
    if (!p.wallet)
        throw new HttpError(403, 'Verify your wallet before starting a server watch.');
    const plan = canonicalPlan(data.plan), fp = fingerprint(plan), id = crypto.randomUUID();
    const result = await runTool(plan.tool, plan.args);
    if (plan.kind === 'wallet' && result.data && 'failedBalances' in result.data && result.data.failedBalances)
        throw new HttpError(503, 'Some stock balances could not be read. Retry before saving a baseline.');
    const t = now(), rid = crypto.randomUUID();
    const writes = await db.batch([db.prepare('INSERT INTO nyra_watches (id,user_id,fingerprint,plan,previous,last_at,next_at,created_at) SELECT ?,?,?,?,?,?,?,? WHERE (SELECT COUNT(*) FROM nyra_watches WHERE user_id=?) < ? ON CONFLICT(user_id,fingerprint) DO NOTHING').bind(id, user, fp, JSON.stringify(plan), JSON.stringify(result), t, nextCheckAt(t), t, user, MAX_WATCHES), db.prepare('INSERT INTO nyra_readings (id,user_id,watch_id,plan,result,kind,created_at) SELECT ?,?,?,?,?,?,? WHERE EXISTS(SELECT 1 FROM nyra_watches WHERE id=?)').bind(rid, user, id, JSON.stringify(plan), JSON.stringify(result), 'baseline', t, id)]);
    if (!writes[0].meta.changes)
        throw new HttpError(409, 'This watch is already saved, or all five watch slots are in use.');
    return { id, baseline: result, workspace: await workspace(user) };
}
async function changeWatch(user: string, data: Row) {
    if(data.op==='resume'&&!(await profile(user)).wallet)throw new HttpError(403,'Verify your wallet before resuming a server watch.');
    if (!['pause', 'resume', 'remove'].includes(data.op))
        throw new HttpError(400, 'Choose pause, resume or remove.');
    const db = database(), w = await db.prepare('SELECT * FROM nyra_watches WHERE id=? AND user_id=?').bind(String(data.id), user).first<Row>();
    if (!w)
        throw new HttpError(404, 'This watch was not found.');
    if (w.revision !== Number(data.revision))
        throw new HttpError(409, 'The watch changed in another tab. Refresh before trying again.');
    const changed = data.op === 'remove' ? await db.prepare('DELETE FROM nyra_watches WHERE id=? AND user_id=? AND revision=? RETURNING id').bind(w.id, user, w.revision).first() : await db.prepare('UPDATE nyra_watches SET paused=?,revision=revision+1,next_at=?,lease=NULL,lease_until=NULL WHERE id=? AND user_id=? AND revision=? RETURNING id').bind(data.op === 'pause' ? 1 : 0, now(), w.id, user, w.revision).first();
    if (!changed)
        throw new HttpError(409, 'The watch changed. Refresh and try again.');
    return workspace(user);
}
async function buildBrief(user: string, day = new Date().toISOString().slice(0, 10)) { const db = database(), start = Date.parse(day + 'T00:00:00Z'), end = start + 86400000; const [r, w] = await Promise.all([db.prepare('SELECT * FROM nyra_readings WHERE user_id=? AND created_at>=? AND created_at<? ORDER BY created_at DESC LIMIT 500').bind(user, start, end).all(), db.prepare('SELECT * FROM nyra_watches WHERE user_id=?').bind(user).all()]); const payload = makeBrief(r.results, w.results, day), id = user + ':' + day; await db.prepare('INSERT INTO nyra_briefs (id,user_id,day,payload,created_at) VALUES (?,?,?,?,?) ON CONFLICT(user_id,day) DO UPDATE SET payload=excluded.payload,created_at=excluded.created_at').bind(id, user, day, JSON.stringify(payload), now()).run(); return payload; }
async function linkTelegram(user: string) { if (!telegramReady())
    throw new HttpError(409, 'Telegram delivery is prepared but no Nyra bot is configured yet.'); const token = crypto.randomUUID().replaceAll('-', ''), t = now(); await database().prepare('INSERT INTO nyra_challenges (id,user_id,kind,message,expires_at,created_at) VALUES (?,?,?,?,?,?)').bind(token, user, 'telegram', 'Link a private Telegram chat', t + 7200000, t).run(); return { url: 'https://t.me/' + config().NYRA_TELEGRAM_BOT_USERNAME + '?start=' + token, expiresAt: t + 7200000 }; }
async function consumeTelegramMessage(m: any) { if (!m || m.chat?.type !== 'private' || typeof m.text !== 'string')
    return; const token = m.text.match(/^\/start\s+([a-f0-9]{32})$/)?.[1]; if (!token)
    return; const t = now(), db = database(); const c = await db.prepare("UPDATE nyra_challenges SET used_at=? WHERE id=? AND kind='telegram' AND used_at IS NULL AND expires_at>? RETURNING user_id").bind(t, token, t).first<Row>(); if (c)
    await db.prepare('UPDATE nyra_profiles SET telegram_chat_id=?,telegram_linked_at=? WHERE user_id=?').bind(String(m.chat.id), t, c.user_id).run(); }
export async function telegramWebhook(r: Request) { if (!telegramReady() || r.headers.get('X-Telegram-Bot-Api-Secret-Token') !== config().NYRA_TELEGRAM_WEBHOOK_SECRET)
    throw new HttpError(403, 'Webhook is not authorized.'); const data = await body(r); await consumeTelegramMessage(data.message); return { ok: true }; }
async function pollTelegram() { if (!telegramReady())
    return { configured: false }; const db = database(), t = now(), lease = crypto.randomUUID(); await db.prepare("INSERT OR IGNORE INTO nyra_runner_state (id) VALUES ('telegram')").run(); const row = await db.prepare("UPDATE nyra_runner_state SET lease=?,lease_until=? WHERE id='telegram' AND (lease_until IS NULL OR lease_until<?) RETURNING last_result").bind(lease, t + 30000, t).first<Row>(); if (!row)
    return { busy: true }; try {
    const offset = row.last_result ? JSON.parse(row.last_result).offset || 0 : 0;
    const response = await fetch('https://api.telegram.org/bot' + config().NYRA_TELEGRAM_BOT_TOKEN + '/getUpdates', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ offset, limit: 50, timeout: 0, allowed_updates: ['message'] }), signal: AbortSignal.timeout(10000) });
    const data = await response.json() as {
        ok: boolean;
        result?: Array<{
            update_id: number;
            message?: any;
        }>;
    };
    if (!response.ok || !data.ok)
        throw Error('Telegram connection check failed.');
    let next = offset;
    for (const update of data.result || []) {
        await consumeTelegramMessage(update.message);
        next = Math.max(next, update.update_id + 1);
    }
    await db.prepare("UPDATE nyra_runner_state SET lease=NULL,lease_until=NULL,last_finished_at=?,last_result=? WHERE id='telegram' AND lease=?").bind(now(), JSON.stringify({ offset: next }), lease).run();
    return { configured: true };
}
catch (e) {
    await db.prepare("UPDATE nyra_runner_state SET lease=NULL,lease_until=NULL WHERE id='telegram' AND lease=?").bind(lease).run();
    throw e;
} }
async function deliver() {
    const db = database(), stats = { sent: 0, failed: 0, waitingForBot: !telegramReady() };
    if (!telegramReady())
        return stats;
    const pending = await db.prepare("SELECT d.*,p.telegram_chat_id FROM nyra_deliveries d JOIN nyra_profiles p ON p.user_id=d.user_id WHERE d.status='pending' AND d.next_at<=? AND (d.lease_until IS NULL OR d.lease_until<?) AND p.telegram_chat_id IS NOT NULL LIMIT 15").bind(now(), now()).all<Row>();
    for (const d of pending.results) {
        const token = crypto.randomUUID();
        const claim = await db.prepare("UPDATE nyra_deliveries SET lease=?,lease_until=? WHERE id=? AND status='pending' AND (lease_until IS NULL OR lease_until<?) RETURNING id").bind(token, now() + 120000, d.id, now()).first();
        if (!claim)
            continue;
        try {
            const res = await fetch('https://api.telegram.org/bot' + config().NYRA_TELEGRAM_BOT_TOKEN + '/sendMessage', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ chat_id: d.telegram_chat_id, text: telegramText(JSON.parse(d.payload), d.kind), link_preview_options: { is_disabled: true } }), signal: AbortSignal.timeout(10000) });
            const receipt = await res.json() as {
                ok?: boolean;
            };
            if (!res.ok || !receipt.ok)
                throw Error('Telegram did not acknowledge the message.');
            await db.prepare("UPDATE nyra_deliveries SET status='sent',sent_at=?,attempts=attempts+1,lease=NULL,lease_until=NULL,last_error='' WHERE id=? AND lease=?").bind(now(), d.id, token).run();
            stats.sent++;
        }
        catch {
            await db.prepare('UPDATE nyra_deliveries SET attempts=attempts+1,next_at=?,lease=NULL,lease_until=NULL,last_error=? WHERE id=? AND lease=?').bind(now() + Math.min(3600000, 60000 * 2 ** Math.min(d.attempts, 6)), 'Telegram delivery failed; will retry.', d.id, token).run();
            stats.failed++;
        }
    }
    return stats;
}
export async function runChecks() {
    const db = database(), t = now(), token = crypto.randomUUID();
    await db.prepare("INSERT OR IGNORE INTO nyra_runner_state (id) VALUES ('main')").run();
    const lock = await db.prepare("UPDATE nyra_runner_state SET lease=?,lease_until=?,last_started_at=? WHERE id='main' AND (lease_until IS NULL OR lease_until<?) RETURNING id").bind(token, t + 600000, t, t).first();
    if (!lock)
        return { busy: true };
    const stats = { checked: 0, alerts: 0, failed: 0, briefs: 0 };
    try {
        const due = await db.prepare('SELECT * FROM nyra_watches WHERE paused=0 AND next_at<=? AND (lease_until IS NULL OR lease_until<?) ORDER BY next_at LIMIT 12').bind(t, t).all<Row>();
        for (const w of due.results) {
            const lease = crypto.randomUUID();
            const claimed = await db.prepare('UPDATE nyra_watches SET lease=?,lease_until=? WHERE id=? AND paused=0 AND revision=? AND (lease_until IS NULL OR lease_until<?) RETURNING id').bind(lease, now() + 120000, w.id, w.revision, now()).first();
            if (!claimed)
                continue;
            try {
                const plan = JSON.parse(w.plan), result = await runTool(plan.tool, plan.args);
                if (plan.kind === 'wallet' && result.data && 'failedBalances' in result.data && result.data.failedBalances)
                    throw Error('Some stock balances could not be read. The previous baseline is retained.');
                const comparison = compareReading(plan, JSON.parse(w.previous), result), at = now(), rid = crypto.randomUUID();
                const live = await db.prepare('SELECT id FROM nyra_watches WHERE id=? AND lease=? AND revision=? AND paused=0').bind(w.id, lease, w.revision).first();
                if (!live)
                    continue;
                const writes = [db.prepare("UPDATE nyra_watches SET previous=?,checks=checks+1,last_at=?,next_at=?,error='',lease=NULL,lease_until=NULL WHERE id=? AND lease=? AND revision=? AND paused=0").bind(JSON.stringify(result), at, nextCheckAt(at), w.id, lease, w.revision), db.prepare('INSERT INTO nyra_readings (id,user_id,watch_id,plan,result,kind,message,created_at) SELECT ?,?,?,?,?,?,?,? WHERE EXISTS(SELECT 1 FROM nyra_watches WHERE id=? AND revision=? AND paused=0 AND last_at=?)').bind(rid, w.user_id, w.id, w.plan, JSON.stringify(result), comparison.alert ? 'alert' : 'reading', comparison.summary, at, w.id, w.revision, at)];
                if (comparison.alert)
                    writes.push(db.prepare('INSERT OR IGNORE INTO nyra_deliveries (id,user_id,kind,payload,next_at,created_at) SELECT ?,?,?,?,?,? WHERE EXISTS(SELECT 1 FROM nyra_readings WHERE id=?)').bind(rid, w.user_id, 'alert', JSON.stringify({ message: comparison.summary, result }), at, at, rid));
                const completed = await db.batch(writes);
                if (completed[1].meta.changes) {
                    stats.checked++;
                    if (comparison.alert)
                        stats.alerts++;
                }
            }
            catch (e) {
                await db.prepare('UPDATE nyra_watches SET error=?,next_at=?,lease=NULL,lease_until=NULL WHERE id=? AND lease=? AND revision=?').bind(e instanceof Error ? e.message : 'Source read failed.', nextCheckAt(), w.id, lease, w.revision).run();
                stats.failed++;
            }
        }
        const day = new Date(now() - 86400000).toISOString().slice(0, 10), dayStart = Date.parse(day + 'T00:00:00Z');
        const users = await db.prepare('SELECT DISTINCT user_id FROM nyra_readings WHERE created_at>=? AND created_at<? AND user_id NOT IN (SELECT user_id FROM nyra_briefs WHERE day=?) LIMIT 10').bind(dayStart, dayStart + 86400000, day).all<Row>();
        for (const u of users.results) {
            const brief = await buildBrief(u.user_id, day);
            const id = 'brief:' + u.user_id + ':' + day;
            await db.prepare('INSERT OR IGNORE INTO nyra_deliveries (id,user_id,kind,payload,next_at,created_at) VALUES (?,?,?,?,?,?)').bind(id, u.user_id, 'brief', JSON.stringify(brief), now(), now()).run();
            stats.briefs++;
        }
        let telegramStatus: unknown;
        try {
            telegramStatus = await pollTelegram();
        }
        catch {
            telegramStatus = { error: 'Telegram connection check failed.' };
        }
        const delivery = await deliver();
        const result = { ...stats, delivery, telegram: telegramStatus, finishedAt: now() };
        await db.prepare("UPDATE nyra_runner_state SET lease=NULL,lease_until=NULL,last_finished_at=?,last_result=? WHERE id='main' AND lease=?").bind(now(), JSON.stringify(result), token).run();
        return result;
    }
    catch (e) {
        await db.prepare("UPDATE nyra_runner_state SET lease=NULL,lease_until=NULL,last_finished_at=?,last_result=? WHERE id='main' AND lease=?").bind(now(), JSON.stringify({ error: e instanceof Error ? e.message : 'Runner failed' }), token).run();
        throw e;
    }
}
export async function workspaceHandler(r: Request) {
    try {
        const path = new URL(r.url).pathname, db = database();
        // Public deployment: the runner must present its independent service secret.
        if(path.startsWith('/api/internal/')&&!serviceAuthorized(r))throw new HttpError(401,'Service authorization is required.');
        if (path.startsWith('/api/internal/') && r.headers.get('origin') && r.headers.get('origin') !== new URL(r.url).origin)
            throw new HttpError(403, 'This updater must be called by the Site service.');
        if (path === '/api/internal/tick' && ['POST','GET'].includes(r.method))
            return json(await runChecks());
        if (path === '/api/internal/status' && r.method === 'GET')
            return json(await db.prepare("SELECT last_started_at,last_finished_at,last_result FROM nyra_runner_state WHERE id='main'").first());
        if (path === '/api/telegram/webhook' && r.method === 'POST')
            return json(await telegramWebhook(r));
        const user = await userId(r);
        if (path === '/api/workspace' && r.method === 'GET')
            return json(await workspace(user));
        if (r.method !== 'POST')
            throw new HttpError(405, 'Use the supported action.');
        sameOrigin(r);
        const data = await body(r);
        if (path === '/api/agent/ask')
            return await askAgent(user, data);
        if (path === '/api/workspace/read')
            return json(await saveReading(user, data));
        if (path === '/api/watches/create')
            return json(await createWatch(user, data), 201);
        if (path === '/api/watches/change')
            return json(await changeWatch(user, data));
        if (path === '/api/brief')
            return json(await buildBrief(user));
        if (path === '/api/telegram/confirm')
            return json(await pollTelegram());
        if (path === '/api/telegram/link')
            return json(await linkTelegram(user));
        if (path === '/api/telegram/unlink') {
            await db.prepare('UPDATE nyra_profiles SET telegram_chat_id=NULL,telegram_linked_at=NULL WHERE user_id=?').bind(user).run();
            return json(await workspace(user));
        }
        throw new HttpError(404, 'This action was not found.');
    }
    catch (e) {
        return json({ error: e instanceof HttpError?e.message:'The request could not complete. Your saved workspace is preserved; retry shortly.' }, e instanceof HttpError ? e.status : 400);
    }
}
