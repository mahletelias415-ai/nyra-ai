import {createPublicClient,http,parseAbi} from 'viem';
import {database,writeTransaction} from './database.js';
import {PACKS,NYRA_TOKEN,CHAIN_ID,burnData,BillingError,verifyBurn} from './payment-core.mjs';
const db=database;
const chain=()=>createPublicClient({transport:http(process.env.RH_RPC_URL||'https://rpc.mainnet.chain.robinhood.com',{timeout:6000,retryCount:0})});
export const FREE_REQUESTS=30,FREE_WATCHES=5,MAX_PAID_SLOTS=25;
export function catalog(){return {token:NYRA_TOKEN,chainId:CHAIN_ID,decimals:18,mode:'burn',packs:PACKS,freeRequestsPerDay:FREE_REQUESTS,sharedFreeRequestsPerDay:200,serviceCapacityPerDay:1000,freeWatchSlots:FREE_WATCHES,maxExtraWatchSlots:MAX_PAID_SLOTS,confirmation:'RH safe block: a batch posted to Ethereum. This may take several minutes.',notice:'Burning NYRA is irreversible. Packs belong to your signed-in wallet. Credits and slots do not expire; successful paid AI requests consume one credit. Failed or interrupted paid requests are refunded as credits.'};}
export async function tokenAccount(user:string){
 const [a,p,u]=await Promise.all([
  db().prepare('SELECT ai_credits,watch_slots FROM nyra_entitlements WHERE user_id=?').bind(user).first(),
  db().prepare("SELECT id,sku,token_amount,status,tx_hash,created_at,credited_at,last_error FROM nyra_purchases WHERE user_id=? ORDER BY CASE WHEN status='prepared' THEN 0 ELSE 1 END,created_at DESC LIMIT 20").bind(user).all(),
  db().prepare("SELECT COUNT(*) AS total,SUM(CASE WHEN user_id=? THEN 1 ELSE 0 END) AS mine FROM nyra_agent_runs WHERE billing_type='free' AND status IN ('running','complete') AND created_at>=?").bind(user,Math.floor(Date.now()/86400000)*86400000).first(),
 ]);
 return {aiCredits:Number(a?.ai_credits||0),extraWatchSlots:Number(a?.watch_slots||0),maxWatches:FREE_WATCHES+Number(a?.watch_slots||0),freeRequestsRemaining:Math.max(0,Math.min(FREE_REQUESTS-Number(u?.mine||0),200-Number(u?.total||0))),purchases:p.results};
}
export async function preparePurchase(user:string,sku:string,client:any=chain()){
 const pack=PACKS.find(p=>p.id===sku);if(!pack)throw new BillingError(400,'Choose an available NYRA pack.');
 const profile=await db().prepare('SELECT wallet,wallet_verified_at FROM nyra_profiles WHERE user_id=?').bind(user).first();
 if(!profile?.wallet_verified_at||!profile.wallet)throw new BillingError(403,'Sign in with your wallet before preparing a purchase.');
 if(await client.getChainId()!==CHAIN_ID)throw new BillingError(503,'The payment source returned the wrong chain.');
 const [block,decimals,balance]=await Promise.all([client.getBlock({blockTag:'latest'}),client.readContract({address:NYRA_TOKEN,abi:parseAbi(['function decimals() view returns(uint8)']),functionName:'decimals'}),client.readContract({address:NYRA_TOKEN,abi:parseAbi(['function balanceOf(address) view returns(uint256)']),functionName:'balanceOf',args:[profile.wallet]})]);
 if(decimals!==18)throw new BillingError(503,'NYRA token decimals no longer match the pack configuration.');
 // A quote may be viewed without a sufficient balance; wallet submission still checks it.
 const tx=await writeTransaction();let intent:any;
 try{
  await tx.execute({sql:'INSERT OR IGNORE INTO nyra_entitlements(user_id) VALUES(?)',args:[user]});
  const a=(await tx.execute({sql:'SELECT watch_slots FROM nyra_entitlements WHERE user_id=?',args:[user]})).rows[0];
  if(pack.watchSlots&&Number(a.watch_slots)+pack.watchSlots>MAX_PAID_SLOTS)throw new BillingError(409,'All 25 additional watch slots are already active.');
  intent=(await tx.execute({sql:"SELECT * FROM nyra_purchases WHERE user_id=? AND sku=? AND status='prepared'",args:[user,sku]})).rows[0];
  if(!intent){const id=crypto.randomUUID(),t=Date.now();await tx.execute({sql:'INSERT INTO nyra_purchases(id,user_id,wallet,sku,token_amount,ai_credits,watch_slots,min_block,created_at) VALUES(?,?,?,?,?,?,?,?,?)',args:[id,user,profile.wallet,sku,pack.rawAmount,pack.aiCredits,pack.watchSlots,String(block.number),t]});intent=(await tx.execute({sql:'SELECT * FROM nyra_purchases WHERE id=?',args:[id]})).rows[0];}
  await tx.commit();
 }catch(e){await tx.rollback();throw e;}finally{tx.close();}
 return {id:intent.id,wallet:intent.wallet,sku:intent.sku,title:pack.title,amount:pack.amount,rawAmount:intent.token_amount,balance:String(balance),sufficientBalance:balance>=BigInt(intent.token_amount),chainId:CHAIN_ID,token:NYRA_TOKEN,mode:'burn',transaction:{to:NYRA_TOKEN,data:burnData(intent.token_amount),value:'0x0'},confirmation:catalog().confirmation};
}
export async function confirmPurchase(user:string,id:string,hash:string,client:any=chain()){
 const intent=await db().prepare('SELECT * FROM nyra_purchases WHERE id=? AND user_id=?').bind(id,user).first<any>();
 if(!intent)throw new BillingError(404,'This pack was not found in your account.');
 if(intent.status==='paid'){if(String(intent.tx_hash).toLowerCase()!==hash.toLowerCase())throw new BillingError(409,'This pack was already activated with another transaction.');return {paid:true,account:await tokenAccount(user)};}
 const proof=await verifyBurn(intent,hash,client);
 if(proof.pending){await db().prepare("UPDATE nyra_purchases SET tx_hash=?,next_check_at=?,last_error='' WHERE id=? AND user_id=? AND status='prepared'").bind(hash.toLowerCase(),Date.now()+30000,id,user).run();return {paid:false,pending:true,message:proof.reason};}
 const tx=await writeTransaction();
 try{
  const current=(await tx.execute({sql:'SELECT status,tx_hash FROM nyra_purchases WHERE id=? AND user_id=?',args:[id,user]})).rows[0];
  if(current.status==='paid'){if(current.tx_hash!==hash.toLowerCase())throw new BillingError(409,'This pack was already activated.');await tx.commit();return {paid:true,account:await tokenAccount(user)};}
  const used=(await tx.execute({sql:'SELECT purchase_id FROM nyra_payment_receipts WHERE tx_hash=?',args:[hash.toLowerCase()]})).rows[0];
  if(used)throw new BillingError(409,'This transaction has already been used to activate a pack.');
  const at=Date.now();
  await tx.execute({sql:'INSERT INTO nyra_payment_receipts(tx_hash,purchase_id,user_id,block_number,block_hash,log_index,token_amount,verified_at) VALUES(?,?,?,?,?,?,?,?)',args:[hash.toLowerCase(),id,user,proof.blockNumber!,proof.blockHash!,proof.logIndex!,intent.token_amount,at]});
  await tx.execute({sql:'INSERT INTO nyra_entitlements(user_id,ai_credits,watch_slots) VALUES(?,?,?) ON CONFLICT(user_id) DO UPDATE SET ai_credits=ai_credits+excluded.ai_credits,watch_slots=watch_slots+excluded.watch_slots',args:[user,intent.ai_credits,intent.watch_slots]});
  await tx.execute({sql:"UPDATE nyra_purchases SET status='paid',tx_hash=?,credited_at=? WHERE id=? AND user_id=?",args:[hash.toLowerCase(),at,id,user]});await tx.commit();
 }catch(e){await tx.rollback();throw e;}finally{tx.close();}
 return {paid:true,account:await tokenAccount(user)};
}
// Browser and hourly runner can both recover confirmations. Crediting is atomic and idempotent.
export async function settlePendingPurchases(){
 const rows=await db().prepare("SELECT id,user_id,tx_hash FROM nyra_purchases WHERE status='prepared' AND tx_hash IS NOT NULL AND next_check_at<=? ORDER BY next_check_at,created_at LIMIT 6").bind(Date.now()).all();let credited=0;
 for(let i=0;i<rows.results.length;i+=3)await Promise.all(rows.results.slice(i,i+3).map(async p=>{try{if((await confirmPurchase(String(p.user_id),String(p.id),String(p.tx_hash))).paid)credited++;}catch{await db().prepare("UPDATE nyra_purchases SET next_check_at=?,last_error='Confirmation could not complete. Check the transaction hash or retry.' WHERE id=? AND status='prepared'").bind(Date.now()+3600000,p.id).run();}}));
 return {checked:rows.results.length,credited};
}

export async function recoverResearch(user:string){
 const tx=await writeTransaction();try{
  const t=Date.now();await tx.execute({sql:"UPDATE nyra_agent_runs SET status='interrupted',error='The request was interrupted. Completed reads are preserved. Retry explicitly.',finished_at=? WHERE user_id=? AND status='running' AND created_at<?",args:[t,user,t-150000]});
  await tx.execute({sql:'INSERT OR IGNORE INTO nyra_entitlements(user_id) VALUES(?)',args:[user]});
  await tx.execute({sql:"UPDATE nyra_entitlements SET ai_credits=ai_credits+(SELECT COUNT(*) FROM nyra_agent_runs WHERE user_id=? AND billing_type='paid' AND credit_refunded=0 AND status IN ('failed','interrupted')) WHERE user_id=?",args:[user,user]});
  await tx.execute({sql:"UPDATE nyra_agent_runs SET credit_refunded=1 WHERE user_id=? AND billing_type='paid' AND credit_refunded=0 AND status IN ('failed','interrupted')",args:[user]});await tx.commit();
 }catch(e){await tx.rollback();throw e;}finally{tx.close();}
}
export async function reserveResearch(user:string,prompt:string,model:string,requestKey?:string){
 await recoverResearch(user);
 const tx=await writeTransaction();const id=crypto.randomUUID(),t=Date.now(),day=Math.floor(t/86400000)*86400000;let billing='free';
 try{
  if(requestKey){const old=(await tx.execute({sql:'SELECT id,billing_type FROM nyra_agent_runs WHERE user_id=? AND request_key=?',args:[user,requestKey]})).rows[0];if(old){await tx.commit();return {id:String(old.id),billing:String(old.billing_type),reused:true};}}
  const active=(await tx.execute({sql:"SELECT id FROM nyra_agent_runs WHERE user_id=? AND (status='running' OR created_at>?) LIMIT 1",args:[user,t-5000]})).rows[0];if(active)throw new BillingError(429,'Let the current request finish before asking again.');
  const usage=(await tx.execute({sql:"SELECT COUNT(*) AS total,SUM(CASE WHEN billing_type='free' THEN 1 ELSE 0 END) AS free,SUM(CASE WHEN billing_type='free' AND user_id=? THEN 1 ELSE 0 END) AS mine FROM nyra_agent_runs WHERE created_at>=? AND status IN ('running','complete')",args:[user,day]})).rows[0];
  if(Number(usage.total)>=1000)throw new BillingError(503,'AI capacity is full today. No credit was charged; saved credits remain available.');
  if(Number(usage.mine)>=FREE_REQUESTS||Number(usage.free)>=200){
   const a=(await tx.execute({sql:'SELECT ai_credits FROM nyra_entitlements WHERE user_id=?',args:[user]})).rows[0];
   if(Number(a?.ai_credits||0)<1)throw new BillingError(429,'The free AI allowance is used. Add a NYRA request pack, or wait for the free allowance to reset at 00:00 UTC.');
   await tx.execute({sql:'UPDATE nyra_entitlements SET ai_credits=ai_credits-1 WHERE user_id=? AND ai_credits>0',args:[user]});billing='paid';
  }
  await tx.execute({sql:'INSERT INTO nyra_agent_runs(id,user_id,prompt,model,created_at,billing_type,request_key) VALUES(?,?,?,?,?,?,?)',args:[id,user,prompt,model,t,billing,requestKey||null]});await tx.commit();
 }catch(e){await tx.rollback();throw e;}finally{tx.close();}
 return {id,billing};
}
