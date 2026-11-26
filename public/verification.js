const target=document.querySelector('#verification-receipts');
const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const stamp=v=>v?new Date(v).toLocaleString('en-US',{dateStyle:'medium',timeStyle:'short',timeZone:'UTC'})+' UTC':'Not recorded yet';
try{
 const r=await fetch('/api/verification',{cache:'no-store',signal:AbortSignal.timeout(15000)});if(!r.ok)throw Error();const d=await r.json();
 target.innerHTML=`<p class="small">${d.runner.healthy?'Server check recorded':'Waiting for a recent server check'} · ${esc(stamp(d.runner.lastFinishedAt))}</p>`+
 (d.control.checks.length?d.control.checks.slice(0,4).map(c=>`<details class="verification-receipt"><summary><span>${c.kind==='alert'?'Change detected':c.kind==='baseline'?'Baseline saved':c.kind==='error'?'Source unavailable':'Checked · no new launches'}</span><time>${esc(stamp(c.at))}</time></summary><p>${esc(c.message)}</p><p class="small">${c.previous?'Previous snapshot: '+esc(stamp(c.previous.readAt)):'First snapshot; no change is claimed.'}${c.current?'<br>Current snapshot: '+esc(stamp(c.current.readAt)):''}</p>${c.current?'<a href="https://ponsfamily.com/api/launches?sort=newest&amp;limit=12" target="_blank" rel="noopener">Check source</a>':''}</details>`).join(''):'<p>No public receipt yet. The first tick saves a baseline; a later changed snapshot creates an alert.</p>')+
 '<p class="small">Hourly samples of the newest indexed page. This does not capture every launch between checks. Baselines and source errors are not alerts.</p>';
}catch{target.textContent='Verification receipts could not load. Retry shortly; this page does not mark a failed check as a success.';}
