import { request } from './workspace-client.js';
const $=s=>document.querySelector(s),esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
let running=false,workspace,lastError='';
export const researchBusy=()=>running;
const date=n=>new Date(n).toLocaleString('en-GB',{timeZone:'UTC'})+' UTC';
const link=url=>{try{const u=new URL(url);return u.protocol==='https:'?esc(u.href):'';}catch{return '';}};
export function renderResearch(data) {
 workspace=data;
 $('#ai-status').textContent=lastError||(!data?.signedIn?'Sign in to ask Nyra':data?.ai.configured?'Server AI · '+data.ai.model:'AI connection not configured');
 $('#research-send').disabled=running||!!(data?.signedIn&&!data?.ai.configured);
 if(!running)$('#research-send').textContent=data?.signedIn?'Ask Nyra':'Sign in to ask';
 $('#research-runs').innerHTML=(data?.agentRuns||[]).map(r=>`<article class="research-run"><div class="research-run-meta"><span>${esc(r.status)} · ${date(r.createdAt)}</span><span>${esc(r.model)}</span></div><h4>${esc(r.prompt)}</h4>${r.answer?`<p class="research-answer">${esc(r.answer)}</p>`:''}${r.error?`<p class="research-error">${esc(r.error)}</p><button class="text-button" data-research-retry="${esc(r.id)}" ${running?'disabled':''}>Retry question</button>`:''}${r.status==='running'?'<p class="small">Reading sources and preparing the answer. It is safe to refresh.</p>':''}${r.steps.length?`<details><summary>${r.steps.length} tool call${r.steps.length===1?'':'s'} · inspect evidence</summary>${r.steps.map(s=>`<div class="research-step"><strong>${esc(s.tool)}</strong><span class="small">${esc(s.at)}</span><pre>${esc(JSON.stringify(s.args))}</pre>${s.error?`<p class="research-error">${esc(s.error)}</p>`:`<pre>${esc(JSON.stringify(s.result?.data,null,2))}</pre>`}</div>`).join('')}</details>`:''}<div class="research-sources">${r.sources.map(s=>link(s.url)?`<a href="${link(s.url)}" target="_blank" rel="noopener">[${s.index}] ${esc(s.tool)} · ${esc(s.readAt)}</a>`:'').join('')}</div></article>`).join('')||'<p class="small">No AI research saved yet. Ask about two stocks, an RH transaction or a public contract.</p>';
}
export async function askResearch(prompt,refresh) {
 if(running)return;lastError='';running=true;$('#research-send').disabled=true;$('#research-send').textContent='Nyra is reading…';$('#research-form').setAttribute('aria-busy','true');
 const poll=setInterval(()=>void refresh(),4000);
 try { await request('/api/agent/ask',{prompt}); }
 catch(e){lastError=e.message;}
 finally {clearInterval(poll);running=false;$('#research-send').textContent='Ask Nyra';$('#research-form').removeAttribute('aria-busy');await refresh();}
}
export function bindResearch(refresh) { $('#research-runs').addEventListener('click',e=>{const b=e.target.closest('[data-research-retry]');if(!b||running)return;const r=workspace?.agentRuns.find(x=>x.id===b.dataset.researchRetry);if(r){$('#research-prompt').value=r.prompt;void askResearch(r.prompt,refresh);}}); }
