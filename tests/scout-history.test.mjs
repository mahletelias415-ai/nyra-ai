import test from 'node:test';
import assert from 'node:assert/strict';
import {scoutSnapshot,scoutChanges} from '../lib/scout-history-core.mjs';
import {scoutHistoryHTML} from '../public/scout-history.js';
const address='0x'+'1'.repeat(40),at=1795700000000;
function report(t=at){return {candidate:{address},decision:'matched',checks:[{label:'Liquidity',state:'pass',detail:'Measured'}],riskChecks:[{id:'lp',name:'LP lock',result:'unknown',reason:'Not measured',source:{at:t}}],evidence:{corbel:{source:'https://corbel.finance/api/token?q='+address,data:{token:address,example:false,market:{liquidity:10000},checks:[{id:'honeypot',result:'pass',value:{loss:.05},source:{at:t,partial:false}}]}},pons:{source:'https://ponsfamily.com/launchpad/'+address,readAt:new Date(t).toISOString(),data:{address,stage:'curve',progress:.25}}}};}
test('history compares dated values, including a real zero, and preserves source times',()=>{
 const a=scoutSnapshot(report(),at),r=report(at+10000);r.evidence.corbel.data.market.liquidity=0;r.evidence.pons.data.progress=.8;r.evidence.pons.data.stage='graduated';r.riskChecks[0].result='fail';
 const b=scoutSnapshot(r,at+10000),changes=scoutChanges(a,b);assert.equal(changes.find(x=>x.key==='liquidity').after.value,0);assert.equal(changes.find(x=>x.key==='progress').after.value,80);assert.equal(changes.find(x=>x.key==='stage').after.value,'graduated');assert.equal(changes.find(x=>x.key==='risk:lp').after,'fail');assert.equal(changes[0].before.at,at);assert.equal(changes[0].after.at,at+10000);
});
test('missing, partial or stale observations never become zero or a new comparable price',()=>{
 const a=scoutSnapshot(report(),at),r=report();r.evidence.corbel.data.market.liquidity=12000;
 assert.equal(scoutChanges(a,scoutSnapshot(r,at+100)).length,0,'same source time is not a new observation');
 const rounded=report(at+1000);rounded.evidence.corbel.data.market.liquidity=10000.00000001;assert.equal(scoutChanges(a,scoutSnapshot(rounded,at+1000)).length,0,'rounding noise must not look like a change');
 for(const mutate of [r=>r.evidence.corbel.data.example=true,r=>r.evidence.corbel.data.token='0x'+'2'.repeat(40),r=>r.evidence.corbel.data.checks[0].source.at=at-3600001]){const r=report();mutate(r);const b=scoutSnapshot(r,at);assert.equal(b.metrics.liquidity,null);assert.equal(scoutChanges(a,b).find(x=>x.key==='liquidity').kind,'unavailable');}
 const partial=report(at+1000);partial.evidence.corbel.data.checks[0].source.partial=true;assert.equal(scoutSnapshot(partial,at+1000).metrics.loss,null);
 assert.deepEqual(scoutChanges(null,a),[]);
});
test('history escapes external content and shows loss of evidence without a false zero',()=>{
 const a=scoutSnapshot(report(),at),b=scoutSnapshot({...report(at+1000),evidence:{}},at+1000);const html=scoutHistoryHTML({missionTitle:'<img src=x onerror=alert(1)>',notice:'Dated checks',hasMore:false,entries:[{...b,changes:scoutChanges(a,b),baseline:false},{...a,changes:[],baseline:true}]});assert(!html.includes('<img'));assert(html.includes('&lt;img'));assert(html.includes('Could not recheck'));assert(html.includes('$10,000'));assert(!html.includes('$0.00'));assert(html.includes('First saved check'));
});
