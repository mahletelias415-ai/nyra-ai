import { database as runtimeDatabase } from './database.js';
import { sessionUser, serviceAuthorized } from './auth.js';
import { agentConfiguration, agentHistory, askAgent } from './agent-service.js';
import { runTool } from './tools.mjs';
import { checkPublicWatch, publicVerification } from './verification.js';
import {catalog,tokenAccount,preparePurchase,confirmPurchase,settlePendingPurchases} from './billing.js';
import {BillingError} from './payment-core.mjs';
import { validWebhookSecret, telegramCommand, botHelp, statusText, watchesText, clipTelegram } from './telegram-core.mjs';
import { canonicalPlan, fingerprint, CHECK_INTERVAL, nextCheckAt, MAX_WATCHES, compareReading, makeBrief, telegramText } from './watch-core.mjs';
import {scoutWorkspace,createScout,changeScout,scanScout,runScoutChecks} from './scout-service.js';
import {confirmScoutDraft,cancelScoutDraft} from './scout-drafts.js';
import {scoutHistory} from './scout-history.js';
import {scoutTelegram} from './scout-core.mjs';
import {telegramScout} from './telegram-scout.js';
import {scoutBriefAccount,configureScoutBrief,buildScoutBrief,queueScoutBriefs} from './scout-brief.js';
import {scoutBriefTelegram} from './scout-brief-core.mjs';
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
    const db = database(), p = await profile(user), agentRuns=await agentHistory(user), token=await tokenAccount(user);
    const [w, r, b, d, s, scout] = await Promise.all([
        db.prepare('SELECT * FROM nyra_watches WHERE user_id=? ORDER BY created_at DESC').bind(user).all(),
        db.prepare('SELECT * FROM nyra_readings WHERE user_id=? ORDER BY created_at DESC LIMIT 50').bind(user).all(),
        db.prepare('SELECT payload FROM nyra_briefs WHERE user_id=? ORDER BY day DESC LIMIT 1').bind(user).first(),
        db.prepare('SELECT status,COUNT(*) as count FROM nyra_deliveries WHERE user_id=? GROUP BY status').bind(user).all(),
        db.prepare("SELECT last_finished_at,last_result FROM nyra_runner_state WHERE id='main'").first(),
        scoutWorkspace(user),
    ]);
    return { scout,scoutBrief:await scoutBriefAccount(user), ai: await agentConfiguration(), agentRuns, token, signedIn: true, wallet: p.wallet, walletVerifiedAt: p.wallet_verified_at, telegram: { configured: telegramReady(), linked: !!p.telegram_chat_id, botUsername: telegramReady() ? config().NYRA_TELEGRAM_BOT_USERNAME : null, deliveries: d.results }, watches: w.results.map(x => watchView(x)), readings: r.results.map(x => readView(x)), brief: b ? JSON.parse(String(b.payload)) : null, runner: { lastFinishedAt: s?.last_finished_at ?? null, lastResult: s?.last_result ? JSON.parse(String(s.last_result)) : null, intervalSeconds: CHECK_INTERVAL / 1000, scheduleConfigured: config().NYRA_BACKGROUND_ENABLED === 'true' }, maxWatches: token.maxWatches };
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
    const writes = await db.batch([db.prepare('INSERT INTO nyra_watches (id,user_id,fingerprint,plan,previous,last_at,next_at,created_at) SELECT ?,?,?,?,?,?,?,? WHERE ((SELECT COUNT(*) FROM nyra_watches WHERE user_id=?)+(SELECT COUNT(*) FROM nyra_scout_missions WHERE user_id=? AND deleted_at IS NULL)) < (? + COALESCE((SELECT watch_slots FROM nyra_entitlements WHERE user_id=?),0)) ON CONFLICT(user_id,fingerprint) DO NOTHING').bind(id, user, fp, JSON.stringify(plan), JSON.stringify(result), t, nextCheckAt(t), t, user, user, MAX_WATCHES,user), db.prepare('INSERT INTO nyra_readings (id,user_id,watch_id,plan,result,kind,created_at) SELECT ?,?,?,?,?,?,? WHERE EXISTS(SELECT 1 FROM nyra_watches WHERE id=?)').bind(rid, user, id, JSON.stringify(plan), JSON.stringify(result), 'baseline', t, id)]);
    if (!writes[0].meta.changes)
        throw new HttpError(409, 'This watch is already saved, or all your watch slots are in use. Add a NYRA watch pack for more slots.');
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
async function disconnectTelegram(user: string) {
    await database().batch([
        database().prepare("UPDATE nyra_telegram_updates SET status='cancelled',lease=NULL,lease_until=NULL WHERE chat_id=(SELECT telegram_chat_id FROM nyra_profiles WHERE user_id=?) AND status IN ('pending','sending')").bind(user),
        database().prepare('DELETE FROM nyra_telegram_scout_context WHERE user_id=?').bind(user),
        database().prepare('UPDATE nyra_profiles SET telegram_chat_id=NULL,telegram_linked_at=NULL WHERE user_id=?').bind(user),
        database().prepare("UPDATE nyra_deliveries SET status='cancelled',lease=NULL,lease_until=NULL WHERE user_id=? AND status='pending'").bind(user),
        database().prepare("UPDATE nyra_challenges SET used_at=? WHERE user_id=? AND kind='telegram' AND used_at IS NULL").bind(now(),user),
    ]);
}
async function linkTelegram(user: string) {
    if (!telegramReady()) throw new HttpError(409, 'Telegram delivery is not configured yet.');
    const p=await profile(user);
    if (!p.wallet_verified_at) throw new HttpError(403,'Verify your wallet first.');
    if (p.telegram_chat_id) throw new HttpError(409,'Disconnect the current Telegram chat before connecting another.');
    const token=crypto.randomUUID().replaceAll('-',''), t=now();
    await database().batch([
        database().prepare("UPDATE nyra_challenges SET used_at=? WHERE user_id=? AND kind='telegram' AND used_at IS NULL").bind(t,user),
        database().prepare('INSERT INTO nyra_challenges (id,user_id,kind,message,expires_at,created_at) VALUES (?,?,?,?,?,?)').bind(token,user,'telegram','Link a private Telegram chat',t+900000,t),
    ]);
    return {url:'https://t.me/'+config().NYRA_TELEGRAM_BOT_USERNAME+'?start='+token,expiresAt:t+900000};
}
async function telegramCommandReply(m: {id:number;chatId:string;command:string;argument:string;text:string},expectedUser?:string): Promise<any> {
    const db=database(),t=now();
    const linked=await db.prepare('SELECT * FROM nyra_profiles WHERE telegram_chat_id=?').bind(m.chatId).first<Row>();
    if(expectedUser&&linked?.user_id!==expectedUser)return 'This Telegram connection changed. Open Nyra before sending another request.';
    if(m.command==='start' && m.argument){
        if(!/^[a-f0-9]{32}$/.test(m.argument))return 'This connection link is invalid. Get a fresh link from https://nyraagent.online/#desk';
        if(linked)return 'This chat is already connected. Use /status, or /stop before connecting another account.';
        const c=await db.prepare("SELECT user_id FROM nyra_challenges WHERE id=? AND kind='telegram' AND used_at IS NULL AND expires_at>?").bind(m.argument,t).first<Row>();
        if(!c)return 'This connection link expired or was already used. Get a fresh link from https://nyraagent.online/#desk';
        const written=await db.batch([
            db.prepare("UPDATE nyra_profiles SET telegram_chat_id=?,telegram_linked_at=? WHERE user_id=? AND telegram_chat_id IS NULL AND wallet_verified_at IS NOT NULL AND EXISTS(SELECT 1 FROM nyra_challenges WHERE id=? AND user_id=? AND kind='telegram' AND used_at IS NULL AND expires_at>?) AND NOT EXISTS(SELECT 1 FROM nyra_profiles WHERE telegram_chat_id=?)").bind(m.chatId,t,c.user_id,m.argument,c.user_id,t,m.chatId),
            db.prepare('UPDATE nyra_challenges SET used_at=? WHERE id=? AND user_id=? AND used_at IS NULL AND EXISTS(SELECT 1 FROM nyra_profiles WHERE user_id=? AND telegram_chat_id=? AND telegram_linked_at=?)').bind(t,m.argument,c.user_id,c.user_id,m.chatId,t),
            db.prepare("UPDATE nyra_deliveries SET status='cancelled',lease=NULL,lease_until=NULL WHERE user_id=? AND status='pending' AND created_at<? AND EXISTS(SELECT 1 FROM nyra_challenges WHERE id=? AND used_at=?)").bind(c.user_id,t,m.argument,t),
        ]);
        return written[0].meta.changes ? 'Telegram connected. Watch alerts and saved daily briefs will arrive here. Checks run hourly.\n\n'+botHelp(true) : 'This link could not connect the account. Disconnect any existing chat in Nyra and request a fresh link.';
    }
    if(!linked)return botHelp(false);
    if(m.command==='stop'){
        await disconnectTelegram(linked.user_id);
        return 'Telegram disconnected. No further watch alerts will be sent to this chat. Your research and watches remain in Nyra. Reconnect from https://nyraagent.online/#desk';
    }
    if(m.command==='status'){
        const count=await db.prepare('SELECT COUNT(*) AS total FROM nyra_watches WHERE user_id=? AND paused=0').bind(linked.user_id).first<Row>();
        const runner=await db.prepare("SELECT last_finished_at FROM nyra_runner_state WHERE id='main'").first<Row>();
        return statusText(linked,Number(count?.total||0),runner?.last_finished_at);
    }
    if(m.command==='watches'){
        const w=await db.prepare('SELECT plan,paused,checks,error FROM nyra_watches WHERE user_id=? ORDER BY created_at DESC LIMIT 30').bind(linked.user_id).all<Row>();
        return watchesText(w.results);
    }
    if(['text','missions','new'].includes(m.command))return telegramScout(linked.user_id,m.chatId,m.command==='text'?m.text:'/'+m.command,m.id);
    if(m.command==='scoutbrief')return scoutBriefTelegram(await buildScoutBrief(linked.user_id));
    if(m.command==='daily'){
        const state=await scoutBriefAccount(linked.user_id),match=m.argument.match(/^(on|off)(?:\s+(\d{1,2}))?$/i);
        if(!match)return 'Scout brief: '+(state.settings.enabled?'daily at '+String(state.settings.hourUTC).padStart(2,'0')+':00 UTC':'off')+'\n/daily on 4 — enable at 04:00 UTC\n/daily off — stop daily delivery\n/scoutbrief — build a recap now\nhttps://nyraagent.online/#scout-brief';
        const next=await configureScoutBrief(linked.user_id,{enabled:match[1].toLowerCase()==='on',hourUTC:match[2]===undefined?state.settings.hourUTC:Number(match[2]),revision:state.settings.revision});
        return next.settings.enabled?'Daily Scout brief enabled. Next scheduled time: '+new Date(Number(next.settings.nextAt)).toISOString()+'. Sent on the first available hourly server cycle.\n/scoutbrief for a recap now.':'Daily Scout delivery disabled. Saved missions and brief history remain in your workspace.';
    }
    if(m.command==='brief')return telegramText(await buildBrief(linked.user_id),'brief');
    return botHelp(true);
}
export async function deliverTelegramReplies(onlyId?: number,deadline=Date.now()+30000) {
    if(!telegramReady())return {sent:0,failed:0,configured:false};
    const db=database(),t=now(),stats={sent:0,failed:0,configured:true};
    const pending=await db.prepare("SELECT * FROM nyra_telegram_updates WHERE reply IS NOT NULL AND next_at<=? AND (status='pending' OR (status='sending' AND lease_until<?))"+(onlyId===undefined?'':' AND id=?')+' ORDER BY next_at LIMIT 10').bind(...(onlyId===undefined?[t,t]:[t,t,onlyId])).all<Row>();
    for(const item of pending.results){
        if(now()>deadline-11000)break;
        const lease=crypto.randomUUID();
        const claim=await db.prepare("UPDATE nyra_telegram_updates SET status='sending',lease=?,lease_until=? WHERE id=? AND (status='pending' OR (status='sending' AND lease_until<?)) RETURNING id").bind(lease,now()+120000,item.id,now()).first();
        if(!claim)continue;
        try{
            if(item.user_id&&!await db.prepare('SELECT user_id FROM nyra_profiles WHERE user_id=? AND telegram_chat_id=?').bind(item.user_id,item.chat_id).first()){await db.prepare("UPDATE nyra_telegram_updates SET status='cancelled',lease=NULL,lease_until=NULL WHERE id=? AND lease=?").bind(item.id,lease).run();continue;}
            const r=await fetch('https://api.telegram.org/bot'+config().NYRA_TELEGRAM_BOT_TOKEN+'/sendMessage',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({chat_id:item.chat_id,text:item.reply,link_preview_options:{is_disabled:true},reply_markup:item.reply_markup?JSON.parse(item.reply_markup):{inline_keyboard:[[{text:'Open Nyra',url:'https://nyraagent.online/#desk'}]]}}),signal:AbortSignal.timeout(10000)});
            const result=await r.json() as {ok?:boolean};
            if(!r.ok||!result.ok)throw Error('Telegram delivery failed.');
            await db.prepare("UPDATE nyra_telegram_updates SET status='sent',finished_at=?,attempts=attempts+1,lease=NULL,lease_until=NULL,last_error='' WHERE id=? AND lease=?").bind(now(),item.id,lease).run();stats.sent++;
        }catch{
            await db.prepare("UPDATE nyra_telegram_updates SET status='pending',attempts=attempts+1,next_at=?,lease=NULL,lease_until=NULL,last_error='Telegram delivery failed; will retry.' WHERE id=? AND lease=?").bind(now()+Math.min(3600000,60000*2**Math.min(item.attempts,6)),item.id,lease).run();stats.failed++;
        }
    }
    return stats;
}
export async function telegramWebhook(r: Request) {
    if(!telegramReady()||!validWebhookSecret(r.headers.get('X-Telegram-Bot-Api-Secret-Token'),config().NYRA_TELEGRAM_WEBHOOK_SECRET))throw new HttpError(403,'Webhook is not authorized.');
    const update=await body(r),m=telegramCommand(update,config().NYRA_TELEGRAM_BOT_USERNAME);
    if(!m)return {ok:true};
    const db=database(),t=now(),until=t+150000;
    const old=await db.prepare('SELECT status,user_id FROM nyra_telegram_updates WHERE id=?').bind(m.id).first<Row>();
    if(old&&old.status!=='processing'){await deliverTelegramReplies(m.id);return {ok:true};}
    const claimed=await db.prepare("INSERT INTO nyra_telegram_updates (id,chat_id,status,lease_until,next_at,created_at) VALUES (?,?,'processing',?,?,?) ON CONFLICT(id) DO UPDATE SET lease_until=excluded.lease_until WHERE nyra_telegram_updates.status='processing' AND nyra_telegram_updates.lease_until<? RETURNING id").bind(m.id,m.chatId,until,t,t,t).first();
    if(!claimed)throw new HttpError(503,'This update is still processing.');
    const rate=await db.prepare('INSERT INTO nyra_rate_limits (key,bucket,count) VALUES (?,?,1) ON CONFLICT(key,bucket) DO UPDATE SET count=count+1 RETURNING count').bind('telegram:'+m.chatId,Math.floor(t/60000)).first<Row>();
    if(Number(rate?.count)>11){await db.prepare("UPDATE nyra_telegram_updates SET status='sent',finished_at=?,lease_until=NULL WHERE id=?").bind(now(),m.id).run();return {ok:true};}
    const linkedBefore=await db.prepare('SELECT user_id FROM nyra_profiles WHERE telegram_chat_id=?').bind(m.chatId).first<Row>();
    if(old?.user_id&&old.user_id!==linkedBefore?.user_id){await db.prepare("UPDATE nyra_telegram_updates SET status='cancelled',lease_until=NULL WHERE id=?").bind(m.id).run();return {ok:true};}
    if(linkedBefore)await db.prepare("UPDATE nyra_telegram_updates SET user_id=? WHERE id=? AND status='processing' AND lease_until=?").bind(linkedBefore.user_id,m.id,until).run();
    let reply:any;
    try{reply=Number(rate?.count)===11?'Too many commands. Please wait a minute.':await telegramCommandReply(m,linkedBefore?.user_id);}catch(e){if(e instanceof BillingError&&e.status===503&&/still processing|outdated/.test(e.message))throw e;reply={text:e instanceof BillingError?e.message:'Nyra could not finish this request. Your saved missions are unchanged. Send a fresh message to retry.'};}
    const linked=await db.prepare('SELECT user_id FROM nyra_profiles WHERE telegram_chat_id=?').bind(m.chatId).first<Row>();
    if(reply?.silent){await db.prepare("UPDATE nyra_telegram_updates SET status='sent',finished_at=?,lease_until=NULL WHERE id=? AND status='processing' AND lease_until=?").bind(now(),m.id,until).run();return {ok:true};}
    const content=typeof reply==='string'?reply:reply.text;
    await db.prepare("UPDATE nyra_telegram_updates SET status='pending',reply=?,reply_markup=?,user_id=?,lease_until=NULL,next_at=? WHERE id=? AND status='processing' AND lease_until=?").bind(clipTelegram(content),typeof reply==='object'&&reply.markup?JSON.stringify(reply.markup):null,m.command==='stop'?null:linkedBefore?.user_id||linked?.user_id||null,now(),m.id,until).run();
    await deliverTelegramReplies(m.id);
    if(reply?.scanId&&linked){try{await scanScout(linked.user_id,reply.scanId,{deadline:Date.now()+70000,scheduled:true});await deliver(Date.now()+12000,linked.user_id);}catch{/* The saved mission remains due for the regular server runner. */}}
    return {ok:true};
}
export async function deliver(deadline=Date.now()+25000,onlyUser?:string) {
    const db = database(), stats = { sent: 0, failed: 0, waitingForBot: !telegramReady() };
    if (!telegramReady())
        return stats;
    const pending = await db.prepare("SELECT d.*,p.telegram_chat_id FROM nyra_deliveries d JOIN nyra_profiles p ON p.user_id=d.user_id WHERE d.status='pending' AND d.next_at<=? AND (d.lease_until IS NULL OR d.lease_until<?) AND p.telegram_chat_id IS NOT NULL"+(onlyUser?' AND d.user_id=?':'')+" ORDER BY d.next_at,d.created_at LIMIT 15").bind(...(onlyUser?[now(),now(),onlyUser]:[now(),now()])).all<Row>();
    for (const d of pending.results) {
        if(now()>deadline-11000)break;
        const token = crypto.randomUUID();
        const claim = await db.prepare("UPDATE nyra_deliveries SET lease=?,lease_until=? WHERE id=? AND status='pending' AND (lease_until IS NULL OR lease_until<?) RETURNING id").bind(token, now() + 120000, d.id, now()).first();
        if (!claim)
            continue;
        try {
            const destination=await db.prepare("SELECT p.telegram_chat_id FROM nyra_profiles p JOIN nyra_deliveries d ON d.user_id=p.user_id WHERE d.id=? AND d.lease=? AND d.status='pending' AND p.telegram_chat_id=?").bind(d.id,token,d.telegram_chat_id).first<Row>();
            if(!destination)continue;
            if(d.kind==='scout'){const payload=JSON.parse(d.payload);const active=await db.prepare('SELECT id FROM nyra_scout_missions WHERE id=? AND user_id=? AND paused=0 AND deleted_at IS NULL').bind(payload.missionId,d.user_id).first();if(!active){await db.prepare("UPDATE nyra_deliveries SET status='cancelled',lease=NULL,lease_until=NULL WHERE id=? AND lease=?").bind(d.id,token).run();continue;}}
            if(d.kind==='scout_brief'){const payload=JSON.parse(d.payload),active=await db.prepare('SELECT user_id FROM nyra_scout_brief_settings WHERE user_id=? AND enabled=1 AND revision=?').bind(d.user_id,payload.settingsRevision).first();if(!active){await db.prepare("UPDATE nyra_deliveries SET status='cancelled',lease=NULL,lease_until=NULL WHERE id=? AND lease=?").bind(d.id,token).run();continue;}}
            const res = await fetch('https://api.telegram.org/bot' + config().NYRA_TELEGRAM_BOT_TOKEN + '/sendMessage', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ chat_id: d.telegram_chat_id, text: d.kind==='scout'?scoutTelegram(JSON.parse(d.payload)):d.kind==='scout_brief'?scoutBriefTelegram(JSON.parse(d.payload)):telegramText(JSON.parse(d.payload), d.kind), link_preview_options: { is_disabled: true } }), signal: AbortSignal.timeout(10000) });
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
        const publicWatch = await checkPublicWatch();
        const scoutBriefs=await queueScoutBriefs(t+30000);
        const due = await db.prepare('SELECT * FROM nyra_watches WHERE paused=0 AND next_at<=? AND (lease_until IS NULL OR lease_until<?) ORDER BY next_at LIMIT 100').bind(t, t).all<Row>();
        const checkOne = async (w:Row) => {
            if(now()-t>80000)return;

            const lease = crypto.randomUUID();
            const claimed = await db.prepare('UPDATE nyra_watches SET lease=?,lease_until=? WHERE id=? AND paused=0 AND revision=? AND (lease_until IS NULL OR lease_until<?) RETURNING id').bind(lease, now() + 120000, w.id, w.revision, now()).first();
            if (!claimed)
                return;
            try {
                const plan = JSON.parse(w.plan), result = await runTool(plan.tool, plan.args);
                if (plan.kind === 'wallet' && result.data && 'failedBalances' in result.data && result.data.failedBalances)
                    throw Error('Some stock balances could not be read. The previous baseline is retained.');
                const comparison = compareReading(plan, JSON.parse(w.previous), result), at = now(), rid = crypto.randomUUID();
                const live = await db.prepare('SELECT id FROM nyra_watches WHERE id=? AND lease=? AND revision=? AND paused=0').bind(w.id, lease, w.revision).first();
                if (!live)
                    return;
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
        for(let i=0;i<due.results.length;i+=3)await Promise.all(due.results.slice(i,i+3).map(checkOne));
        const scout = await runScoutChecks(t+95000);
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
            telegramStatus = {mode:'webhook',...(await deliverTelegramReplies(undefined,t+110000))};
            await db.prepare("DELETE FROM nyra_telegram_updates WHERE status='sent' AND finished_at<?").bind(now()-7*86400000).run();
        }
        catch {
            telegramStatus = { error: 'Telegram connection check failed.' };
        }
        const delivery = await deliver(t+110000);
        const purchases=now()-t<90000?await settlePendingPurchases():{deferred:true};
        const result = { ...stats,scout,scoutBriefs,purchases, delivery, telegram: telegramStatus, publicWatch, finishedAt: now() };
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
        if (path === '/api/verification' && r.method === 'GET') return json(await publicVerification());
        if(path==='/api/token/catalog'&&r.method==='GET')return json(catalog());
        const user = await userId(r);
        if(path==='/api/scout'&&r.method==='GET')return json(await scoutWorkspace(user));
        if(path==='/api/scout/brief'&&r.method==='GET')return json(await scoutBriefAccount(user));
        if(path==='/api/token/account'&&r.method==='GET')return json(await tokenAccount(user));
        if (path === '/api/workspace' && r.method === 'GET')
            return json(await workspace(user));
        if (r.method !== 'POST')
            throw new HttpError(405, 'Use the supported action.');
        sameOrigin(r);
        const data = await body(r);
        if(path==='/api/scout/brief/settings')return json(await configureScoutBrief(user,data));
        if(path==='/api/scout/brief/build'){await buildScoutBrief(user);return json(await scoutBriefAccount(user));}
        if(path==='/api/scout/drafts/confirm'){const d=await confirmScoutDraft(user,data);return json({...d,scout:await scoutWorkspace(user)});}
        if(path==='/api/scout/drafts/cancel'){await cancelScoutDraft(user,data);return json(await scoutWorkspace(user));}
        if(path==='/api/scout/history')return json(await scoutHistory(user,String(data.resultId||'')));
        if(path==='/api/scout/create')return json(await createScout(user,data),201);
        if(path==='/api/scout/change')return json(await changeScout(user,data));
        if(path==='/api/scout/scan'){const result=await scanScout(user,String(data.id||''));const delivery=await deliver(Date.now()+15000,user);return json({...result,delivery,scout:await scoutWorkspace(user)});}
        if(path==='/api/token/prepare')return json(await preparePurchase(user,String(data.sku||'')));
        if(path==='/api/token/confirm')return json(await confirmPurchase(user,String(data.id||''),String(data.hash||'')));
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
            return json({configured:telegramReady(),linked:!!(await profile(user)).telegram_chat_id});
        if (path === '/api/telegram/link')
            return json(await linkTelegram(user));
        if (path === '/api/telegram/unlink') {
            await disconnectTelegram(user);
            return json(await workspace(user));
        }
        throw new HttpError(404, 'This action was not found.');
    }
    catch (e) {
        return json({ error: (e instanceof HttpError||e instanceof BillingError)?e.message:'The request could not complete. Your saved workspace is preserved; retry shortly.' }, (e instanceof HttpError||e instanceof BillingError) ? e.status : 400);
    }
}
