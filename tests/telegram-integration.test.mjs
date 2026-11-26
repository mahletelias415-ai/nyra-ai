import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,readdir,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createHash} from 'node:crypto';

test('private Telegram linking, account isolation, retry and disconnect',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'nyra-test-'));
 process.env.TURSO_DATABASE_URL='file:'+join(dir,'test.db');delete process.env.TURSO_AUTH_TOKEN;
 process.env.NYRA_TELEGRAM_BOT_TOKEN='123:test-only';process.env.NYRA_TELEGRAM_BOT_USERNAME='test_bot';process.env.NYRA_TELEGRAM_WEBHOOK_SECRET='test-secret';
 const {sqlClient}=await import('../lib/database.ts');const db=sqlClient();
 const {telegramWebhook,deliverTelegramReplies,workspaceHandler}=await import('../lib/workspace-service.ts');
 const {checkPublicWatch,publicVerification}=await import('../lib/verification.ts');
 const originalFetch=global.fetch,originalNow=Date.now;let fail=false,sent=[],n=1;
 global.fetch=async(url,options)=>{assert.match(String(url),/^https:\/\/api.telegram.org\/bot123:test-only\/sendMessage$/);if(fail)throw Error('temporary');sent.push(JSON.parse(options.body));return Response.json({ok:true,result:{message_id:n++}});};
 const webhook=(id,text,chat=123,secret='test-secret',type='private')=>telegramWebhook(new Request('https://nyra.test/api/telegram/webhook',{method:'POST',headers:{'Content-Type':'application/json','X-Telegram-Bot-Api-Secret-Token':secret},body:JSON.stringify({update_id:id,message:{chat:{id:chat,type},from:{id:chat,is_bot:false},text}})}));
 try{
  for(const file of(await readdir('drizzle')).filter(x=>x.endsWith('.sql')).sort())await db.batch((await readFile('drizzle/'+file,'utf8')).split('--> statement-breakpoint').map(x=>x.trim()).filter(Boolean),'write');
  const t=Date.now(),token='a'.repeat(32),wallet='0x'+'1'.repeat(40);
  await db.batch([{sql:'INSERT INTO nyra_profiles(user_id,wallet,wallet_verified_at,created_at) VALUES(?,?,?,?)',args:['one',wallet,t,t]},{sql:'INSERT INTO nyra_profiles(user_id,wallet,wallet_verified_at,created_at) VALUES(?,?,?,?)',args:['two','0x'+'2'.repeat(40),t,t]},{sql:'INSERT INTO nyra_challenges(id,user_id,kind,message,expires_at,created_at) VALUES(?,?,?,?,?,?)',args:[token,'one','telegram','test',t+100000,t]}],'write');
  await assert.rejects(webhook(1,'/start',123,'bad'),e=>e.status===403);
  await webhook(2,'/start',123,'test-secret','group');assert.equal(sent.length,0);
  await webhook(3,'/start');assert.match(sent.at(-1).text,/Connect Telegram/);assert(!sent.at(-1).text.includes(wallet));
  await webhook(4,'/start '+token);assert.match(sent.at(-1).text,/Telegram connected/);
  const count=sent.length;await webhook(4,'/start '+token);assert.equal(sent.length,count);
  await webhook(5,'/start '+token,456);assert.match(sent.at(-1).text,/expired or was already used/);
  await webhook(6,'/status');assert.match(sent.at(-1).text,/0x1111…1111/);assert(!sent.at(-1).text.includes(wallet));
  const watch=(id,user,symbol)=>({sql:'INSERT INTO nyra_watches(id,user_id,fingerprint,plan,previous,last_at,next_at,created_at) VALUES(?,?,?,?,?,?,?,?)',args:[id,user,id,JSON.stringify({order:'Watch '+symbol+' price',title:symbol}),'{}',t,t,t]});
  await db.batch([watch('w1','one','NVDA'),watch('w2','two','AAPL')],'write');
  await webhook(7,'/watches');assert.match(sent.at(-1).text,/NVDA/);assert(!sent.at(-1).text.includes('AAPL'));
  await webhook(8,'/brief');assert.match(sent.at(-1).text,/Daily brief/);
  fail=true;await webhook(9,'/status');assert.equal((await db.execute('SELECT status FROM nyra_telegram_updates WHERE id=9')).rows[0].status,'pending');
  fail=false;await db.execute('UPDATE nyra_telegram_updates SET next_at=0 WHERE id=9');const retry=await deliverTelegramReplies(9);assert.equal(retry.sent,1);
  await db.execute({sql:"INSERT INTO nyra_deliveries(id,user_id,kind,payload,next_at,created_at) VALUES('d','one','alert','{}',?,?)",args:[t,t]});
  await db.execute({sql:"INSERT INTO nyra_telegram_updates(id,chat_id,status,reply,next_at,created_at) VALUES(10,'123','pending','private stale reply',?,?)",args:[t,t]});
  await webhook(11,'/stop');assert.equal((await db.execute("SELECT telegram_chat_id FROM nyra_profiles WHERE user_id='one'")).rows[0].telegram_chat_id,null);
  assert.equal((await db.execute("SELECT status FROM nyra_deliveries WHERE id='d'")).rows[0].status,'cancelled');assert.equal((await db.execute('SELECT status FROM nyra_telegram_updates WHERE id=10')).rows[0].status,'cancelled');
  assert.equal((await db.execute("SELECT COUNT(*) AS n FROM nyra_watches WHERE user_id='one'")).rows[0].n,1);
  // Full authenticated link endpoint invalidates older one-use tokens.
  const session='b'.repeat(64),hash=createHash('sha256').update(session).digest('hex');await db.execute({sql:'INSERT INTO nyra_sessions(token_hash,user_id,created_at,expires_at) VALUES(?,?,?,?)',args:[hash,'one',t,t+100000]});
  const link=()=>workspaceHandler(new Request('https://nyra.test/api/telegram/link',{method:'POST',headers:{origin:'https://nyra.test',cookie:'__Host-nyra-session='+session},body:'{}'}));
  const first=await(await link()).json(),second=await(await link()).json();assert.notEqual(first.url,second.url);
  await webhook(12,'/start '+new URL(first.url).searchParams.get('start'),456);assert.match(sent.at(-1).text,/expired or was already used/);
  await webhook(13,'/start '+new URL(second.url).searchParams.get('start'),456);assert.match(sent.at(-1).text,/Telegram connected/);
  // Public control watch retains actual snapshots, never private account rows.
  let clock=t;Date.now=()=>clock;const snapshot=(address)=>({tool:'rh_pons_launches',readAt:new Date(clock).toISOString(),data:{items:[{address,symbol:'PUBLIC'}],source:'https://ponsfamily.com/api/launches?sort=newest&limit=12'}});
  assert.equal((await checkPublicWatch(async()=>snapshot('0xaaa'))).kind,'baseline');
  assert.equal((await checkPublicWatch(async()=>{throw Error('should not reread');})).alreadyChecked,true);
  clock+=3600000;assert.equal((await checkPublicWatch(async()=>snapshot('0xbbb'))).kind,'alert');
  clock+=3600000;assert.equal((await checkPublicWatch(async()=>{throw Error('source down');})).kind,'error');
  const proof=await publicVerification();assert.equal(proof.control.checks.length,3);assert.equal(proof.control.checks[1].previous.data.items[0].address,'0xaaa');assert(!JSON.stringify(proof).includes(wallet));assert(!JSON.stringify(proof).includes('NVDA'));
 }finally{global.fetch=originalFetch;Date.now=originalNow;db.close();await rm(dir,{recursive:true,force:true});}
});
