import { getVercelOidcToken } from '@vercel/oidc';
import { database as runtimeDatabase } from './database.js';
import { runAgent, DEFAULT_MODEL } from './agent-core.mjs';
import { canonicalPlan } from './watch-core.mjs';
import {reserveResearch,recoverResearch} from './billing.js';
import {prepareScoutDraft,scoutDraftContext} from './scout-drafts.js';
import {BillingError} from './payment-core.mjs';
const database=runtimeDatabase;
const settings=()=>({provider:process.env.NYRA_AI_PROVIDER||'gateway',model:process.env.NYRA_AI_MODEL||(process.env.NYRA_AI_PROVIDER==='openai'?'openai/gpt-6.2-sol':DEFAULT_MODEL)});
const credential=async()=>settings().provider==='openai'?(process.env.OPENAI_API_KEY||''):(process.env.AI_GATEWAY_API_KEY||await getVercelOidcToken());
export async function agentConfiguration(){let configured=false;try{configured=!!await credential();}catch{}return{configured,model:settings().model,provider:settings().provider};}
export const agentView = (r:Record<string,any>) => ({id:r.id,prompt:r.prompt,model:r.model,status:r.status,answer:r.answer,error:r.error,steps:JSON.parse(r.steps),sources:JSON.parse(r.sources).length?JSON.parse(r.sources):JSON.parse(r.steps).filter((s:any)=>s.result&&s.tool!=='prepare_scout_mission').map((s:any,i:number)=>({index:i+1,tool:s.result.tool,url:s.result.data.source,readAt:s.result.readAt})),usage:JSON.parse(r.usage),billing:r.billing_type||'free',creditRefunded:!!r.credit_refunded,createdAt:r.created_at,finishedAt:r.finished_at});
export async function agentHistory(user:string) { await recoverResearch(user); const r=await database().prepare('SELECT * FROM nyra_agent_runs WHERE user_id=? ORDER BY created_at DESC LIMIT 15').bind(user).all();return r.results.map(agentView); }

export async function askAgent(user:string,data:Record<string,any>,options:{requestKey?:string;scoutOnly?:boolean;targetMissionId?:string;targetRevision?:number;telegramChatId?:string}={}) {
  if (!(await agentConfiguration()).configured) return Response.json({error:'Nyra’s AI connection is not configured yet.'},{status:503});
  if (typeof data.prompt !== 'string' || !data.prompt.trim() || data.prompt.length>1600) return Response.json({error:'Ask a question of up to 1,600 characters.'},{status:400});
  const db=database(),model=(await agentConfiguration()).model,provider=settings().provider;
  if(data.scoutDraftId&&!options.targetMissionId){const prior=await db.prepare('SELECT target_mission_id,target_revision FROM nyra_scout_drafts WHERE id=? AND user_id=?').bind(String(data.scoutDraftId),user).first();if(prior?.target_mission_id)options={...options,targetMissionId:String(prior.target_mission_id),targetRevision:Number(prior.target_revision)};}
  let context;try{context=await scoutDraftContext(user,data.scoutDraftId);if(options.targetMissionId&&!context){const m=await db.prepare('SELECT title,conditions,revision FROM nyra_scout_missions WHERE id=? AND user_id=? AND deleted_at IS NULL').bind(options.targetMissionId,user).first();if(!m||Number(m.revision)!==options.targetRevision)throw new BillingError(409,'This mission changed. Choose it again before editing.');context={previousDraft:{title:m.title,conditions:JSON.parse(String(m.conditions)),questions:[],unsupported:[]}};}}catch(e){return Response.json({error:e instanceof BillingError?e.message:'Could not read this draft.'},{status:e instanceof BillingError?e.status:400});}
  let id:string;
  try { const reserved=await reserveResearch(user,data.prompt.trim(),model,options.requestKey);id=reserved.id;if(reserved.reused){const old=await db.prepare('SELECT * FROM nyra_agent_runs WHERE id=? AND user_id=?').bind(id,user).first();return Response.json({run:agentView(old!)},{status:old?.status==='running'?409:200});} }
  catch(e){return Response.json({error:e instanceof BillingError?e.message:'Could not reserve this request. No credit was charged.'},{status:e instanceof BillingError?e.status:503});}
  const steps:unknown[]=[];
  const orderFor=(step:any)=>({rh_network:'Read RH network gas',rh_stock:'Read '+step.args.symbol+' price',rh_wallet:'Read wallet '+step.args.address,rh_pons_token:'Read Pons token '+step.args.address,rh_pons_launches:'Read new Pons launches',rh_transaction:'Read transaction '+step.args.hash,rh_contract:'Check contract '+step.args.address}[step.tool as string]);
  try {
    const result=await runAgent({prompt:data.prompt,apiKey:await credential(),model,provider,context,scoutOnly:options.scoutOnly,prepareScout:async(args:any)=>prepareScoutDraft(user,id,data.prompt.trim(),args,options),onStep:async(step:any)=>{steps.push(step);const writes=[db.prepare("UPDATE nyra_agent_runs SET steps=? WHERE id=? AND user_id=? AND status='running'").bind(JSON.stringify(steps),id,user)];if(step.result&&step.tool!=='prepare_scout_mission'){const plan=canonicalPlan({order:orderFor(step),args:step.args},{requireWatch:false});writes.push(db.prepare("INSERT INTO nyra_readings (id,user_id,plan,result,kind,created_at) SELECT ?,?,?,?,?,? WHERE EXISTS(SELECT 1 FROM nyra_agent_runs WHERE id=? AND user_id=? AND status='running')").bind(crypto.randomUUID(),user,JSON.stringify(plan),JSON.stringify(step.result),'reading',Date.parse(step.result.readAt),id,user));}await db.batch(writes);}});
    await db.prepare("UPDATE nyra_agent_runs SET status='complete',answer=?,sources=?,usage=?,finished_at=? WHERE id=? AND user_id=? AND status='running'").bind(result.answer,JSON.stringify(result.sources),JSON.stringify(result.usage),Date.now(),id,user).run();
  } catch(e) {
    await db.prepare("UPDATE nyra_agent_runs SET status='failed',error=?,finished_at=? WHERE id=? AND user_id=? AND status='running'").bind(e instanceof Error?e.message:'The AI request failed. Completed reads are preserved.',Date.now(),id,user).run();
  }
  await recoverResearch(user);
  const row=await db.prepare('SELECT * FROM nyra_agent_runs WHERE id=? AND user_id=?').bind(id,user).first();return Response.json({run:agentView(row!)},{headers:{'Cache-Control':'no-store'}});
}
