import {database,writeTransaction} from './database.js';
import {BillingError} from './payment-core.mjs';
import {scoutConditions,conditionsText,evaluateScout} from './scout-core.mjs';
import {discoverScout,scoutEvidence} from './scout-sources.js';
import {nextCheckAt} from './watch-core.mjs';
import {scoutDrafts} from './scout-drafts.js';
import {scoutSnapshot} from './scout-history-core.mjs';
type Row=Record<string,any>;
const missionView=(r:Row)=>({id:r.id,title:r.title,conditions:JSON.parse(r.conditions),description:conditionsText(JSON.parse(r.conditions)),paused:!!r.paused,revision:r.revision,createdAt:r.created_at,lastAt:r.last_at,nextAt:r.next_at,checks:r.checks,error:r.error,updatedAt:r.updated_at||null,conditionsRevision:r.conditions_revision,running:!!r.lease&&Number(r.lease_until)>Date.now()});
export async function scoutWorkspace(user:string){
 const db=database(),[m,r,s,drafts]=await Promise.all([
  db.prepare('SELECT * FROM nyra_scout_missions WHERE user_id=? AND deleted_at IS NULL ORDER BY created_at DESC').bind(user).all(),
  db.prepare("SELECT r.*,m.conditions_revision AS mission_conditions_revision,d.status AS delivery_status,d.sent_at FROM nyra_scout_results r LEFT JOIN nyra_deliveries d ON d.id='scout:' || r.id JOIN nyra_scout_missions m ON r.mission_id=m.id WHERE r.user_id=? AND m.deleted_at IS NULL ORDER BY r.checked_at DESC LIMIT 50").bind(user).all(),
  db.prepare('SELECT r.* FROM nyra_scout_runs r JOIN nyra_scout_missions m ON r.mission_id=m.id WHERE r.user_id=? AND m.deleted_at IS NULL ORDER BY r.started_at DESC LIMIT 20').bind(user).all(),scoutDrafts(user)
 ]);
 return {drafts,missions:m.results.map(missionView),results:r.results.map(x=>({id:x.id,missionId:x.mission_id,decision:Number(x.conditions_revision)!==Number(x.mission_conditions_revision)?'unknown':x.decision,outdated:Number(x.conditions_revision)!==Number(x.mission_conditions_revision),checkedAt:x.checked_at,report:JSON.parse(String(x.payload)),notification:x.delivery_status||'not queued',sentAt:x.sent_at||null})),runs:s.results.map(x=>({id:x.id,missionId:x.mission_id,status:x.status,startedAt:x.started_at,finishedAt:x.finished_at,payload:JSON.parse(String(x.payload))})),intervalSeconds:3600,notice:'One mission uses one watch slot. Search and checks do not use an AI-request credit.'};
}
export async function createScout(user:string,data:Row){
 let conditions;try{conditions=scoutConditions(data.conditions);}catch(e){throw new BillingError(400,(e as Error).message);}
 const title=typeof data.title==='string'?data.title.trim():'';if(!title||title.length>100)throw new BillingError(400,'Name your mission in 1–100 characters.');
 const db=database(),p=await db.prepare('SELECT wallet_verified_at FROM nyra_profiles WHERE user_id=?').bind(user).first();if(!p?.wallet_verified_at)throw new BillingError(403,'Sign in with your wallet to start a Scout mission.');
 const id=crypto.randomUUID(),now=Date.now();
 const created=await db.prepare('INSERT INTO nyra_scout_missions(id,user_id,title,conditions,created_at,next_at) SELECT ?,?,?,?,?,? WHERE ((SELECT COUNT(*) FROM nyra_watches WHERE user_id=?)+(SELECT COUNT(*) FROM nyra_scout_missions WHERE user_id=? AND deleted_at IS NULL)) < (5+COALESCE((SELECT watch_slots FROM nyra_entitlements WHERE user_id=?),0)) RETURNING id').bind(id,user,title,JSON.stringify(conditions),now,now,user,user,user).first();
 if(!created)throw new BillingError(409,'All watch slots are in use. Remove a watch or mission, or add a NYRA watch pack.');
 return {id,scout:await scoutWorkspace(user)};
}
export async function changeScout(user:string,data:Row){
 if(!['pause','resume','remove'].includes(data.op))throw new BillingError(400,'Choose pause, resume or remove.');
 const db=database(),t=Date.now(),row=await db.prepare('SELECT * FROM nyra_scout_missions WHERE id=? AND user_id=? AND deleted_at IS NULL').bind(String(data.id),user).first<Row>();
 if(!row)throw new BillingError(404,'This mission was not found.');if(row.revision!==Number(data.revision))throw new BillingError(409,'This mission changed in another tab. Refresh and try again.');
 const writes=[db.prepare('UPDATE nyra_scout_missions SET paused=?,deleted_at=?,revision=revision+1,next_at=?,lease=NULL,lease_until=NULL WHERE id=? AND user_id=? AND revision=?').bind(data.op==='resume'?0:1,data.op==='remove'?t:null,t,row.id,user,row.revision)];
 if(data.op!=='resume')writes.push(db.prepare("UPDATE nyra_deliveries SET status='cancelled',lease=NULL,lease_until=NULL WHERE user_id=? AND kind='scout' AND status='pending' AND json_extract(payload,'$.missionId')=? AND EXISTS(SELECT 1 FROM nyra_scout_missions WHERE id=? AND user_id=? AND revision=? AND paused=1)").bind(user,row.id,row.id,user,Number(row.revision)+1));
 const changed=await db.batch(writes);if(!changed[0].meta.changes)throw new BillingError(409,'This mission changed. Refresh and try again.');return scoutWorkspace(user);
}
export async function scanScout(user:string,id:string,{deadline=Date.now()+85000,discovery,discover=discoverScout,evidence=scoutEvidence,scheduled=false}:any={}){
 const db=database(),m=await db.prepare('SELECT * FROM nyra_scout_missions WHERE id=? AND user_id=? AND deleted_at IS NULL').bind(id,user).first<Row>();
 if(!m)throw new BillingError(404,'This mission was not found.');if(m.paused)throw new BillingError(409,'Resume this mission before scanning.');
 const lease=crypto.randomUUID(),started=Date.now(),runId=crypto.randomUUID(),tx=await writeTransaction();
 try{
  if(!scheduled){const rate=await tx.execute({sql:'INSERT INTO nyra_rate_limits(key,bucket,count) VALUES(?,?,1) ON CONFLICT(key,bucket) DO UPDATE SET count=count+1 RETURNING count',args:['scout:'+user,Math.floor(started/60000)]});
  if(Number(rate.rows[0].count)>3)throw new BillingError(429,'Please wait a minute before scanning again.');}
  const claimed=await tx.execute({sql:'UPDATE nyra_scout_missions SET lease=?,lease_until=? WHERE id=? AND user_id=? AND revision=? AND paused=0 AND deleted_at IS NULL AND (lease_until IS NULL OR lease_until<?) RETURNING id',args:[lease,started+120000,id,user,m.revision,started]});
  if(!claimed.rows.length)throw new BillingError(409,'This mission is already scanning or changed. Refresh shortly.');
  await tx.execute({sql:'INSERT INTO nyra_scout_runs(id,mission_id,user_id,started_at) VALUES(?,?,?,?)',args:[runId,id,user,started]});await tx.commit();
 }catch(e){await tx.rollback();throw e;}finally{tx.close();}
 const stats:Row={checked:0,matched:0,rejected:0,unknown:0,queued:0,coverage:null};
 try{
  stats.coverage=discovery||await discover(deadline);
  const conditions=JSON.parse(m.conditions),builders=conditions.requireRepo||conditions.requireOfficial||conditions.recentDays!==null;
  // Builder evidence can arrive after discovery; new unindexed launches must not starve it.
  const candidates=await db.prepare('SELECT c.* FROM nyra_scout_candidates c LEFT JOIN nyra_scout_results r ON r.mission_id=? AND r.address=c.address WHERE c.last_seen>? ORDER BY '+(builders?'c.priority DESC,':'')+'CASE WHEN r.id IS NULL THEN 0 ELSE 1 END,'+(builders?'':'c.priority DESC,')+'COALESCE(r.checked_at,0),c.discovered_at DESC LIMIT 12').bind(id,Date.now()-30*86400000).all<Row>();
  for(let i=0;i<candidates.results.length;i+=3){if(Date.now()>deadline-2000)break;
   await Promise.all(candidates.results.slice(i,i+3).map(async c=>{
    if(Date.now()>deadline-1500)return;
    const candidate={address:c.address,name:c.name||c.symbol||c.address,symbol:c.symbol||'Unknown',discoveredAt:new Date(c.discovered_at).toISOString()};
    let ev:Row;try{ev=await evidence({...c,payload:JSON.parse(c.payload)},conditions,deadline);}catch{ev={error:'Source reads could not complete.'};}
    const report={...evaluateScout(candidate,conditions,ev),conditions,conditionsRevision:m.conditions_revision},at=Date.now(),rid=id+':'+c.address;
    const live=await db.prepare('SELECT id FROM nyra_scout_missions WHERE id=? AND user_id=? AND revision=? AND lease=? AND paused=0 AND deleted_at IS NULL').bind(id,user,m.revision,lease).first();if(!live)return;
    const previous=await db.prepare('SELECT payload,checked_at FROM nyra_scout_results WHERE id=? AND user_id=?').bind(rid,user).first<Row>();
    const writes=[db.prepare('INSERT INTO nyra_scout_results(id,mission_id,user_id,address,decision,payload,checked_at,conditions_revision) SELECT ?,?,?,?,?,?,?,? WHERE EXISTS(SELECT 1 FROM nyra_scout_missions WHERE id=? AND revision=? AND lease=? AND paused=0 AND deleted_at IS NULL) ON CONFLICT(mission_id,address) DO UPDATE SET decision=excluded.decision,payload=excluded.payload,checked_at=excluded.checked_at,conditions_revision=excluded.conditions_revision').bind(rid,id,user,c.address,report.decision,JSON.stringify(report),at,m.conditions_revision,id,m.revision,lease)];
    if(report.decision==='matched'){
     writes.push(db.prepare("INSERT INTO nyra_deliveries(id,user_id,kind,payload,next_at,created_at) SELECT ?,?,'scout',?,?,? WHERE EXISTS(SELECT 1 FROM nyra_scout_missions WHERE id=? AND revision=? AND lease=? AND paused=0 AND deleted_at IS NULL) AND EXISTS(SELECT 1 FROM nyra_scout_results WHERE id=? AND decision='matched' AND (notified_at IS NULL OR EXISTS(SELECT 1 FROM nyra_deliveries WHERE id='scout:' || nyra_scout_results.id AND status='cancelled' AND sent_at IS NULL))) AND EXISTS(SELECT 1 FROM nyra_profiles WHERE user_id=? AND telegram_chat_id IS NOT NULL) ON CONFLICT(id) DO UPDATE SET status='pending',payload=excluded.payload,next_at=excluded.next_at,lease=NULL,lease_until=NULL WHERE nyra_deliveries.status='cancelled' AND nyra_deliveries.sent_at IS NULL").bind('scout:'+rid,user,JSON.stringify({missionId:id,resultId:rid,title:m.title,report}),at,at,id,m.revision,lease,rid,user));
     writes.push(db.prepare('UPDATE nyra_scout_results SET notified_at=? WHERE id=? AND notified_at IS NULL AND EXISTS(SELECT 1 FROM nyra_deliveries WHERE id=?)').bind(at,rid,'scout:'+rid));
    }
    if(report.decision!=='matched')writes.push(db.prepare("UPDATE nyra_deliveries SET status='cancelled',lease=NULL,lease_until=NULL WHERE id=? AND status='pending' AND EXISTS(SELECT 1 FROM nyra_scout_results WHERE id=? AND decision!='matched')").bind('scout:'+rid,rid));
    const observation=(oid:string,payload:unknown,time:number,baseline=false)=>db.prepare('INSERT OR IGNORE INTO nyra_scout_observations(id,result_id,mission_id,user_id,checked_at,payload) SELECT ?,?,?,?,?,? WHERE EXISTS(SELECT 1 FROM nyra_scout_results r JOIN nyra_scout_missions m ON m.id=r.mission_id WHERE r.id=? AND r.checked_at=? AND m.revision=? AND m.lease=? AND m.paused=0 AND m.deleted_at IS NULL)'+(baseline?' AND NOT EXISTS(SELECT 1 FROM nyra_scout_observations WHERE result_id=?)':'')).bind(oid,rid,id,user,time,JSON.stringify(payload),rid,at,m.revision,lease,...(baseline?[rid]:[]));
    if(previous)writes.push(observation('baseline:'+rid,scoutSnapshot(JSON.parse(previous.payload),Number(previous.checked_at)),Number(previous.checked_at),true));
    writes.push(observation(runId+':'+c.address,scoutSnapshot(report,at),at));
    const saved=await db.batch(writes);if(!saved[0].meta.changes)return;stats.checked++;stats[report.decision]++;if(report.decision==='matched'&&saved[1]?.meta.changes)stats.queued++;
   }));
  }
  const at=Date.now();stats.deferred=candidates.results.length-stats.checked;stats.notice='Matches are search results, not safety guarantees. Provider warnings remain visible.';
  const live=await db.prepare('SELECT id FROM nyra_scout_missions WHERE id=? AND revision=? AND lease=? AND paused=0 AND deleted_at IS NULL').bind(id,m.revision,lease).first();
  await db.batch([db.prepare("UPDATE nyra_scout_runs SET status=?,finished_at=?,payload=? WHERE id=? AND user_id=?").bind(!live?'cancelled':stats.coverage.errors?.length?'partial':'complete',at,JSON.stringify(stats),runId,user),db.prepare('UPDATE nyra_scout_missions SET checks=checks+1,last_at=?,next_at=?,error=?,lease=NULL,lease_until=NULL WHERE id=? AND user_id=? AND revision=? AND lease=?').bind(at,nextCheckAt(at),stats.coverage.errors?.join(' ')||'',id,user,m.revision,lease)]);
  return {runId,...stats};
 }catch{
  await db.batch([db.prepare("UPDATE nyra_scout_runs SET status='failed',finished_at=?,payload=? WHERE id=?").bind(Date.now(),JSON.stringify({...stats,error:'Search sources could not complete. Saved results are preserved.'}),runId),db.prepare("UPDATE nyra_scout_missions SET error='Search sources could not complete. Saved results are preserved.',next_at=?,lease=NULL,lease_until=NULL WHERE id=? AND lease=?").bind(nextCheckAt(),id,lease)]);throw new BillingError(503,'Scout could not complete this scan. Saved results are preserved.');
 }
}
export async function runScoutChecks(deadline:number){
 const db=database();
 await db.prepare("UPDATE nyra_scout_runs SET status='interrupted',finished_at=?,payload=? WHERE status='running' AND started_at<?").bind(Date.now(),JSON.stringify({error:'The scan was interrupted. Saved results remain; the mission will retry.'}),Date.now()-125000).run();
 const due=await db.prepare('SELECT id,user_id FROM nyra_scout_missions WHERE deleted_at IS NULL AND paused=0 AND next_at<=? AND (lease_until IS NULL OR lease_until<?) ORDER BY COALESCE(last_at,0),created_at LIMIT 10').bind(Date.now(),Date.now()).all<Row>();
 if(!due.results.length||Date.now()>deadline-5000)return {scanned:0,deferred:due.results.length};
 const discovery=await discoverScout(deadline);let scanned=0,failed=0;
 for(const m of due.results){if(Date.now()>deadline-4000)break;try{await scanScout(m.user_id,m.id,{deadline,discovery,scheduled:true});scanned++;}catch{failed++;}}
 return {scanned,failed,deferred:due.results.length-scanned-failed};
}
