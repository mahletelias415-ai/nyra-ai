import{request,walletProvider}from'./workspace-client.js';
const $=s=>document.querySelector(s),esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const TOKEN='0xb087f8bbc80654f2cf84907052551375a7a413c5';
let account=null,quote=null,paying=false,checking=false;
const dialog=$('#token-pack-dialog'),message=$('#token-message'),status=$('#token-pack-status');
$('#copy-nyra-contract')?.addEventListener('click',async()=>{try{await navigator.clipboard.writeText(TOKEN);$('#nyra-copy-status').textContent='Contract copied.';}catch{$('#nyra-copy-status').textContent='Select and copy the contract address above.';}});
function render(a){account=a;$('#token-balance').textContent=a?`${a.aiCredits} AI credits · ${a.freeRequestsRemaining} free requests left today · ${a.maxWatches} server watch slots`:'Sign in with your wallet to buy and recover NYRA packs.';
 $('#token-purchases').innerHTML=(a?.purchases||[]).filter(p=>p.status==='paid'||p.tx_hash).map(p=>`<article class="token-purchase"><strong>${p.sku==='research-25'?'25 AI requests':'5 watch slots'} · ${p.status==='paid'?'Active':'Waiting for confirmation'}</strong>${p.tx_hash?`<a href="https://robin.etherscan.io/tx/${esc(p.tx_hash)}" target="_blank" rel="noopener">View burn</a>`:''}${p.status!=='paid'?`<button class="text-button" data-check-pack="${esc(p.id)}">Check confirmation</button>`:''}</article>`).join('');
}
async function refresh(){try{render(await request('/api/token/account'));}catch(e){if(e.status===401)render(null);else message.textContent=e.message;}}
document.addEventListener('nyra:workspace',e=>{render(e.detail?.token||null);});
async function check(id,hash){const d=await request('/api/token/confirm',{id,hash});if(d.paid){render(d.account);document.dispatchEvent(new Event('nyra:refresh'));message.textContent='Pack activated. Your capacity is saved to your wallet account.';status.textContent='Pack activated.';try{localStorage.removeItem('nyra-pending-pack:'+id);}catch{}}else{message.textContent=d.message;status.textContent=d.message;}return d;}
for(const b of document.querySelectorAll('[data-token-pack]'))b.onclick=async()=>{if(!account){message.textContent='Sign in with your wallet first, then choose your pack.';$('#wallet-button').click();return;}if(paying)return;b.disabled=true;message.textContent='';try{
 quote=await request('/api/token/prepare',{sku:b.dataset.tokenPack});
 $('#token-pack-title').textContent=quote.title;$('#token-pack-review').innerHTML=`<p class="token-price">${esc(quote.amount)} NYRA</p><dl><dt>Network</dt><dd>Robinhood Chain · 4663</dd><dt>Payment</dt><dd>Burn NYRA directly. This is irreversible.</dd><dt>Account</dt><dd>${esc(quote.wallet)}</dd><dt>Activation</dt><dd>${esc(quote.confirmation)}</dd></dl><p class="small">${quote.sufficientBalance?'Your NYRA balance covers this pack.':'Your wallet does not have enough NYRA for this pack.'} Network gas is paid in ETH. Credits and slots do not expire.</p>`;
 $('#token-pack-pay').disabled=!quote.sufficientBalance;$('#token-pack-pay').textContent='Burn '+quote.amount+' NYRA in wallet';status.textContent='Review the amount before signing. No token approval is requested.';$('#token-recover-hash').value='';dialog.showModal();
 }catch(e){message.textContent=e.message;}finally{b.disabled=false;}};
$('#token-pack-close').onclick=()=>{if(!paying)dialog.close();};dialog.addEventListener('cancel',e=>{if(paying)e.preventDefault();});
$('#token-pack-pay').onclick=async()=>{if(paying||!quote)return;paying=true;$('#token-pack-pay').disabled=true;const q=quote;try{
 const p=walletProvider();if(!p)throw Error('Open Nyra in your wallet browser or enable a wallet extension.');
 const addresses=await p.request({method:'eth_accounts'});if(!addresses?.some(a=>a.toLowerCase()===q.wallet.toLowerCase()))throw Error('Select the signed-in wallet, or sign in again with the wallet you want to use.');
 if(q.chainId!==4663||q.token.toLowerCase()!==TOKEN||q.transaction.to.toLowerCase()!==TOKEN||q.transaction.value!=='0x0'||q.transaction.data!=='0x42966c68'+BigInt(q.rawAmount).toString(16).padStart(64,'0'))throw Error('Pack transaction details do not match NYRA. Reload before continuing.');
 let chain=await p.request({method:'eth_chainId'});if(BigInt(chain)!==4663n){try{await p.request({method:'wallet_switchEthereumChain',params:[{chainId:'0x1237'}]});}catch(e){if(e.code!==4902)throw e;await p.request({method:'wallet_addEthereumChain',params:[{chainId:'0x1237',chainName:'Robinhood Chain',nativeCurrency:{name:'Ether',symbol:'ETH',decimals:18},rpcUrls:['https://rpc.mainnet.chain.robinhood.com'],blockExplorerUrls:['https://robin.etherscan.io']}]});}chain=await p.request({method:'eth_chainId'});if(BigInt(chain)!==4663n)throw Error('Choose Robinhood Chain in your wallet.');}
 const tx={...q.transaction,from:q.wallet};await p.request({method:'eth_estimateGas',params:[tx]});status.textContent='Confirm the exact NYRA burn in your wallet.';
 const hash=await p.request({method:'eth_sendTransaction',params:[tx]});if(!/^0x[0-9a-f]{64}$/i.test(hash))throw Error('The wallet did not return a transaction hash.');
 try{localStorage.setItem('nyra-pending-pack:'+q.id,JSON.stringify({id:q.id,hash,wallet:q.wallet}));}catch{}
 $('#token-recover-hash').value=hash;status.textContent='Burn submitted. Saving the transaction and checking confirmation…';$('#token-pack-pay').textContent='Burn submitted';
 await check(q.id,hash);await refresh();
 }catch(e){status.textContent=e.code===4001?'Cancelled in wallet. No pack was purchased.':e.shortMessage||e.message||'The wallet request could not complete.';}
 finally{paying=false;$('#token-pack-pay').disabled=!!$('#token-recover-hash').value||!q.sufficientBalance;}};
$('#token-recover-form').onsubmit=async e=>{e.preventDefault();if(!quote||checking)return;checking=true;try{await check(quote.id,$('#token-recover-hash').value.trim());await refresh();}catch(err){status.textContent=err.message;}finally{checking=false;}};
$('#token-purchases').onclick=async e=>{const b=e.target.closest('[data-check-pack]');if(!b||checking)return;const p=account?.purchases.find(p=>p.id===b.dataset.checkPack);if(!p?.tx_hash)return;checking=true;b.disabled=true;try{await check(p.id,p.tx_hash);await refresh();}catch(err){message.textContent=err.message;}finally{checking=false;b.disabled=false;}};
async function recover(){if(checking||paying||!account)return;checking=true;try{const items=(account.purchases||[]).filter(p=>p.status!=='paid'&&p.tx_hash);for(const p of items.slice(0,2))await check(p.id,p.tx_hash);
 // A broadcast can outlive an interrupted API request. Recover only the signed-in account's intent IDs.
 for(const p of (account.purchases||[]).filter(p=>p.status!=='paid'&&!p.tx_hash)){let saved;try{saved=JSON.parse(localStorage.getItem('nyra-pending-pack:'+p.id)||'null');}catch{}if(saved?.hash)await check(p.id,saved.hash);}
 }catch(err){message.textContent=err.message;}finally{checking=false;}}
await refresh();void recover();setInterval(()=>void recover(),30000);
