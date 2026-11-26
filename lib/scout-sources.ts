import {scoutRepo} from './scout-core.mjs';
import {database} from './database.js';
type Data=Record<string,any>;
const address=(s:unknown)=>typeof s==='string'&&/^0x[0-9a-f]{40}$/i.test(s)?s.toLowerCase():null;
export async function scoutJson(url:string,deadline:number,ttl=600000):Promise<Data>{
 const db=database(),old=await db.prepare('SELECT payload FROM nyra_scout_cache WHERE key=? AND expires_at>?').bind(url,Date.now()).first();
 if(old)return JSON.parse(String(old.payload));
 const left=deadline-Date.now()-500;if(left<500)throw Error('Source check deferred.');
 const r=await fetch(url,{redirect:'error',signal:AbortSignal.timeout(Math.min(25000,left)),headers:{accept:'application/json','User-Agent':'Nyra-Scout/1.0'}});
 if(r.status!==404&&!r.ok)throw Error('The source could not be read.');
 const raw=await r.text();if(raw.length>2000000)throw Error('The source response was too large.');
 const data=r.status===404?{notFound:true}:JSON.parse(raw),value={data,readAt:new Date().toISOString(),source:url};
 await db.prepare('INSERT INTO nyra_scout_cache(key,payload,expires_at) VALUES(?,?,?) ON CONFLICT(key) DO UPDATE SET payload=excluded.payload,expires_at=excluded.expires_at').bind(url,JSON.stringify(value),Date.now()+ttl).run();
 return value;
}
export async function discoverScout(deadline:number){
 const candidates=new Map<string,Data>(),sources:Data[]=[],errors:string[]=[];
 const add=(v:Data)=>{const a=address(v.address);if(!a)return;const prior=candidates.get(a);candidates.set(a,{...prior,...v,address:a,priority:Math.max(prior?.priority||0,v.priority||0),payload:{...prior?.payload,...v.payload}});};
 await Promise.all([
  (async()=>{try{let cursor='';for(let page=0;page<2;page++){
   const url='https://ponsfamily.com/api/launches?sort=newest&limit=40'+(cursor?'&cursor='+encodeURIComponent(cursor):'');
   const value=await scoutJson(url,deadline,300000),d=value.data;if(!Array.isArray(d.items))throw Error();
   sources.push({name:'Pons',url,readAt:value.readAt,rows:d.items.length});
   for(const x of d.items)add({address:x.address,name:x.name||'',symbol:x.symbol||'',priority:x.socials?.website?1:0,payload:{pons:x,ponsReadAt:value.readAt,ponsSource:url}});
   if(!d.nextCursor||typeof d.nextCursor!=='string'||d.nextCursor===cursor)break;cursor=d.nextCursor;
  }}catch{errors.push('Pons discovery is incomplete.');}})(),
  (async()=>{try{const url='https://corbel.finance/api/radar?limit=40',value=await scoutJson(url,deadline,300000);if(!Array.isArray(value.data.rows))throw Error();
   sources.push({name:'Corbel pool index',url,readAt:value.readAt,rows:value.data.rows.length});
   for(const x of value.data.rows)add({address:x.token,name:x.name||'',symbol:x.symbol||'',priority:0,payload:{radar:x}});
  }catch{errors.push('Corbel pool discovery is incomplete.');}})(),
  (async()=>{try{let cursor='';const items:Data[]=[];for(let page=0;page<2;page++){const url='https://heyresearch.xyz/api/changes?limit=50'+(cursor?'&cursor='+encodeURIComponent(cursor):''),value=await scoutJson(url,deadline,300000);if(!Array.isArray(value.data.items))throw Error();
   sources.push({name:'HEY change feed',url,readAt:value.readAt,rows:value.data.items.length});items.push(...value.data.items);if(!value.data.nextCursor||typeof value.data.nextCursor!=='string'||value.data.nextCursor===cursor)break;cursor=value.data.nextCursor;}
   const slugs=[...new Set(items.filter((x:Data)=>x.domain==='build'&&['build.release','build.ship','build.code_activity'].includes(x.type)).map((x:Data)=>x.project?.slug).filter((x:any)=>typeof x==='string'&&/^[a-z0-9-]{1,150}$/.test(x)))].slice(0,16) as string[];
   for(let i=0;i<slugs.length;i+=3)await Promise.all(slugs.slice(i,i+3).map(async slug=>{try{
    const u='https://heyresearch.xyz/api/projects/'+slug+'/snapshot',s=await scoutJson(u,deadline),id=s.data.identity;
    if(id?.token?.chainId!==4663)return;
    add({address:id.token.contractAddress,name:id.name||'',symbol:id.symbol||'',priority:2,payload:{fromHey:true,heySlug:slug,heySnapshotSource:u}});
   }catch{errors.push('A HEY project snapshot was unavailable.');}}));
  }catch{errors.push('HEY builder discovery is incomplete.');}})()
 ]);
 const db=database(),now=Date.now();
 const rows=[...candidates.values()];
 if(rows.length)await db.batch(rows.map(c=>db.prepare('INSERT INTO nyra_scout_candidates(address,name,symbol,priority,payload,discovered_at,last_seen) VALUES(?,?,?,?,?,?,?) ON CONFLICT(address) DO UPDATE SET name=CASE WHEN excluded.name=\'\' THEN nyra_scout_candidates.name ELSE excluded.name END,symbol=CASE WHEN excluded.symbol=\'\' THEN nyra_scout_candidates.symbol ELSE excluded.symbol END,priority=MAX(nyra_scout_candidates.priority,excluded.priority),payload=json_patch(nyra_scout_candidates.payload,excluded.payload),last_seen=excluded.last_seen').bind(c.address,String(c.name).slice(0,150),String(c.symbol).slice(0,50),c.priority,JSON.stringify(c.payload),now,now)));
 return {sources,errors,candidates:rows.length,notice:'Bounded indexed feeds, not every RH launch. Each scan rotates through registry candidates seen in the last 30 days.'};
}
export async function scoutEvidence(c:Data,conditions:Data,deadline:number){
 const a=address(c.address);if(!a)throw Error('Invalid candidate address.');
 const out:Data={};
 try{out.hey=await scoutJson('https://heyresearch.xyz/api/v1/builder?chain=4663&token='+a,deadline);}catch{out.heyError='HEY could not be read.';}
 const p=c.payload?.pons;
 if(p&&Date.now()-Date.parse(c.payload.ponsReadAt)<3600000)out.pons={data:p,source:c.payload.ponsSource,readAt:c.payload.ponsReadAt};
 if((conditions.stage!=='any'||conditions.minProgress>0||conditions.maxAgeDays!==null)&&!out.pons)try{out.pons=await scoutJson('https://ponsfamily.com/api/launches/'+a,deadline);}catch{out.ponsError='Pons launch details could not be read.';}
 // Do not spend an expensive simulation on a candidate whose required builder data is absent.
 if((conditions.requireRepo||conditions.requireOfficial||conditions.recentDays!==null)&&(!out.hey?.data||out.hey.data.notFound))return out;
 if(conditions.requireRepo){const repo=scoutRepo(out.hey?.data?.repo_url);if(!repo)return out;try{out.repo=await scoutJson('https://api.github.com/repos/'+repo.split('/').map(encodeURIComponent).join('/'),deadline,3600000);}catch{out.repoError='GitHub could not confirm a public repository.';}}
 if(conditions.requireOfficial&&out.hey?.data?.activity_applies_to_token!==true)return out;
 try{out.corbel=await scoutJson('https://corbel.finance/api/token?q='+a,deadline);}catch{out.corbelError='Corbel token checks could not be read.';}
 return out;
}
