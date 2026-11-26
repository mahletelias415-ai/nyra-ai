const number=n=>typeof n==='number'&&Number.isFinite(n);
const fresh=(time,now,age)=>number(time)&&time<=now+30000&&now-time<=age;
const parsed=time=>Date.parse(time||'');
const field=(value,at,source)=>({value:typeof value==='number'?Number(value.toFixed(2)):value,at,source});

// Keep dated observations, not the latest feed's undated marketing fields.
export function scoutSnapshot(report,checkedAt){
 const e=report.evidence||{},c=report.candidate||{},r=e.corbel?.data,p=e.pons?.data,h=e.hey?.data;
 const address=String(c.address||'').toLowerCase(),checks=r?.checks;
 const corbel=!!address&&r?.token?.toLowerCase()===address&&r.example===false&&Array.isArray(checks)&&checks.length>0&&checks.every(x=>fresh(x.source?.at,checkedAt,3600000));
 const corbelAt=corbel?Math.min(...checks.map(x=>x.source.at)):null;
 const pons=!!address&&p?.address?.toLowerCase()===address&&fresh(parsed(e.pons.readAt),checkedAt,3600000);
 const hey=!!address&&h?.chain_id===4663&&h.contract_address?.toLowerCase()===address&&fresh(parsed(h.as_of),checkedAt,86400000);
 const simulation=corbel?checks.find(x=>x.id==='honeypot'&&!x.source.partial):null;
 const metrics={
  liquidity:corbel&&number(r.market?.liquidity)&&r.market.liquidity>=0?field(r.market.liquidity,corbelAt,e.corbel.source):null,
  progress:pons&&number(p.progress)&&p.progress>=0&&p.progress<=1?field(p.progress*100,parsed(e.pons.readAt),e.pons.source):null,
  stage:pons&&['curve','graduated','dex'].includes(p.stage)?field(p.stage,parsed(e.pons.readAt),e.pons.source):null,
  loss:simulation&&number(simulation.value?.loss)&&simulation.value.loss>=0?field(simulation.value.loss*100,simulation.source.at,e.corbel.source):null,
  update:hey&&h.activity_measured===true&&fresh(parsed(h.latest_meaningful_ship?.timestamp),checkedAt,90*86400000)?field(h.latest_meaningful_ship.timestamp,parsed(h.as_of),e.hey.source):null,
 };
 return {checkedAt,decision:report.decision,conditions:report.conditions||null,metrics,checks:(report.checks||[]).map(x=>({label:x.label,state:x.state,detail:x.detail})),riskChecks:(report.riskChecks||[]).map(x=>({id:x.id,label:x.name,state:x.result,detail:x.reason,at:x.source?.at||null,source:e.corbel?.source||null}))};
}

export const HISTORY_LABELS={liquidity:'Liquidity',progress:'Curve progress',stage:'Launch stage',loss:'Simulated round-trip loss',update:'Meaningful update'};
export function scoutChanges(previous,current){
 if(!previous)return [];
 const changes=[];
 for(const[key,label]of Object.entries(HISTORY_LABELS)){
  const a=previous.metrics[key],b=current.metrics[key];
  if(a&&!b)changes.push({key,label,kind:'unavailable',before:a,after:null});
  else if(!a&&b)changes.push({key,label,kind:'available',before:null,after:b});
  else if(a&&b&&b.at>a.at&&a.value!==b.value)changes.push({key,label,kind:'changed',before:a,after:b});
 }
 if(JSON.stringify(previous.conditions)===JSON.stringify(current.conditions))for(const b of current.checks){const a=previous.checks.find(x=>x.label===b.label);if(a&&a.state!==b.state)changes.push({key:'check:'+b.label,label:b.label,kind:'check',before:a.state,after:b.state,detail:b.detail});}
 for(const b of current.riskChecks){const a=previous.riskChecks.find(x=>x.id===b.id);if(a&&a.state!==b.state&&b.at>a.at)changes.push({key:'risk:'+b.id,label:b.label,kind:'risk',before:a.state,after:b.state,detail:b.detail,source:b.source});}
 return changes;
}
