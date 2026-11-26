import test from 'node:test';import assert from 'node:assert/strict';
import {mkdtemp,readFile,readdir,rm} from 'node:fs/promises';import {tmpdir} from 'node:os';import {join} from 'node:path';import {createHash} from 'node:crypto';
import {makeScoutBrief,nextScoutBriefAt,DAY,scoutBriefTelegram} from '../lib/scout-brief-core.mjs';
import {scoutSnapshot} from '../lib/scout-history-core.mjs';
const address='0x'+'1'.repeat(40);
const report=(at,liquidity=7500,decision='matched')=>({candidate:{address,name:'Test builder',symbol:'TEST'},decision,conditions:{minLiquidity:5000},checks:[{label:'Liquidity',state:decision==='matched'?'pass':'unknown',detail:'Measured liquidity'}],riskChecks:[{id:'lp',name:'Liquidity lock',result:'unknown',reason:'Not confirmed',source:{at}}],evidence:{corbel:{source:'https://corbel.finance/api/token?q='+address,data:{token:address,example:false,market:{liquidity},checks:[{id:'honeypot',value:{loss:.05},source:{at,partial:false}}]}}}});
test('Scout brief separates new matches, source changes, evidence gaps and UTC schedule',()=>{
 const at=Date.UTC(2026,10,26,8),from=at-DAY,previous=scoutSnapshot(report(from-1000,9000),from-1000);
 const row={id:'r',mission_id:'m',title:'My search',payload:JSON.stringify(report(at)),checked_at:at,baseline:JSON.stringify(previous),conditions_revision:1,current_revision:1,first_match_at:from-1000,notified_at:null};
 const b=makeScoutBrief([row],from,at);assert.equal(b.matches.length,0);assert.equal(b.changes.length,1);assert.match(b.changes[0].changes[0].summary,/9,000.*7,500/);assert.equal(b.gaps.length,0);
 const first=makeScoutBrief([{...row,first_match_at:at}],from,at);assert.equal(first.matches.length,1);assert.equal(first.matches[0].warnings[0].state,'unknown');assert.match(scoutBriefTelegram(first),/Liquidity lock: unknown/);
 const gap=makeScoutBrief([{...row,payload:JSON.stringify({...report(at,0,'unknown'),evidence:{}})}],from,at);assert.equal(gap.gaps.length,1);assert.match(gap.changes[0].changes[0].summary,/could not recheck/);assert(!gap.changes[0].changes[0].summary.endsWith('$0'));
 assert.equal(makeScoutBrief([{...row,current_revision:2,first_match_at:at}],from,at).matches.length,0);
 assert.equal(nextScoutBriefAt(at,9),at+3600000);assert.equal(nextScoutBriefAt(at,8),at+DAY);assert.equal(nextScoutBriefAt(at,4),at+20*3600000);
});
test('daily Scout recap is opt-in, scoped, idempotent, retryable and revocable',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'nyra-scout-brief-'));Object.assign(process.env,{TURSO_DATABASE_URL:'file:'+join(dir,'test.db'),NYRA_TELEGRAM_BOT_TOKEN:'123:test-only',NYRA_TELEGRAM_BOT_USERNAME:'test_bot',NYRA_TELEGRAM_WEBHOOK_SECRET:'test-secret'});delete process.env.TURSO_AUTH_TOKEN;
 const {sqlClient}=await import('../lib/database.ts'),db=sqlClient();const {buildScoutBrief,configureScoutBrief,scoutBriefAccount,queueScoutBriefs}=await import('../lib/scout-brief.ts');const {workspaceHandler,deliver,telegramWebhook}=await import('../lib/workspace-service.ts');const originalFetch=global.fetch,originalNow=Date.now;let clock=Date.UTC(2026,10,26,8),sent=[],fail=false;Date.now=()=>clock;
 global.fetch=async(url,o)=>{assert.match(String(url),/^https:\/\/api.telegram.org\//);if(fail)throw Error('Offline');sent.push(JSON.parse(o.body));return Response.json({ok:true});};
 try{
  for(const f of(await readdir('drizzle')).filter(x=>x.endsWith('.sql')).sort())await db.batch((await readFile('drizzle/'+f,'utf8')).split('--> statement-breakpoint').map(x=>x.trim()).filter(Boolean),'write');
  await db.batch(['one','two'].map((user,i)=>({sql:'INSERT INTO nyra_profiles(user_id,wallet,wallet_verified_at,telegram_chat_id,created_at) VALUES(?,?,?,?,?)',args:[user,'0x'+String(i+2).repeat(40),clock,i?null:'123',clock]})),'write');
  const session='a'.repeat(64);await db.execute({sql:'INSERT INTO nyra_sessions(token_hash,user_id,created_at,expires_at) VALUES(?,?,?,?)',args:[createHash('sha256').update(session).digest('hex'),'one',clock,clock+5*DAY]});
  const api=(path,data,origin='https://nyra.test',auth=true)=>workspaceHandler(new Request('https://nyra.test'+path,{method:data===undefined?'GET':'POST',headers:{origin,...(auth?{cookie:'__Host-nyra-session='+session}:{})},body:data===undefined?undefined:JSON.stringify(data)}));
  assert.equal((await api('/api/scout/brief',undefined,undefined,false)).status,401);assert.equal((await api('/api/scout/brief/build',{},'https://evil.test')).status,403);assert.equal((await scoutBriefAccount('one')).settings.enabled,false);assert.equal((await queueScoutBriefs()).queued,0);
  await assert.rejects(configureScoutBrief('two',{enabled:true,hourUTC:9,revision:0}),e=>e.status===409);await assert.rejects(configureScoutBrief('one',{enabled:true,hourUTC:24,revision:0}),e=>e.status===400);
  await db.execute({sql:"INSERT INTO nyra_scout_missions(id,user_id,title,conditions,created_at,next_at) VALUES('m','one','My saved search','{}',?,?)",args:[clock-DAY,clock]});
  const old=scoutSnapshot(report(clock-DAY-1000,9000),clock-DAY-1000),current=report(clock-1000);
  await db.execute({sql:"INSERT INTO nyra_scout_results(id,mission_id,user_id,address,decision,payload,checked_at) VALUES('r','m','one',?,'matched',?,?)",args:[address,JSON.stringify(current),clock-1000]});
  await db.batch([{sql:"INSERT INTO nyra_scout_observations(id,result_id,mission_id,user_id,checked_at,payload) VALUES('old','r','m','one',?,?)",args:[old.checkedAt,JSON.stringify(old)]},{sql:"INSERT INTO nyra_scout_observations(id,result_id,mission_id,user_id,checked_at,payload) VALUES('new','r','m','one',?,?)",args:[clock-1000,JSON.stringify(scoutSnapshot(current,clock-1000))]}],'write');
  const b=await buildScoutBrief('one');assert.equal(b.changes.length,1);assert.equal((await buildScoutBrief('two')).checkedResults,0);assert.equal((await buildScoutBrief('one')).id,b.id,'one-minute build cache');assert.equal((await db.execute('SELECT COUNT(*) n FROM nyra_agent_runs')).rows[0].n,0);
  const enabled=await configureScoutBrief('one',{enabled:true,hourUTC:9,revision:0});assert.equal(enabled.settings.nextAt,clock+3600000);assert.equal((await queueScoutBriefs()).queued,0);
  await assert.rejects(configureScoutBrief('one',{enabled:true,hourUTC:10,revision:0}),e=>e.status===409);
  clock+=3600000;const queued=await Promise.all([queueScoutBriefs(),queueScoutBriefs()]);assert.equal(queued.reduce((n,x)=>n+x.queued,0),1);assert.equal((await db.execute("SELECT COUNT(*) n FROM nyra_deliveries WHERE kind='scout_brief'")).rows[0].n,1);
  fail=true;assert.equal((await deliver()).failed,1);fail=false;clock+=120000;assert.equal((await deliver()).sent,1);assert.match(sent.at(-1).text,/Scout brief/);assert.equal(sent.at(-1).chat_id,'123');assert.equal((await deliver()).sent,0);
  clock+=DAY;assert.equal((await queueScoutBriefs()).queued,1);await configureScoutBrief('one',{enabled:false,hourUTC:9,revision:1});assert.equal((await deliver()).sent,0);assert.equal((await queueScoutBriefs()).queued,0);
  const reload=await(await api('/api/workspace')).json();assert.equal(reload.scoutBrief.settings.enabled,false);assert(reload.scoutBrief.latest);assert.equal((await scoutBriefAccount('two')).settings.enabled,false);
  const count=sent.length;await telegramWebhook(new Request('https://nyra.test/api/telegram/webhook',{method:'POST',headers:{'content-type':'application/json','X-Telegram-Bot-Api-Secret-Token':'test-secret'},body:JSON.stringify({update_id:100,message:{chat:{id:123,type:'private'},from:{id:123,is_bot:false},text:'/scoutbrief'}})}));assert.equal(sent.length,count+1);assert.match(sent.at(-1).text,/Scout brief/);assert.equal((await db.execute('SELECT COUNT(*) n FROM nyra_agent_runs')).rows[0].n,0);
 }finally{global.fetch=originalFetch;Date.now=originalNow;db.close();await rm(dir,{recursive:true,force:true});}
});
