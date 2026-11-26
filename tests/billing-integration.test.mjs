import test from'node:test';import assert from'node:assert/strict';import{mkdtemp,readFile,readdir,rm}from'node:fs/promises';import{tmpdir}from'node:os';import{join}from'node:path';import{createHash}from'node:crypto';
import{NYRA_TOKEN,PACKS,ZERO,verifyBurn}from'../lib/payment-core.mjs';
const topic='0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef',hash='0x'+'a'.repeat(64),blockHash='0x'+'b'.repeat(64),wallet='0x'+'1'.repeat(40),other='0x'+'2'.repeat(40);
const addr=a=>'0x'+a.slice(2).padStart(64,'0');
function fakeChain(raw=PACKS[0].rawAmount){let receipt={status:'success',transactionHash:hash,blockNumber:101n,blockHash,logs:[{address:NYRA_TOKEN,topics:[topic,addr(wallet),addr(ZERO)],data:'0x'+BigInt(raw).toString(16).padStart(64,'0'),logIndex:0}]};return{receipt,safe:101n,chain:4663,getChainId:async function(){return this.chain;},getBlock:async function(p){return{number:p.blockTag==='safe'?this.safe:p.blockTag==='latest'?100n:101n,hash:blockHash,timestamp:BigInt(Math.ceil(Date.now()/1000))};},getTransactionReceipt:async function(){return this.receipt;},readContract:async o=>o.functionName==='decimals'?18:10n**30n};}

test('NYRA burn proof rejects wrong chain, receipt, amount, wallet, recipient, old blocks and reorgs',async()=>{
 const intent={wallet,token_amount:PACKS[0].rawAmount,min_block:'100',created_at:Date.now()},c=fakeChain();
 assert.equal((await verifyBurn(intent,hash,c)).pending,false);
 c.safe=100n;assert.equal((await verifyBurn(intent,hash,c)).pending,true);c.safe=101n;
 c.chain=1;await assert.rejects(verifyBurn(intent,hash,c),e=>e.status===503);c.chain=4663;
 c.receipt.status='reverted';await assert.rejects(verifyBurn(intent,hash,c),/reverted/);c.receipt.status='success';
 c.receipt.logs[0].data='0x'+(1n).toString(16).padStart(64,'0');await assert.rejects(verifyBurn(intent,hash,c),/matching NYRA burn/);c.receipt.logs[0].data='0x'+BigInt(PACKS[0].rawAmount).toString(16).padStart(64,'0');
 c.receipt.logs[0].topics[1]=addr(other);await assert.rejects(verifyBurn(intent,hash,c),/matching NYRA burn/);c.receipt.logs[0].topics[1]=addr(wallet);
 c.receipt.logs[0].topics[2]=addr(other);await assert.rejects(verifyBurn(intent,hash,c),/matching NYRA burn/);c.receipt.logs[0].topics[2]=addr(ZERO);
 c.receipt.logs[0].address=other;await assert.rejects(verifyBurn(intent,hash,c),/matching NYRA burn/);c.receipt.logs[0].address=NYRA_TOKEN;
 c.receipt.blockNumber=100n;await assert.rejects(verifyBurn(intent,hash,c),/predates/);c.receipt.blockNumber=101n;
 c.receipt.blockHash='0x'+'c'.repeat(64);await assert.rejects(verifyBurn(intent,hash,c),/block changed/);
});

test('packs persist, prevent replay, unlock watch limits and refund failed paid research exactly once',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'nyra-billing-'));process.env.TURSO_DATABASE_URL='file:'+join(dir,'billing.db');delete process.env.TURSO_AUTH_TOKEN;process.env.AI_GATEWAY_API_KEY='test-only';
 const{sqlClient}=await import('../lib/database.ts'),db=sqlClient();const billing=await import('../lib/billing.ts');const{workspaceHandler,runChecks}=await import('../lib/workspace-service.ts');const{askAgent}=await import('../lib/agent-service.ts');
 const originalFetch=global.fetch;let failAI=false,stockCount=0;
 global.fetch=async(url,opts)=>{url=String(url);if(url==='https://ai-gateway.vercel.sh/v1/chat/completions'){if(failAI)return Response.json({},{status:503});return Response.json({choices:[{message:{content:'Test research answer.'},finish_reason:'stop'}],usage:{prompt_tokens:1,completion_tokens:1}});}
 if(url.endsWith('/rhj/assets'))return Response.json({assets:[{tokenSymbol:'NVDA',status:'ASSET_STATUS_ACTIVE',tokenName:'NVIDIA',currentMultiplier:'1',deployments:[{chainId:4663,contractAddress:other}]}]});
 if(url.endsWith('/rhj/prices/NVDA')){stockCount++;return Response.json({quotes:[{tokenSymbol:'NVDA',ask:'150',bid:'149',generatedAt:new Date().toISOString(),deployments:[{chainId:4663,contractAddress:other}]}]});}
 if(url.startsWith('https://ponsfamily.com/api/launches?'))return Response.json({items:[]});throw Error('Unexpected test network request: '+url);};
 try{
  for(const file of(await readdir('drizzle')).filter(x=>x.endsWith('.sql')).sort())await db.batch((await readFile('drizzle/'+file,'utf8')).split('--> statement-breakpoint').map(x=>x.trim()).filter(Boolean),'write');
  const now=Date.now();await db.batch([{sql:'INSERT INTO nyra_profiles(user_id,wallet,wallet_verified_at,created_at) VALUES(?,?,?,?)',args:['one',wallet,now,now]},{sql:'INSERT INTO nyra_profiles(user_id,wallet,wallet_verified_at,created_at) VALUES(?,?,?,?)',args:['two',other,now,now]}],'write');
  const c=fakeChain();const q=await billing.preparePurchase('one','research-25',c);assert.equal(q.rawAmount,PACKS[0].rawAmount);assert.equal(q.transaction.data.slice(0,10),'0x42966c68');assert.equal((await billing.preparePurchase('one','research-25',c)).id,q.id);
  await assert.rejects(billing.confirmPurchase('two',q.id,hash,c),e=>e.status===404);
  c.safe=100n;assert.equal((await billing.confirmPurchase('one',q.id,hash,c)).pending,true);assert.equal((await billing.tokenAccount('one')).aiCredits,0);assert.equal((await billing.tokenAccount('one')).purchases[0].tx_hash,hash);
  c.safe=101n;assert.equal((await billing.confirmPurchase('one',q.id,hash,c)).paid,true);await billing.confirmPurchase('one',q.id,hash,c);assert.equal((await billing.tokenAccount('one')).aiCredits,25);
  const q2=await billing.preparePurchase('one','research-25',c);await assert.rejects(billing.confirmPurchase('one',q2.id,hash,c),/already been used/);assert.equal((await billing.tokenAccount('one')).aiCredits,25);
  const w=await billing.preparePurchase('one','watches-5',c),wc=fakeChain(PACKS[1].rawAmount),wh='0x'+'d'.repeat(64);wc.receipt.transactionHash=wh;await billing.confirmPurchase('one',w.id,wh,wc);assert.equal((await billing.tokenAccount('one')).maxWatches,10);assert.equal((await billing.tokenAccount('two')).maxWatches,5);
  const session='f'.repeat(64);await db.execute({sql:'INSERT INTO nyra_sessions(token_hash,user_id,created_at,expires_at) VALUES(?,?,?,?)',args:[createHash('sha256').update(session).digest('hex'),'one',now,now+1000000]});
  const call=(path,data,userSession=session)=>workspaceHandler(new Request('https://nyra.test'+path,{method:data?'POST':'GET',headers:{origin:'https://nyra.test',cookie:'__Host-nyra-session='+userSession},body:data?JSON.stringify(data):undefined}));
  // Fill five base slots; a purchased slot must actually allow another watch.
  for(let i=0;i<5;i++)await db.execute({sql:'INSERT INTO nyra_watches(id,user_id,fingerprint,plan,previous,last_at,next_at,created_at) VALUES(?,?,?,?,?,?,?,?)',args:['base'+i,'one','base'+i,JSON.stringify({order:'Watch NVDA below '+(100+i),kind:'price',tool:'rh_stock',args:{symbol:'NVDA'},threshold:100+i,direction:'below'}),JSON.stringify({tool:'rh_stock',data:{ask:'150'}}),now,0,now]});
  const created=await call('/api/watches/create',{plan:{order:'Watch NVDA below 120'}});assert.equal(created.status,201,JSON.stringify(await created.clone().json()));assert.equal((await db.execute("SELECT COUNT(*) AS n FROM nyra_watches WHERE user_id='one'")).rows[0].n,6);
  // Paid research starts only after the free allowance. First run is free.
  let r=await billing.reserveResearch('one','First free question','test');assert.equal(r.billing,'free');assert.equal((await billing.tokenAccount('one')).aiCredits,25);await db.execute({sql:"UPDATE nyra_agent_runs SET status='complete',created_at=? WHERE id=?",args:[now-10000,r.id]});
  for(let i=0;i<29;i++)await db.execute({sql:"INSERT INTO nyra_agent_runs(id,user_id,prompt,model,status,created_at) VALUES(?,?,'test','test','complete',?)",args:['free'+i,'one',now-10000]});
  const answer=await askAgent('one',{prompt:'A test question'});assert.equal(answer.status,200);const result=await answer.json();assert.equal(result.run.billing,'paid');assert.equal(result.run.status,'complete');assert.equal((await billing.tokenAccount('one')).aiCredits,24);
  await db.execute({sql:'UPDATE nyra_agent_runs SET created_at=? WHERE id=?',args:[now-10000,result.run.id]});failAI=true;
  const failed=await(await askAgent('one',{prompt:'Another test question'})).json();assert.equal(failed.run.status,'failed');assert.equal(failed.run.creditRefunded,true);assert.equal((await billing.tokenAccount('one')).aiCredits,24);
  await billing.recoverResearch('one');assert.equal((await billing.tokenAccount('one')).aiCredits,24);
  await db.execute({sql:'UPDATE nyra_agent_runs SET created_at=? WHERE id=?',args:[now-10000,failed.run.id]});
  const stale=await billing.reserveResearch('one','Interrupted request','test');assert.equal((await billing.tokenAccount('one')).aiCredits,23);await db.execute({sql:'UPDATE nyra_agent_runs SET created_at=? WHERE id=?',args:[now-200000,stale.id]});await billing.recoverResearch('one');await billing.recoverResearch('one');assert.equal((await billing.tokenAccount('one')).aiCredits,24);
  // More than the former 12-watch batch must be read in one server tick.
  for(let i=0;i<15;i++)await db.execute({sql:'INSERT INTO nyra_watches(id,user_id,fingerprint,plan,previous,last_at,next_at,created_at) VALUES(?,?,?,?,?,?,?,?)',args:['due'+i,'two','due'+i,JSON.stringify({order:'Watch NVDA below 1',kind:'price',tool:'rh_stock',args:{symbol:'NVDA'},threshold:1,direction:'below'}),JSON.stringify({tool:'rh_stock',data:{ask:'150'}}),now,0,now]});
  const tick=await runChecks();assert(tick.checked>=20,JSON.stringify(tick));assert(stockCount>=20);assert.equal(tick.failed,0);
  // A fresh client request recovers saved capacities and account separation.
  const restored=await(await call('/api/workspace')).json();assert.equal(restored.token.aiCredits,24);assert.equal(restored.maxWatches,10);assert.equal((await call('/api/token/account',undefined,'0'.repeat(64))).status,401);
  // Permanent capacity stops before accepting payment beyond the advertised maximum.
  for(let i=0;i<4;i++){const pack=await billing.preparePurchase('one','watches-5',c),proof=fakeChain(PACKS[1].rawAmount),h='0x'+String(i+3).repeat(64);proof.receipt.transactionHash=h;await billing.confirmPurchase('one',pack.id,h,proof);}
  assert.equal((await billing.tokenAccount('one')).maxWatches,30);await assert.rejects(billing.preparePurchase('one','watches-5',c),e=>e.status===409);
  // Two confirmations racing for one hash must not grant two packs.
  const same=fakeChain(),sameHash='0x'+'9'.repeat(64);same.receipt.transactionHash=sameHash;
  await Promise.allSettled([billing.confirmPurchase('one',q2.id,sameHash,same),billing.confirmPurchase('one',q2.id,sameHash,same)]);await billing.confirmPurchase('one',q2.id,sameHash,same);
  assert.equal((await billing.tokenAccount('one')).aiCredits,49);
  await db.execute("UPDATE nyra_entitlements SET ai_credits=0 WHERE user_id='one'");await assert.rejects(billing.reserveResearch('one','No credits','test'),e=>e.status===429);assert.equal((await billing.tokenAccount('one')).aiCredits,0);

 }finally{global.fetch=originalFetch;db.close();await rm(dir,{recursive:true,force:true});}
});
