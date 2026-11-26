export const NYRA_TOKEN='0xb087f8bbc80654f2cf84907052551375a7a413c5';
export const ZERO='0x0000000000000000000000000000000000000000';
export const CHAIN_ID=4663;
export const PACKS=Object.freeze([
 {id:'research-25',title:'25 AI requests',amount:'10000',rawAmount:'10000000000000000000000',aiCredits:25,watchSlots:0},
 {id:'watches-5',title:'5 extra watch slots',amount:'25000',rawAmount:'25000000000000000000000',aiCredits:0,watchSlots:5},
]);
export const burnData=raw=>'0x42966c68'+BigInt(raw).toString(16).padStart(64,'0');
export class BillingError extends Error {constructor(status,message){super(message);this.status=status;}}
// Decode only exact ERC-20 Transfer logs from the actual NYRA contract.
const TRANSFER='0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef';
export async function verifyBurn(intent,hash,client){
 if(!/^0x[0-9a-f]{64}$/i.test(hash||''))throw new BillingError(400,'Enter a complete transaction hash.');
 if(await client.getChainId()!==CHAIN_ID)throw new BillingError(503,'The payment source returned the wrong chain.');
 let receipt;
 try{receipt=await client.getTransactionReceipt({hash});}
 catch(e){if(e?.name==='TransactionReceiptNotFoundError')return {pending:true,reason:'Waiting for the transaction receipt.'};throw new BillingError(503,'The RH receipt source is unavailable. Your purchase is preserved.');}
 if(receipt.status!=='success')throw new BillingError(409,'This transaction reverted. It cannot activate a pack.');
 if(receipt.transactionHash.toLowerCase()!==hash.toLowerCase())throw new BillingError(503,'The receipt does not match this transaction.');
 if(receipt.blockNumber<=BigInt(intent.min_block))throw new BillingError(409,'This burn predates the purchase. Create a pack before sending its transaction.');
 const log=receipt.logs.find(l=>l.address.toLowerCase()===NYRA_TOKEN&&l.topics.length===3&&l.topics[0].toLowerCase()===TRANSFER&&l.topics[1].toLowerCase()==='0x'+intent.wallet.toLowerCase().slice(2).padStart(64,'0')&&l.topics[2].toLowerCase()==='0x'+'0'.repeat(64)&&/^0x[0-9a-f]{64}$/i.test(l.data)&&BigInt(l.data)===BigInt(intent.token_amount));
 if(!log)throw new BillingError(409,'No matching NYRA burn from your signed-in wallet was found for this pack.');
 const block=await client.getBlock({blockNumber:receipt.blockNumber});
 if(block.hash.toLowerCase()!==receipt.blockHash.toLowerCase())throw new BillingError(409,'The block changed. Recheck the transaction before crediting.');
 if(block.timestamp*1000n<BigInt(Math.floor(intent.created_at/1000)*1000))throw new BillingError(409,'This burn was made before the pack was prepared.');
 const safe=await client.getBlock({blockTag:'safe'});
 if(safe.number<receipt.blockNumber)return {pending:true,reason:'Burn found. Waiting for the RH safe block (L1-backed confirmation); this can take several minutes.'};
 return {pending:false,blockNumber:String(receipt.blockNumber),blockHash:receipt.blockHash,logIndex:log.logIndex};
}
