const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const date=t=>new Date(t).toLocaleString('en-US',{month:'short',day:'numeric',hour:'2-digit',minute:'2-digit',second:'2-digit',timeZone:'UTC'})+' UTC';
const labels={liquidity:'Liquidity',progress:'Curve progress',stage:'Launch stage',loss:'Simulated round-trip loss',update:'Meaningful update'};
function value(key,x){if(!x)return 'Unavailable';if(key==='liquidity')return new Intl.NumberFormat('en-US',{style:'currency',currency:'USD',maximumFractionDigits:2}).format(x.value);if(key==='progress'||key==='loss')return Number(x.value).toLocaleString('en-US',{maximumFractionDigits:2})+'%';if(key==='update')return date(x.value);return x.value;}
const state=s=>({pass:'Passed',fail:'Failed',unknown:'Unknown',warn:'Warning',matched:'Matched',rejected:'Not matched'}[s]||s);
function source(x){if(!x?.source)return '';try{const u=new URL(x.source);if(u.protocol!=='https:'||!['corbel.finance','heyresearch.xyz','ponsfamily.com'].includes(u.hostname))return '';return `<a href="${esc(u.href)}" target="_blank" rel="noopener noreferrer">${esc(u.hostname)}</a>${x.at?' · '+esc(date(x.at)):''}`;}catch{return '';}}
function change(c){
 let text;
 if(c.kind==='changed')text=`<span>${esc(value(c.key,c.before))}</span><span aria-label="to">→</span><strong>${esc(value(c.key,c.after))}</strong>`;
 else if(c.kind==='unavailable')text=`<span>Previously ${esc(value(c.key,c.before))}</span><strong>Could not recheck</strong>`;
 else if(c.kind==='available')text=`<span>Now available</span><strong>${esc(value(c.key,c.after))}</strong>`;
 else text=`<span>${esc(state(c.before))}</span><span aria-label="to">→</span><strong>${esc(state(c.after))}</strong>`;
 return `<div class="scout-change"><span class="scout-change-label">${esc(c.label)}</span><div class="scout-change-values">${text}</div>${c.detail?`<p>${esc(c.detail)}</p>`:''}${c.before?.at?`<p class="small">Previous source: ${source(c.before)}</p>`:''}${c.after?.at?`<p class="small">Current source: ${source(c.after)}</p>`:''}${c.kind==='risk'?`<p class="small">${source({source:c.source})}</p>`:''}</div>`;
}
export function scoutHistoryHTML(data){
 return `<div class="scout-history"><div class="scout-history-heading"><strong>What changed</strong><span class="small">${esc(data.missionTitle)}</span></div><p class="small">${esc(data.notice)}</p><ol>${data.entries.map(e=>`<li class="scout-history-entry"><div class="scout-row"><time>${esc(date(e.checkedAt))}</time><span class="scout-state">${esc(state(e.decision))}</span></div>${e.conditionsChanged?'<p class="scout-warning">Search conditions changed between these checks.</p>':''}${e.changes.length?e.changes.map(change).join(''):e.baseline?`<p>First saved check. Baseline for later comparisons.</p><dl>${Object.entries(e.metrics).filter(([,x])=>x).map(([key,x])=>`<div><dt>${esc(labels[key])}</dt><dd>${esc(value(key,x))}<span class="small">${source(x)}</span></dd></div>`).join('')}</dl>`:'<p>No new comparable changes in the tracked data.</p>'}</li>`).join('')}</ol>${data.hasMore?'<p class="small">Showing the latest 20 saved checks.</p>':''}</div>`;
}
