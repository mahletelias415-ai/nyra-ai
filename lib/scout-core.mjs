export const SCOUT_PRESETS={
 builders:{requireRepo:true,requireOfficial:true,recentDays:7,minLiquidity:1000,maxCreatorLaunches:3,maxLoss:15,stage:'any',minProgress:0,maxAgeDays:null,excludeCopies:false},
 liquid:{requireRepo:false,requireOfficial:false,recentDays:null,minLiquidity:5000,maxCreatorLaunches:3,maxLoss:10,stage:'any',minProgress:0,maxAgeDays:null,excludeCopies:false},
};
export function scoutConditions(input={}){
 const allowed=new Set(Object.keys(SCOUT_PRESETS.builders));
 if(!input||typeof input!=='object'||Array.isArray(input)||Object.keys(input).some(k=>!allowed.has(k)))throw Error('Choose supported Scout conditions.');
 const out={...SCOUT_PRESETS.builders,...input};
 for(const k of ['requireRepo','requireOfficial','excludeCopies'])if(typeof out[k]!=='boolean')throw Error('Choose a valid '+k+' condition.');
 for(const [k,max,nullable] of [['recentDays',90,true],['minLiquidity',100000000,false],['maxCreatorLaunches',1000,true],['maxLoss',100,true],['minProgress',100,false],['maxAgeDays',30,true]]){
  if(out[k]===null&&nullable)continue;
  if(typeof out[k]!=='number'||!Number.isFinite(out[k])||out[k]<0||out[k]>max||(['recentDays','maxAgeDays','maxCreatorLaunches'].includes(k)&&(!Number.isInteger(out[k])||out[k]<1)))throw Error('Choose a valid '+k+' condition.');
 }
 if(!['any','curve','graduated'].includes(out.stage))throw Error('Choose a supported launch stage.');
 return out;
}
export function scoutRepo(value){if(typeof value!=='string')return null;const m=value.match(/^https:\/\/github\.com\/([a-z0-9_.-]{1,100})\/([a-z0-9_.-]{1,100})\/?$/i);return m?m[1]+'/'+m[2].replace(/\.git$/i,''):null;}
export function conditionsText(c){return [c.requireRepo&&'Public GitHub repository',c.requireOfficial&&'Project names this contract (HEY)',c.recentDays!==null&&'Meaningful update within '+c.recentDays+' days (HEY)',c.minLiquidity>0&&'Liquidity at least $'+c.minLiquidity.toLocaleString('en-US'),c.maxCreatorLaunches!==null&&'Creator: at most '+c.maxCreatorLaunches+' recorded launches',c.maxLoss!==null&&'Simulated round-trip loss at most '+c.maxLoss+'%',c.stage!=='any'&&'Pons stage: '+c.stage,c.minProgress>0&&'Curve progress at least '+c.minProgress+'%',c.maxAgeDays!==null&&'Pons launch age at most '+c.maxAgeDays+' days',c.excludeCopies&&'No other indexed contract with this ticker'].filter(Boolean);}
const known=n=>typeof n==='number'&&Number.isFinite(n);
const recent=(time,at,age)=>Number.isFinite(Date.parse(time))&&at-Date.parse(time)>=-30000&&at-Date.parse(time)<=age;
export function evaluateScout(candidate,conditions,evidence,at=Date.now()){
 const c=scoutConditions(conditions),checks=[],h=evidence.hey?.data,r=evidence.corbel?.data;
 const heyFresh=h&&recent(h.as_of,at,86400000)&&h.chain_id===4663&&h.contract_address?.toLowerCase()===candidate.address.toLowerCase();
 const sourceChecks=r?.checks;
 const reportFresh=r&&r.example===false&&r.token?.toLowerCase()===candidate.address.toLowerCase()&&Array.isArray(sourceChecks)&&sourceChecks.length>0&&sourceChecks.every(x=>x.source&&known(x.source.at)&&at-x.source.at>=-30000&&at-x.source.at<3600000);
 const condition=(label,knownValue,passed,detail)=>checks.push({label,state:!knownValue?'unknown':passed?'pass':'fail',detail});
 condition('Token checks available',!!reportFresh,!!reportFresh,reportFresh?'Corbel report with dated source observations.':'Token checks are unavailable, stale or do not identify this contract.');
 if(c.requireRepo){const name=scoutRepo(h?.repo_url),repo=evidence.repo?.data,fresh=evidence.repo&&recent(evidence.repo.readAt,at,86400000);condition('Public repository',!!heyFresh&&(!name||!!fresh),!!name&&fresh&&repo?.private===false&&repo.full_name?.toLowerCase()===name.toLowerCase(),fresh&&repo?.private===false?h.repo_url+' · public on GitHub':name?'The repository could not be confirmed public on GitHub.':'No accepted repository recorded by HEY.');}
 if(c.requireOfficial)condition('Published contract',!!heyFresh,h?.activity_applies_to_token===true&&h?.token_verification==='VERIFIED','HEY project-to-contract evidence; not a token safety verdict.');
 if(c.recentDays!==null){const ship=h?.latest_meaningful_ship;condition('Recent meaningful update',!!heyFresh&&h?.activity_measured===true&&h?.meaningful_ships_30d!==null&&!!ship?.timestamp,recent(ship?.timestamp,at,c.recentDays*86400000),ship?.title||'No dated meaningful update recorded.');}
 const find=id=>reportFresh?sourceChecks.find(x=>x.id===id):null,creator=find('creator'),sim=find('honeypot'),ticker=find('ticker');
 if(c.minLiquidity>0)condition('Liquidity',reportFresh&&known(r?.market?.liquidity),r?.market?.liquidity>=c.minLiquidity,known(r?.market?.liquidity)?'$'+r.market.liquidity.toLocaleString('en-US'):'Liquidity was not measured.');
 if(c.maxCreatorLaunches!==null)condition('Creator launch history',!!creator&&!creator.source.partial&&known(creator.value?.launches),creator?.value?.launches<=c.maxCreatorLaunches,creator?.reason||'Creator history was not measured.');
 if(c.maxLoss!==null)condition('Buy / sell simulation',!!sim&&!sim.source.partial&&known(sim.value?.loss),sim?.result!=='fail'&&sim?.value?.loss*100<=c.maxLoss,sim?.reason||'A round-trip simulation was not available.');
 if(c.excludeCopies)condition('Ticker collisions',!!ticker&&!ticker.source.partial&&['pass','warn','fail'].includes(ticker.result),ticker?.result==='pass',ticker?.reason||'Ticker collisions were not measured.');
 const p=evidence.pons?.data,ponsFresh=p&&p.address?.toLowerCase()===candidate.address.toLowerCase()&&recent(evidence.pons.readAt,at,3600000);
 if(c.stage!=='any')condition('Launch stage',!!ponsFresh&&typeof p.stage==='string',c.stage==='curve'?p?.stage==='curve':['graduated','dex'].includes(p?.stage),p?.stage||'Pons did not return a stage.');
 if(c.minProgress>0)condition('Curve progress',!!ponsFresh&&known(p.progress),p?.progress*100>=c.minProgress,known(p?.progress)?(p.progress*100).toFixed(2)+'%':'Pons did not return curve progress.');
 if(c.maxAgeDays!==null)condition('Launch age',!!ponsFresh&&known(p.createdAt),p?.createdAt*1000<=at+30000&&at-p.createdAt*1000<=c.maxAgeDays*86400000,'Uses the Pons launch time, not the date Nyra discovered it.');
 const decision=checks.some(x=>x.state==='fail')?'rejected':checks.some(x=>x.state==='unknown')?'unknown':'matched';
 return {candidate,decision,checks,riskChecks:reportFresh?sourceChecks.map(x=>({id:x.id,name:x.name,result:x.result,reason:x.reason,metric:x.metric||null,source:x.source})):[],evidence,checkedAt:new Date(at).toISOString(),notice:'A match meets your search conditions. It is not a recommendation or a security audit. Unknown token checks stay unknown.'};
}
export function scoutTelegram(payload){
 const report=payload.report,c=report.candidate,pass=report.checks.filter(x=>x.state==='pass').map(x=>'• '+x.label+': '+x.detail),warnings=report.riskChecks.filter(x=>x.result!=='pass').slice(0,3).map(x=>'• '+x.name+' — '+x.result+': '+x.reason);
 return ['Nyra · Scout match',payload.title,c.name+' ('+c.symbol+')',c.address,'Matched at '+report.checkedAt,'',...pass,...(warnings.length?['','Other findings:',...warnings]:[]),'','Evidence: https://nyraagent.online/#scout','Corbel: https://corbel.finance/api/token?q='+c.address,...(/^https:\/\/heyresearch\.xyz\/project\/[a-z0-9-]+$/.test(report.evidence.hey?.data?.hey_project_url||'')?['HEY: '+report.evidence.hey.data.hey_project_url]:[]),'','Conditions matched; not a buy recommendation.'].join('\n').slice(0,3800);
}
