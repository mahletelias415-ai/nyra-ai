import {database,writeTransaction} from './database.js';
import {BillingError} from './payment-core.mjs';
import {makeScoutBrief,nextScoutBriefAt,DAY} from './scout-brief-core.mjs';
const db=database;
export async function scoutBriefAccount(user:string){const [settings,latest]=await Promise.all([db().prepare('SELECT * FROM nyra_scout_brief_settings WHERE user_id=?').bind(user).first(),db().prepare("SELECT b.payload,d.status AS delivery_status FROM nyra_scout_briefs b LEFT JOIN nyra_deliveries d ON d.id='scoutbrief:' || b.id WHERE b.user_id=? ORDER BY b.created_at DESC LIMIT 1").bind(user).first()]);return {settings:{enabled:!!settings?.enabled,hourUTC:Number(settings?.hour_utc??4),revision:Number(settings?.revision??0),nextAt:settings?.next_at||null},latest:latest?{...JSON.parse(String(latest.payload)),delivery:latest.delivery_status||'not queued'}:null};}
export async function configureScoutBrief(user:string,data:Record<string,any>){
 if(typeof data.enabled!=='boolean'||!Number.isInteger(data.hourUTC)||data.hourUTC<0||data.hourUTC>23||!Number.isInteger(data.revision))throw new BillingError(400,'Choose a UTC hour from 0 to 23 and refresh the saved settings.');
 const tx=await writeTransaction(),at=Date.now();try{
  const p=(await tx.execute({sql:'SELECT wallet_verified_at,telegram_chat_id FROM nyra_profiles WHERE user_id=?',args:[user]})).rows[0];if(!p?.wallet_verified_at)throw new BillingError(403,'Sign in with your wallet first.');if(data.enabled&&!p.telegram_chat_id)throw new BillingError(409,'Connect your private Telegram chat before enabling daily delivery.');
  await tx.execute({sql:'INSERT OR IGNORE INTO nyra_scout_brief_settings(user_id,updated_at) VALUES(?,?)',args:[user,at]});
  const changed=await tx.execute({sql:'UPDATE nyra_scout_brief_settings SET enabled=?,hour_utc=?,next_at=?,revision=revision+1,updated_at=? WHERE user_id=? AND revision=? RETURNING user_id',args:[data.enabled?1:0,data.hourUTC,data.enabled?nextScoutBriefAt(at,data.hourUTC):null,at,user,data.revision]});if(!changed.rows.length)throw new BillingError(409,'Brief settings changed in another tab. Refresh before saving.');
  await tx.execute({sql:"UPDATE nyra_deliveries SET status='cancelled',lease=NULL,lease_until=NULL WHERE user_id=? AND kind='scout_brief' AND status='pending'",args:[user]});await tx.commit();
 }catch(e){await tx.rollback();throw e;}finally{tx.close();}return scoutBriefAccount(user);
}
export async function buildScoutBrief(user:string,{at=Date.now(),slot=null}:{at?:number;slot?:string|null}={}){
 if(slot){const old=await db().prepare('SELECT payload FROM nyra_scout_briefs WHERE user_id=? AND slot=?').bind(user,slot).first();if(old)return JSON.parse(String(old.payload));}
 else{const recent=await db().prepare('SELECT payload FROM nyra_scout_briefs WHERE user_id=? AND created_at>? ORDER BY created_at DESC LIMIT 1').bind(user,at-60000).first();if(recent)return JSON.parse(String(recent.payload));}
 const from=at-DAY;
 const [rows,m,runs]=await Promise.all([
  db().prepare("SELECT r.*,m.title,m.conditions_revision AS current_revision,COALESCE((SELECT o.payload FROM nyra_scout_observations o WHERE o.user_id=? AND o.result_id=r.id AND o.checked_at<? ORDER BY o.checked_at DESC,o.id DESC LIMIT 1),(SELECT o.payload FROM nyra_scout_observations o WHERE o.user_id=? AND o.result_id=r.id AND o.checked_at>=? AND o.checked_at<=? ORDER BY o.checked_at,o.id LIMIT 1)) AS baseline,(SELECT MIN(o.checked_at) FROM nyra_scout_observations o WHERE o.user_id=? AND o.result_id=r.id AND json_extract(o.payload,'$.decision')='matched') AS first_match_at FROM nyra_scout_results r JOIN nyra_scout_missions m ON m.id=r.mission_id WHERE r.user_id=? AND m.user_id=? AND m.deleted_at IS NULL AND r.checked_at>=? AND r.checked_at<=? ORDER BY r.checked_at DESC LIMIT 101").bind(user,from,user,from,at,user,user,user,from,at).all(),
  db().prepare('SELECT COUNT(*) AS n FROM nyra_scout_missions WHERE user_id=? AND deleted_at IS NULL').bind(user).first(),
  db().prepare("SELECT COUNT(*) AS n,SUM(CASE WHEN s.status IN ('failed','interrupted','partial') THEN 1 ELSE 0 END) AS errors FROM nyra_scout_runs s JOIN nyra_scout_missions m ON m.id=s.mission_id WHERE s.user_id=? AND m.deleted_at IS NULL AND s.started_at>=? AND s.started_at<=?").bind(user,from,at).first()
 ]);
 const brief={id:crypto.randomUUID(),createdAt:Date.now(),...makeScoutBrief(rows.results.slice(0,100),from,at,{truncated:rows.results.length>100,missionCount:Number(m?.n||0),runs:Number(runs?.n||0),failedRuns:Number(runs?.errors||0)})};
 await db().prepare('INSERT INTO nyra_scout_briefs(id,user_id,slot,payload,created_at) VALUES(?,?,?,?,?) ON CONFLICT(user_id,slot) DO NOTHING').bind(brief.id,user,slot,JSON.stringify(brief),brief.createdAt).run();
 if(slot)return JSON.parse(String((await db().prepare('SELECT payload FROM nyra_scout_briefs WHERE user_id=? AND slot=?').bind(user,slot).first())!.payload));return brief;
}
export async function queueScoutBriefs(deadline=Date.now()+15000){
 const at=Date.now(),due=await db().prepare('SELECT s.* FROM nyra_scout_brief_settings s JOIN nyra_profiles p ON p.user_id=s.user_id WHERE s.enabled=1 AND s.next_at<=? AND p.telegram_chat_id IS NOT NULL ORDER BY s.next_at LIMIT 10').bind(at).all();let queued=0;
 for(const s of due.results){if(Date.now()>deadline-1500)break;const slotAt=nextScoutBriefAt(at,Number(s.hour_utc))-DAY,slot=new Date(slotAt).toISOString(),b=await buildScoutBrief(String(s.user_id),{at,slot});
  const writes=await db().batch([db().prepare("INSERT OR IGNORE INTO nyra_deliveries(id,user_id,kind,payload,next_at,created_at) SELECT ?,?,'scout_brief',?,?,? WHERE EXISTS(SELECT 1 FROM nyra_scout_brief_settings WHERE user_id=? AND enabled=1 AND revision=? AND next_at<=?) AND EXISTS(SELECT 1 FROM nyra_profiles WHERE user_id=? AND telegram_chat_id IS NOT NULL)").bind('scoutbrief:'+b.id,s.user_id,JSON.stringify({brief:b,settingsRevision:s.revision}),at,at,s.user_id,s.revision,at,s.user_id),db().prepare('UPDATE nyra_scout_brief_settings SET next_at=? WHERE user_id=? AND enabled=1 AND revision=? AND next_at<=?').bind(nextScoutBriefAt(at,Number(s.hour_utc)),s.user_id,s.revision,at)]);queued+=writes[0].meta.changes;
 }return {queued,deferred:due.results.length-queued};
}
