import test from'node:test';import assert from'node:assert/strict';import{mkdtemp,readFile,readdir,rm}from'node:fs/promises';import{tmpdir}from'node:os';import{join}from'node:path';
test('direct OpenAI research saves account evidence and refunds failed paid runs',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'nyra-openai-'));process.env.TURSO_DATABASE_URL='file:'+join(dir,'test.db');delete process.env.TURSO_AUTH_TOKEN;process.env.OPENAI_API_KEY='test-key-only';process.env.NYRA_AI_PROVIDER='openai';process.env.NYRA_AI_MODEL='openai/gpt-6.2-sol';
 const{sqlClient}=await import('../lib/database.ts'),db=sqlClient();const{askAgent,agentHistory,agentConfiguration}=await import('../lib/agent-service.ts');const{tokenAccount}=await import('../lib/billing.ts');const original=global.fetch;let turn=0,fail=false;
 global.fetch=async(url,opts)=>{
  assert.equal(url,'https://api.openai.com/v1/responses');if(fail)return Response.json({error:{code:'insufficient_quota'}},{status:429});
  const p=JSON.parse(opts.body);if(!turn++)return Response.json({status:'completed',model:'gpt-6.2-sol',output:[{type:'reasoning',id:'rs_test',encrypted_content:'test-ciphertext',summary:[]},{type:'function_call',id:'fc_test',call_id:'c_test',name:'rh_network',arguments:'{}'}],usage:{input_tokens:10,output_tokens:10}});
  assert(p.input.some(x=>x.type==='function_call_output'));return Response.json({status:'completed',model:'gpt-6.2-sol',output:[{type:'message',role:'assistant',content:[{type:'output_text',text:'The network source could not be read.'}]}],usage:{input_tokens:15,output_tokens:5}});
 };
 try{
  for(const f of(await readdir('drizzle')).filter(x=>x.endsWith('.sql')).sort())await db.batch((await readFile('drizzle/'+f,'utf8')).split('--> statement-breakpoint').map(x=>x.trim()).filter(Boolean),'write');
  const t=Date.now();await db.execute({sql:'INSERT INTO nyra_entitlements(user_id,ai_credits) VALUES(?,2)',args:['one']});
  for(let i=0;i<30;i++)await db.execute({sql:"INSERT INTO nyra_agent_runs(id,user_id,prompt,model,status,created_at) VALUES(?,'one','old','test','complete',?)",args:['free'+i,t-10000]});
  assert.equal((await agentConfiguration()).provider,'openai');
  // runTool's RH network fetch is intentionally rejected by the fake above. It is
  // preserved as a failed source step, not converted into fabricated network data.
  const first=await(await askAgent('one',{prompt:'Read RH network status'})).json();assert.equal(first.run.status,'complete');assert.equal(first.run.billing,'paid');assert.equal(first.run.steps.length,1);assert(first.run.steps[0].error);assert.equal(first.run.sources.length,0);assert.equal(first.run.usage.provider,'openai');assert.equal(first.run.usage.resolvedModel,'gpt-6.2-sol');assert.equal((await tokenAccount('one')).aiCredits,1);
  assert.equal((await agentHistory('one'))[0].id,first.run.id);
  await db.execute({sql:'UPDATE nyra_agent_runs SET created_at=? WHERE id=?',args:[t-10000,first.run.id]});fail=true;
  const second=await(await askAgent('one',{prompt:'Retry network status'})).json();assert.equal(second.run.status,'failed');assert.equal(second.run.creditRefunded,true);assert.match(second.run.error,/did not switch to Gateway billing/);assert.equal((await tokenAccount('one')).aiCredits,1);
  delete process.env.OPENAI_API_KEY;const noKey=await askAgent('one',{prompt:'No credential'});assert.equal(noKey.status,503);assert.equal((await tokenAccount('one')).aiCredits,1);
 }finally{global.fetch=original;db.close();await rm(dir,{recursive:true,force:true});}
});
