import test from'node:test';import assert from'node:assert/strict';import{runAgent}from'../lib/agent-core.mjs';
const done=output=>({status:'completed',model:'gpt-6.2-sol',output,usage:{input_tokens:20,output_tokens:10,input_tokens_details:{cached_tokens:5},output_tokens_details:{reasoning_tokens:4}}});
const answer=text=>({type:'message',role:'assistant',content:[{type:'output_text',text}]});
const tool=(name,args)=>({type:'function_call',id:'fc_test',call_id:'call_test',name,arguments:JSON.stringify(args)});
const config={prompt:'Compare two stocks',provider:'openai',model:'openai/gpt-6.2-sol'};
test('Responses route preserves typed reasoning, tools, source citations and token accounting',async()=>{
 let turn=0;const saved=[],reasoning={type:'reasoning',id:'rs_test',summary:[],encrypted_content:'test-encrypted-only'};
 const r=await runAgent({...config,complete:async p=>{
  assert.equal(p.model,'gpt-6.2-sol');assert.equal(p.store,false);assert.equal(p.input[0].role,'developer');assert.deepEqual(p.include,['reasoning.encrypted_content']);assert.equal(p.reasoning.effort,'low');assert(!('temperature'in p));assert(p.tools.every(t=>t.type==='function'&&t.strict));
  if(!turn++)return done([reasoning,tool('rh_stock',{symbol:'NVDA'})]);
  assert.deepEqual(p.input[2],reasoning);assert.equal(p.input[3].call_id,'call_test');assert.equal(p.input[4].type,'function_call_output');assert.equal(p.input[4].call_id,'call_test');return done([answer('NVDA source [1].')]);
 },execute:async(name,args)=>({tool:name,readAt:new Date().toISOString(),data:{symbol:args.symbol,ask:'150',source:'https://api.robinhood.com/rhj/prices/NVDA'}}),onStep:async s=>saved.push(s)});
 assert.equal(r.sources.length,1);assert.equal(saved.length,1);assert.equal(r.usage.inputTokens,40);assert.equal(r.usage.cachedInputTokens,10);assert.equal(r.usage.reasoningTokens,8);assert.equal(r.usage.provider,'openai');
});
test('Responses rejects tool-argument injection and preserves source failures',async()=>{let turn=0,n=0;const r=await runAgent({...config,complete:async()=>turn++?done([answer('Source unavailable.')]):done([tool('rh_network',{url:'https://evil.test'})]),execute:async()=>{n++;}});assert.equal(n,0);assert.equal(r.sources.length,0);assert.match(r.steps[0].error,/argument/);});
test('incomplete Responses output never becomes a complete answer or executes partial calls',async()=>{let n=0;await assert.rejects(runAgent({...config,complete:async()=>({status:'incomplete',output:[tool('rh_network',{})]}),execute:async()=>{n++;}}),/incomplete/);assert.equal(n,0);});
test('Responses loop has the same six-read bound as the retained Gateway path',async()=>{let n=0;await assert.rejects(runAgent({...config,complete:async()=>done(Array.from({length:8},()=>tool('rh_network',{}))),execute:async()=>{n++;return{tool:'rh_network',readAt:new Date().toISOString(),data:{source:'https://rpc.mainnet.chain.robinhood.com'}};}}),/tool limit/);assert.equal(n,6);});
test('direct HTTP request uses OpenAI only, and insufficient credits do not fallback',async()=>{
 const original=global.fetch;let calls=0;
 try{global.fetch=async(url,options)=>{calls++;assert.equal(url,'https://api.openai.com/v1/responses');assert.equal(options.redirect,'manual');const body=JSON.parse(options.body);assert.equal(body.store,false);assert(!('temperature'in body));return Response.json({error:{code:'insufficient_quota'}},{status:429});};await assert.rejects(runAgent({...config,apiKey:'test-only'}),/did not switch to Gateway billing/);assert.equal(calls,1);}finally{global.fetch=original;}
});
test('direct model and credential mismatches fail before a network call',async()=>{await assert.rejects(runAgent({...config}),/not configured/);await assert.rejects(runAgent({...config,apiKey:'test-only',model:'openai/gpt-4.1-mini'}),/not been configured/);await assert.rejects(runAgent({...config,provider:'untrusted'}),/not configured/);});
