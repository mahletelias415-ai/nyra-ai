import {scoutSnapshot,scoutChanges} from './scout-history-core.mjs';
export const DAY=86400000;
export function nextScoutBriefAt(after,hour){const d=new Date(after),at=Date.UTC(d.getUTCFullYear(),d.getUTCMonth(),d.getUTCDate(),hour);return at>after?at:at+DAY;}
function display(key,v){if(!v)return 'unavailable';const n=v.value;if(key==='liquidity')return '$'+Number(n).toLocaleString('en-US',{maximumFractionDigits:2});if(['progress','loss'].includes(key))return Number(n).toLocaleString('en-US',{maximumFractionDigits:2})+'%';if(key==='update')return new Date(n).toISOString();return String(n);}
function summary(c){if(c.kind==='unavailable')return c.label+': could not recheck (previously '+display(c.key,c.before)+')';if(c.kind==='available')return c.label+': now available, '+display(c.key,c.after);if(c.kind==='changed')return c.label+': '+display(c.key,c.before)+' → '+display(c.key,c.after);return c.label+': '+c.before+' → '+c.after;}
export function makeScoutBrief(rows,from,to,{truncated=false,missionCount=0,runs=0,failedRuns=0}={}){
 const matches=[],changes=[],gaps=[];
 for(const r of rows){
  const report=JSON.parse(r.payload),snapshot=scoutSnapshot(report,Number(r.checked_at)),previous=r.baseline?JSON.parse(r.baseline):null;
  const candidate=report.candidate,base={resultId:r.id,missionId:r.mission_id,missionTitle:r.title,candidate,checkedAt:Number(r.checked_at),sources:[report.evidence?.corbel?.source,report.evidence?.hey?.source,report.evidence?.repo?.source].filter(Boolean)};
  const outdated=Number(r.conditions_revision)!==Number(r.current_revision),firstMatch=Math.min(...[r.first_match_at,r.notified_at].filter(x=>x!==null&&x!==undefined).map(Number));
  if(!outdated&&report.decision==='matched'&&Number.isFinite(firstMatch)&&firstMatch>=from&&firstMatch<=to)matches.push({...base,liquidity:snapshot.metrics.liquidity,warnings:(report.riskChecks||[]).filter(x=>x.result!=='pass').map(x=>({label:x.name,state:x.result,detail:x.reason})).slice(0,3)});
  const comparable=previous&&previous.checkedAt<snapshot.checkedAt;
  if(comparable){const delta=scoutChanges(previous,snapshot),criteriaChanged=!!previous.conditions&&!!snapshot.conditions&&JSON.stringify(previous.conditions)!==JSON.stringify(snapshot.conditions);if(delta.length||criteriaChanged)changes.push({...base,from:previous.checkedAt,conditionsChanged:criteriaChanged,changes:delta.map(c=>({...c,summary:summary(c)}))});}
  const unknown=report.checks?.filter(x=>x.state==='unknown')||[];
  if(outdated||report.decision==='unknown'||unknown.length)gaps.push({...base,reason:outdated?'Search conditions changed; awaiting a new check.':unknown.map(x=>x.label+': '+x.detail).join(' · ')||'Required evidence is unavailable.',outdated});
 }
 return {from,to,missionCount,checkedResults:rows.length,runs,failedRuns,truncated,matches,changes,gaps,notice:'Your saved Scout checks for this period. New means first recorded match for a mission. Source observations may be older than a check. Missing data is not zero. A match is not a recommendation or an audit.'};
}
export function scoutBriefTelegram(p){
 const b=p.brief||p,at=t=>new Date(t).toISOString().replace('T',' ').slice(0,16)+' UTC',name=x=>(x.candidate.name+' ('+x.candidate.symbol+')').slice(0,100);
 const lines=['Nyra · Scout brief',at(b.from)+' → '+at(b.to),`${b.checkedResults}${b.truncated?'+':''} saved results · ${b.matches.length} first recorded matches · ${b.changes.length} with changes · ${b.gaps.length} need evidence`];
 if(b.matches.length){lines.push('','First recorded matches');for(const m of b.matches.slice(0,3)){lines.push(name(m),m.candidate.address,...m.warnings.slice(0,2).map(w=>'• '+w.label+': '+w.state));}}
 if(b.changes.length){lines.push('','What changed');for(const c of b.changes.slice(0,3)){lines.push(name(c),...c.changes.slice(0,2).map(x=>'• '+x.summary),...(c.conditionsChanged?['• Search filters changed between checks.']:[]));}}
 if(b.gaps.length){lines.push('','Needs another check');for(const g of b.gaps.slice(0,2))lines.push(name(g)+': '+g.reason.slice(0,180));}
 if(!b.checkedResults)lines.push('',b.missionCount?'No saved project checks in this period. Your missions stay saved.':'No saved Scout missions yet. Describe a search here to prepare one.');
 if(b.failedRuns)lines.push('',b.failedRuns+' scan(s) failed or had incomplete coverage.');
 if(b.truncated)lines.push('','Coverage limited to the 100 most recently checked results.');
 lines.push('','Full brief and dated sources: https://nyraagent.online/#scout-brief','Search results, not a buy recommendation.');return lines.join('\n').slice(0,3800);
}
