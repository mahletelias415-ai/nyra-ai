import { getVercelOidcToken } from '@vercel/oidc';
import { database as runtimeDatabase } from './database.js';
import { runAgent, DEFAULT_MODEL } from './agent-core.mjs';
import { canonicalPlan } from './watch-core.mjs';
const database=runtimeDatabase;
const settings=()=>({NYRA_AI_MODEL:process.env.NYRA_AI_MODEL});
const credential=async()=>process.env.AI_GATEWAY_API_KEY||await getVercelOidcToken();
export async function agentConfiguration(){let configured=false;try{configured=!!await credential();}catch{}return{configured,model:settings().NYRA_AI_MODEL||DEFAULT_MODEL};}
export const agentView = (r:Record<string,any>) => ({id:r.id,prompt:r.prompt,model:r.model,status:r.status,answer:r.answer,error:r.error,steps:JSON.parse(r.steps),sources:JSON.parse(r.sources).length?JSON.parse(r.sources):JSON.parse(r.steps).filter((s:any)=>s.result).map((s:any,i:number)=>({index:i+1,tool:s.result.tool,url:s.result.data.source,readAt:s.result.readAt})),usage:JSON.parse(r.usage),createdAt:r.created_at,finishedAt:r.finished_at});
export async function agentHistory(user:string) { await database().prepare("UPDATE nyra_agent_runs SET status='interrupted',error='The request was interrupted. Completed reads are preserved. Retry explicitly.',finished_at=? WHERE user_id=? AND status='running' AND created_at<?").bind(Date.now(),user,Date.now()-150000).run(); const r=await database().prepare('SELECT * FROM nyra_agent_runs WHERE user_id=? ORDER BY created_at DESC LIMIT 15').bind(user).all();return r.results.map(agentView); }
export async function askAgent(user:string,data:Record<string,any>) {
  if (!(await agentConfiguration()).configured) return Response.json({error:'Nyra’s AI connection is not configured yet.'},{status:503});
  if (typeof data.prompt !== 'string' || !data.prompt.trim() || data.prompt.length>1600) return Response.json({error:'Ask a question of up to 1,600 characters.'},{status:400});
  const db=database(),t=Date.now(),id=crypto.randomUUID(),model=(await agentConfiguration()).model;
  const dayStart=Math.floor(t/86400000)*86400000;
  const usage=await db.prepare('SELECT COUNT(*) AS total,SUM(CASE WHEN user_id=? THEN 1 ELSE 0 END) AS mine FROM nyra_agent_runs WHERE created_at>=?').bind(user,dayStart).first();
  if(Number(usage?.mine)>=30||Number(usage?.total)>=200)return Response.json({error:'Today’s AI research allowance has been reached. It resets at 00:00 UTC; your saved workspace and live tools remain available.'},{status:429});
  // Recover interrupted requests without silently retrying or charging again.
  await db.prepare("UPDATE nyra_agent_runs SET status='interrupted',error='The request was interrupted. Completed reads are preserved. Retry explicitly.',finished_at=? WHERE user_id=? AND status='running' AND created_at<?").bind(t,user,t-150000).run();
  const claimed=await db.prepare("INSERT INTO nyra_agent_runs (id,user_id,prompt,model,created_at) SELECT ?,?,?,?,? WHERE NOT EXISTS(SELECT 1 FROM nyra_agent_runs WHERE user_id=? AND (status='running' OR created_at>?)) AND (SELECT COUNT(*) FROM nyra_agent_runs WHERE user_id=? AND created_at>=?)<30 AND (SELECT COUNT(*) FROM nyra_agent_runs WHERE created_at>=?)<200 RETURNING id").bind(id,user,data.prompt.trim(),model,t,user,t-5000,user,dayStart,dayStart).first();
  if(!claimed) return Response.json({error:'Let the current request finish before asking again.'},{status:429});
  const steps:unknown[]=[];
  const orderFor=(step:any)=>({rh_network:'Read RH network gas',rh_stock:'Read '+step.args.symbol+' price',rh_wallet:'Read wallet '+step.args.address,rh_pons_token:'Read Pons token '+step.args.address,rh_pons_launches:'Read new Pons launches',rh_transaction:'Read transaction '+step.args.hash,rh_contract:'Check contract '+step.args.address}[step.tool as string]);
  try {
    const result=await runAgent({prompt:data.prompt,apiKey:await credential(),model,onStep:async(step:any)=>{steps.push(step);const writes=[db.prepare("UPDATE nyra_agent_runs SET steps=? WHERE id=? AND user_id=? AND status='running'").bind(JSON.stringify(steps),id,user)];if(step.result){const plan=canonicalPlan({order:orderFor(step),args:step.args},{requireWatch:false});writes.push(db.prepare("INSERT INTO nyra_readings (id,user_id,plan,result,kind,created_at) SELECT ?,?,?,?,?,? WHERE EXISTS(SELECT 1 FROM nyra_agent_runs WHERE id=? AND user_id=? AND status='running')").bind(crypto.randomUUID(),user,JSON.stringify(plan),JSON.stringify(step.result),'reading',Date.parse(step.result.readAt),id,user));}await db.batch(writes);}});
    await db.prepare("UPDATE nyra_agent_runs SET status='complete',answer=?,sources=?,usage=?,finished_at=? WHERE id=? AND user_id=? AND status='running'").bind(result.answer,JSON.stringify(result.sources),JSON.stringify(result.usage),Date.now(),id,user).run();
  } catch(e) {
    await db.prepare("UPDATE nyra_agent_runs SET status='failed',error=?,finished_at=? WHERE id=? AND user_id=? AND status='running'").bind(e instanceof Error?e.message:'The AI request failed. Completed reads are preserved.',Date.now(),id,user).run();
  }
  const row=await db.prepare('SELECT * FROM nyra_agent_runs WHERE id=? AND user_id=?').bind(id,user).first();return Response.json({run:agentView(row!)},{headers:{'Cache-Control':'no-store'}});
}
