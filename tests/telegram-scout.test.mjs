import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,readdir,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createHash} from 'node:crypto';
import {SCOUT_OPEN_CONDITIONS} from '../lib/scout-planner.mjs';

test('Telegram Scout: draft/refine/confirm/edit, ownership, replay, conflicts and server persistence',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'nyra-tg-scout-'));
 Object.assign(process.env,{TURSO_DATABASE_URL:'file:'+join(dir,'test.db'),OPENAI_API_KEY:'test-only',NYRA_AI_PROVIDER:'openai',NYRA_AI_MODEL:'openai/gpt-6.2-sol',NYRA_TELEGRAM_BOT_TOKEN:'123:test-only',NYRA_TELEGRAM_BOT_USERNAME:'test_bot',NYRA_TELEGRAM_WEBHOOK_SECRET:'test-secret'});delete process.env.TURSO_AUTH_TOKEN;
 const {sqlClient}=await import('../lib/database.ts'),db=sqlClient();
 const {telegramWebhook,deliverTelegramReplies,workspaceHandler}=await import('../lib/workspace-service.ts');
 const {confirmScoutDraft}=await import('../lib/scout-drafts.ts');
 const {createScout,changeScout,scoutWorkspace}=await import('../lib/scout-service.ts');
 const {telegramScout}=await import('../lib/telegram-scout.ts');
 const original=global.fetch,originalNow=Date.now;let clock=originalNow(),ai=0,update=100,sent=[],failDelivery=false,onAI=async()=>{},inputs=[];
 Date.now=()=>clock;
 let proposal={title:'Public builders',conditions:{...SCOUT_OPEN_CONDITIONS,requireRepo:true,recentDays:7,minLiquidity:5000},questions:[],unsupported:[]};
 global.fetch=async(url,options)=>{
  if(url==='https://api.openai.com/v1/responses'){ai++;const body=JSON.parse(options.body);assert.equal(body.tools.length,1);assert.equal(body.tools[0].name,'prepare_scout_mission');assert.deepEqual(body.tool_choice,{type:'function',name:'prepare_scout_mission'});inputs.push(body.input);await onAI();return Response.json({status:'completed',model:'gpt-6.2-sol',output:[{type:'function_call',call_id:'draft',name:'prepare_scout_mission',arguments:JSON.stringify(proposal)}],usage:{input_tokens:100,output_tokens:100}});}
  if(String(url).startsWith('https://api.telegram.org/')){if(failDelivery)throw Error('delivery unavailable');sent.push(JSON.parse(options.body));return Response.json({ok:true,result:{message_id:sent.length}});}
  if(String(url).startsWith('https://ponsfamily.com/api/launches?')||String(url).startsWith('https://heyresearch.xyz/api/changes?'))return Response.json({items:[]});
  if(String(url).startsWith('https://corbel.finance/api/radar'))return Response.json({rows:[]});
  throw Error('Unexpected external request '+url);
 };
 const webhook=async(text,chat=123,id=++update)=>{clock+=6000;return telegramWebhook(new Request('https://nyra.test/api/telegram/webhook',{method:'POST',headers:{'content-type':'application/json','X-Telegram-Bot-Api-Secret-Token':'test-secret'},body:JSON.stringify({update_id:id,message:{chat:{id:chat,type:'private'},from:{id:chat,is_bot:false},text}})}));};
 const drafts=async()=>JSON.parse(JSON.stringify((await scoutWorkspace('one')).drafts));
 const confirmText=d=>'Start '+d.id.slice(0,8);
 try{
  for(const f of(await readdir('drizzle')).filter(x=>x.endsWith('.sql')).sort())await db.batch((await readFile('drizzle/'+f,'utf8')).split('--> statement-breakpoint').map(x=>x.trim()).filter(Boolean),'write');
  await db.batch(['one','two'].map((u,i)=>({sql:'INSERT INTO nyra_profiles(user_id,wallet,wallet_verified_at,telegram_chat_id,created_at) VALUES(?,?,?,?,?)',args:[u,'0x'+String(i+1).repeat(40),clock,String(i?456:123),clock]})),'write');
  await webhook('Find RH builders with public code, updates within 7 days, $5k liquidity');let d=(await drafts())[0];assert.equal(d.channel,'telegram');assert.equal(d.conditions.minLiquidity,5000);assert.equal((await scoutWorkspace('one')).missions.length,0);assert.match(sent.at(-1).text,/not running/);assert(sent.at(-1).reply_markup.keyboard.flat().some(x=>x.text===confirmText(d)));assert.equal(ai,1);
  const n=sent.length;await webhook('Find RH builders with public code',123,update);assert.equal(ai,1);assert.equal(sent.length,n,'webhook replay does not send twice');
  proposal.conditions.minLiquidity=10000;await webhook('Change the liquidity to $10k');const refined=(await drafts())[0];assert.equal(refined.conditions.minLiquidity,10000);assert.equal(refined.conditions.recentDays,7);assert(JSON.stringify(inputs.at(-1)).includes('5000'));assert.equal((await scoutWorkspace('one')).missions.length,0);
  await webhook(confirmText(d));assert.match(sent.at(-1).text,/another draft/);assert.equal((await scoutWorkspace('one')).missions.length,0);
  await webhook(confirmText(refined));let w=await scoutWorkspace('one');assert.equal(w.missions.length,1);const mission=w.missions[0];assert.equal(mission.conditions.minLiquidity,10000);assert.equal(w.runs.length,1,'confirmation starts the first scan');assert.equal(ai,2);await webhook(confirmText(refined),123,update);assert.equal((await scoutWorkspace('one')).runs.length,1);
  // A new message proposes an edit; it cannot modify the live mission first.
  proposal.conditions.minLiquidity=12000;await webhook('Change minimum liquidity to $12k');let edit=(await drafts())[0];assert.equal(edit.targetMissionId,mission.id);assert.equal((await scoutWorkspace('one')).missions[0].conditions.minLiquidity,10000);
  await db.execute({sql:'INSERT INTO nyra_scout_results(id,mission_id,user_id,address,decision,payload,checked_at) VALUES(?,?,?,?,?,?,?)',args:['old-result',mission.id,'one','0x'+'3'.repeat(40),'matched',JSON.stringify({candidate:{address:'0x'+'3'.repeat(40)},decision:'matched',checks:[],riskChecks:[],evidence:{}}),clock]});
  await db.execute({sql:"INSERT INTO nyra_deliveries(id,user_id,kind,payload,next_at,created_at) VALUES('old-delivery','one','scout',?,?,?)",args:[JSON.stringify({missionId:mission.id}),clock,clock]});
  // Website confirmation of the Telegram draft uses the same atomic edit path.
  const result=await confirmScoutDraft('one',{id:edit.id,revision:edit.revision,title:edit.title,conditions:edit.conditions});assert.equal(result.updated,true);assert.equal(result.created,false);assert.equal((await scoutWorkspace('one')).missions.length,1);assert.equal((await scoutWorkspace('one')).missions[0].conditions.minLiquidity,12000);
  assert.equal((await scoutWorkspace('one')).results[0].outdated,true);assert.equal((await scoutWorkspace('one')).results[0].decision,'unknown');assert.equal((await db.execute("SELECT status FROM nyra_deliveries WHERE id='old-delivery'")).rows[0].status,'cancelled');
  const repeat=await confirmScoutDraft('one',{id:edit.id,revision:edit.revision,title:edit.title,conditions:edit.conditions});assert.equal(repeat.applied,false);
  await assert.rejects(confirmScoutDraft('two',{id:edit.id,revision:1,title:edit.title,conditions:edit.conditions},{telegramChatId:'456'}),e=>e.status===404);
  await webhook('/missions');proposal.conditions.minLiquidity=15000;await webhook('Edit 1: raise liquidity to $15k');edit=(await drafts())[0];assert.equal(edit.targetMissionId,mission.id);assert.equal(edit.targetRevision,2);await webhook(confirmText(edit));w=await scoutWorkspace('one');assert.equal(w.missions[0].conditions.minLiquidity,15000);assert.equal(w.missions[0].conditionsRevision,3);assert.equal(w.missions.length,1);
  // Unsupported requests cannot be confirmed by typing a start control.
  await webhook('/new');proposal.unsupported=['24-hour volume above $50k'];await webhook('Find projects with $50k trading volume');d=(await drafts())[0];assert(!sent.at(-1).reply_markup.keyboard.flat().some(x=>x.text===confirmText(d)));await webhook(confirmText(d));assert.match(sent.at(-1).text,/Cannot check/);assert.equal((await scoutWorkspace('one')).missions.length,1);await webhook('Cancel '+d.id.slice(0,8));assert.equal((await drafts())[0].status,'cancelled');
  // An explicit target is required when several searches exist.
  await createScout('one',{title:'Another mission'});proposal.unsupported=[];await webhook('Change liquidity to $20k');assert.match(sent.at(-1).text,/Choose a mission/);const beforeAI=ai;assert.equal((await scoutWorkspace('one')).drafts.length,5);await webhook('Edit 1');assert.equal(ai,beforeAI+1,'pending change is applied only after selecting a mission');
  // Changes from another tab invalidate an in-progress mission edit.
  edit=(await drafts())[0];const target=(await scoutWorkspace('one')).missions.find(m=>m.id===edit.targetMissionId);await changeScout('one',{id:target.id,revision:target.revision,op:'pause'});await webhook(confirmText(edit));assert.match(sent.at(-1).text,/changed since/);
  // A reconnect is a real authorization boundary for queued private replies.
  await webhook('/new');failDelivery=true;await webhook('Find projects with public code');d=(await drafts())[0];const pending=update;assert.equal((await db.execute({sql:'SELECT status FROM nyra_telegram_updates WHERE id=?',args:[pending]})).rows[0].status,'pending');failDelivery=false;await db.execute("UPDATE nyra_profiles SET telegram_chat_id=NULL WHERE user_id='one'");clock+=3600000;const delivery=await deliverTelegramReplies(pending);assert.equal(delivery.sent,0);assert.equal((await db.execute({sql:'SELECT status FROM nyra_telegram_updates WHERE id=?',args:[pending]})).rows[0].status,'cancelled');
  await assert.rejects(confirmScoutDraft('one',{id:d.id,revision:d.revision,title:d.title,conditions:d.conditions},{telegramChatId:'123'}),e=>e.status===403);
  await webhook('Find more projects',123);assert.match(sent.at(-1).text,/Connect Telegram/);
  await db.execute({sql:"INSERT INTO nyra_telegram_updates(id,chat_id,user_id,status,lease_until,next_at,created_at) VALUES(900,'123','one','processing',0,?,?)",args:[clock,clock]});await db.execute("UPDATE nyra_profiles SET telegram_chat_id='123' WHERE user_id='two'");const beforeRebound=ai;await webhook('Find projects with public code',123,900);assert.equal(ai,beforeRebound);assert.equal((await db.execute('SELECT status FROM nyra_telegram_updates WHERE id=900')).rows[0].status,'cancelled');await db.execute("UPDATE nyra_profiles SET telegram_chat_id='456' WHERE user_id='two'");
  // Same update / paid research reservation may be recovered without a second AI call.
  await db.execute("UPDATE nyra_profiles SET telegram_chat_id='123' WHERE user_id='one'");await db.execute("UPDATE nyra_telegram_scout_context SET draft_id=NULL,mission_id=NULL,mission_revision=NULL,lease=NULL,lease_until=NULL WHERE user_id='one'");clock+=6000;const count=ai;await telegramScout('one','123','Find RH projects with public code',999);assert.equal(ai,count+1);clock+=200000;await telegramScout('one','123','Find RH projects with public code',999);assert.equal(ai,count+1,'a retried update reuses the saved model run');
  // A normal signed-in website session restores all Telegram-created drafts/missions.
  const session='a'.repeat(64);await db.execute({sql:'INSERT INTO nyra_sessions(token_hash,user_id,created_at,expires_at) VALUES(?,?,?,?)',args:[createHash('sha256').update(session).digest('hex'),'one',clock,clock+100000]});const reload=await workspaceHandler(new Request('https://nyra.test/api/workspace',{headers:{cookie:'__Host-nyra-session='+session}}));assert.equal(reload.status,200);const saved=await reload.json();assert(saved.scout.drafts.some(x=>x.channel==='telegram'));assert.equal(saved.scout.missions.length,2);
  // Editing an existing mission needs no extra slot, even at full capacity.
  for(let i=0;i<3;i++)await createScout('one',{title:'Full slot '+i});update=1000;await webhook('/missions');await webhook('Edit 1: use $25k minimum liquidity');edit=(await drafts())[0];const full=await confirmScoutDraft('one',{id:edit.id,revision:edit.revision,title:edit.title,conditions:edit.conditions});assert.equal(full.updated,true);assert.equal((await scoutWorkspace('one')).missions.length,5);
  // A second message cannot overwrite context while the first model call is active.
  await webhook('/new');let entered,release;const ready=new Promise(r=>entered=r),gate=new Promise(r=>release=r);onAI=async()=>{entered();await gate;};clock+=6000;const inFlight=telegramScout('one','123','Find RH projects with public code',2000);await ready;await assert.rejects(telegramScout('one','123','Change liquidity to $2k',2001),e=>e.status===503);release();await inFlight;onAI=async()=>{};
 }finally{global.fetch=original;Date.now=originalNow;db.close();await rm(dir,{recursive:true,force:true});}
});
