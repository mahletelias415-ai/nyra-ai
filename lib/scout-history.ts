import {database} from './database.js';
import {BillingError} from './payment-core.mjs';
import {scoutSnapshot,scoutChanges} from './scout-history-core.mjs';

export async function scoutHistory(user:string,resultId:string){
 const db=database(),result=await db.prepare('SELECT r.*,m.title FROM nyra_scout_results r JOIN nyra_scout_missions m ON m.id=r.mission_id WHERE r.id=? AND r.user_id=? AND m.user_id=? AND m.deleted_at IS NULL').bind(resultId,user,user).first();
 if(!result)throw new BillingError(404,'This Scout result was not found.');
 const rows=await db.prepare('SELECT id,payload FROM nyra_scout_observations WHERE result_id=? AND user_id=? ORDER BY checked_at DESC,id DESC LIMIT 21').bind(resultId,user).all();
 const samples=rows.results.map(r=>({id:r.id,...JSON.parse(String(r.payload))}));
 if(!samples.length)samples.push({id:'baseline:'+result.id,...scoutSnapshot(JSON.parse(String(result.payload)),Number(result.checked_at))});
 const entries=samples.slice(0,20).map((x,i)=>({...x,changes:scoutChanges(samples[i+1]||null,x),conditionsChanged:!!samples[i+1]?.conditions&&!!x.conditions&&JSON.stringify(samples[i+1].conditions)!==JSON.stringify(x.conditions),baseline:!samples[i+1]}));
 return {resultId,missionTitle:result.title,address:result.address,entries,hasMore:rows.results.length>20,notice:'Saved checks, not continuous monitoring. Source times may precede a scan. Missing data is not a zero value.'};
}
