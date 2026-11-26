import { randomBytes,createHash,timingSafeEqual } from 'node:crypto';
import {createPublicClient,http,isAddress,getAddress} from 'viem';
import {database} from './database.js';
const hash=(s:string)=>createHash('sha256').update(s).digest('hex');
const token=()=>randomBytes(32).toString('hex');
const cookieName=(r:Request)=>new URL(r.url).protocol==='https:'?'__Host-nyra-session':'nyra-session';
const challengeName=(r:Request)=>new URL(r.url).protocol==='https:'?'__Host-nyra-challenge':'nyra-challenge';
const cookies=(r:Request)=>Object.fromEntries((r.headers.get('cookie')||'').split(';').map(v=>{const i=v.indexOf('=');return i<0?['','']:[v.slice(0,i).trim(),v.slice(i+1).trim()];}));
const cookie=(r:Request,name:string,value:string,age:number)=>`${name}=${value}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${age}${new URL(r.url).protocol==='https:'?'; Secure':''}`;
export function sameOrigin(r:Request){return r.headers.get('origin')===new URL(r.url).origin;}
export async function sessionUser(r:Request){const value=cookies(r)[cookieName(r)];if(!value||!/^[a-f0-9]{64}$/.test(value))return null;const row=await database().prepare('SELECT user_id FROM nyra_sessions WHERE token_hash=? AND expires_at>?').bind(hash(value),Date.now()).first();return row?.user_id as string||null;}
export function serviceAuthorized(r:Request){const expected=process.env.CRON_SECRET,actual=r.headers.get('authorization')?.replace(/^Bearer /,'');if(!expected||!actual)return false;const a=Buffer.from(expected),b=Buffer.from(actual);return a.length===b.length&&timingSafeEqual(a,b);}
async function rate(key:string,limit:number,window:number){const t=Date.now(),bucket=Math.floor(t/window);const r=await database().prepare('INSERT INTO nyra_rate_limits (key,bucket,count) VALUES (?,?,1) ON CONFLICT(key,bucket) DO UPDATE SET count=count+1 RETURNING count').bind(key,bucket).first();return Number(r?.count)<=limit;}
export async function authHandler(r:Request){
 const path=new URL(r.url).pathname,db=database();
 if(r.method!=='POST')return Response.json({error:'Use POST.'},{status:405});
 if(!sameOrigin(r))return Response.json({error:'Open this action from Nyra.'},{status:403});
 const raw=await r.text();if(raw.length>4000)return Response.json({error:'This request is too large.'},{status:413});
 let data:any;try{data=JSON.parse(raw);}catch{return Response.json({error:'Send a valid JSON request.'},{status:400});}
 if(path==='/api/auth/logout') {const value=cookies(r)[cookieName(r)];if(value)await db.prepare('DELETE FROM nyra_sessions WHERE token_hash=?').bind(hash(value)).run();return Response.json({signedIn:false},{headers:{'Set-Cookie':cookie(r,cookieName(r),'',0)}});}
 const ip=r.headers.get('x-vercel-forwarded-for')||r.headers.get('x-forwarded-for')||'unknown';
 if(!await rate('auth:'+hash(ip),30,600000))return Response.json({error:'Too many sign-in attempts. Try again in a few minutes.'},{status:429});
 if(path==='/api/auth/challenge'){
  if(!isAddress(data.address||''))return Response.json({error:'Choose a valid wallet address.'},{status:400});
  const address=getAddress(data.address),id=crypto.randomUUID(),binding=token(),t=Date.now(),expires=t+300000,url=new URL(r.url);
  const message=`${url.host} wants you to sign in with your Ethereum account:\n${address}\n\nSign in to Nyra AI. Read-only research and saved watches. No transaction or token approval.\n\nURI: ${url.origin}\nVersion: 1\nChain ID: 4663\nNonce: ${token()}\nIssued At: ${new Date(t).toISOString()}\nExpiration Time: ${new Date(expires).toISOString()}`;
  const old=cookies(r)[challengeName(r)];if(old)await db.prepare('DELETE FROM nyra_login_challenges WHERE binding_hash=?').bind(hash(old)).run();
  await db.prepare('INSERT INTO nyra_login_challenges (id,address,message,binding_hash,origin,expires_at) VALUES (?,?,?,?,?,?)').bind(id,address.toLowerCase(),message,hash(binding),url.origin,expires).run();
  return Response.json({id,address,message,expiresAt:expires},{headers:{'Set-Cookie':cookie(r,challengeName(r),binding,300),'Cache-Control':'no-store'}});
 }
 if(path==='/api/auth/verify'){
  const binding=cookies(r)[challengeName(r)];if(!binding)return Response.json({error:'Start a fresh sign-in request.'},{status:409});
  const c=await db.prepare('SELECT * FROM nyra_login_challenges WHERE id=? AND binding_hash=? AND origin=? AND used_at IS NULL AND expires_at>?').bind(String(data.id),hash(binding),new URL(r.url).origin,Date.now()).first();
  if(!c)return Response.json({error:'This sign-in request expired or was already used.'},{status:409});
  let valid=false;try{valid=await createPublicClient({transport:http('https://rpc.mainnet.chain.robinhood.com',{timeout:10000,retryCount:1})}).verifyMessage({address:c.address as `0x${string}`,message:c.message as string,signature:String(data.signature) as `0x${string}`});}catch{}
  if(!valid)return Response.json({error:'The signature does not match this sign-in request.'},{status:400});
  const t=Date.now(),session=token(),uid='wallet:'+c.address;
  const consumed=await db.prepare('UPDATE nyra_login_challenges SET used_at=? WHERE id=? AND used_at IS NULL AND expires_at>? RETURNING id').bind(t,c.id as string,t).first();
  if(!consumed)return Response.json({error:'This sign-in request was already used.'},{status:409});
  await db.batch([db.prepare('INSERT INTO nyra_profiles (user_id,wallet,wallet_verified_at,created_at) VALUES (?,?,?,?) ON CONFLICT(user_id) DO UPDATE SET wallet=excluded.wallet,wallet_verified_at=excluded.wallet_verified_at').bind(uid,c.address as string,t,t),db.prepare('INSERT INTO nyra_sessions (token_hash,user_id,created_at,expires_at) VALUES (?,?,?,?)').bind(hash(session),uid,t,t+7*86400000)]);
  return Response.json({wallet:c.address,verifiedAt:t},{headers:{'Set-Cookie':cookie(r,cookieName(r),session,7*86400),'Cache-Control':'no-store'}});
 }
 return Response.json({error:'This action was not found.'},{status:404});
}
