import { database } from './database.js';
import { runTool } from './tools.mjs';
import { canonicalPlan, compareReading, CHECK_INTERVAL } from './watch-core.mjs';

// This control watch contains public launch metadata only. Never publish account watches.
const plan = canonicalPlan({order:'Watch new Pons launches'});
export async function checkPublicWatch(read = runTool) {
 const db=database(),at=Date.now(),id=String(Math.floor(at/CHECK_INTERVAL));
 const existing=await db.prepare('SELECT kind FROM nyra_public_checks WHERE id=?').bind(id).first();
 if(existing)return {kind:existing.kind,alreadyChecked:true};
 try {
  const old=await db.prepare("SELECT current FROM nyra_public_checks WHERE current IS NOT NULL ORDER BY checked_at DESC LIMIT 1").first();
  const previous=old?JSON.parse(String(old.current)):null,current=await read(plan.tool,plan.args);
  const comparison=compareReading(plan,previous,current),kind=previous?(comparison.alert?'alert':'reading'):'baseline';
  await db.prepare('INSERT OR IGNORE INTO nyra_public_checks(id,checked_at,kind,message,previous,current) VALUES(?,?,?,?,?,?)').bind(id,at,kind,comparison.summary,previous?JSON.stringify(previous):null,JSON.stringify(current)).run();
  return {kind,checkedAt:at};
 }catch{
  await db.prepare("INSERT OR IGNORE INTO nyra_public_checks(id,checked_at,kind,message,error) VALUES(?,?,'error','Source read failed; previous baseline retained.','Pons source unavailable.')").bind(id,at).run();
  return {kind:'error',checkedAt:at};
 }
}
export async function publicVerification(){
 const db=database();
 const [state,checks]=await Promise.all([
  db.prepare("SELECT last_started_at,last_finished_at FROM nyra_runner_state WHERE id='main'").first(),
  db.prepare('SELECT * FROM nyra_public_checks ORDER BY checked_at DESC LIMIT 24').all(),
 ]);
 const last=Number(state?.last_finished_at||0);
 return {name:'Nyra background verification',generatedAt:new Date().toISOString(),intervalSeconds:CHECK_INTERVAL/1000,
  runner:{lastStartedAt:state?.last_started_at?new Date(Number(state.last_started_at)).toISOString():null,lastFinishedAt:last?new Date(last).toISOString():null,healthy:!!last&&Date.now()-last<CHECK_INTERVAL*2},
  control:{title:'New Pons launches',trigger:plan.trigger,scope:'Public control watch. Account watches and Telegram chats are private.',invocation:'Authenticated server tick; not a page timer.',coverage:'Latest 12 indexed launches. Not a complete chain index.',checks:checks.results.map((r:any)=>({id:r.id,at:new Date(r.checked_at).toISOString(),kind:r.kind,message:r.message,error:r.error||null,previous:r.previous?JSON.parse(r.previous):null,current:r.current?JSON.parse(r.current):null}))}};
}
