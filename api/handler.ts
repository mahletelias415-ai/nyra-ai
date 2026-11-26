import type { IncomingMessage, ServerResponse } from 'node:http';
import { apiHandler, mcpHandler } from '../lib/tools.mjs';
import { workspaceHandler } from '../lib/workspace-service.js';
import { authHandler } from '../lib/auth.js';
export async function webHandler(r:Request):Promise<Response>{
 const p=new URL(r.url).pathname;
 if(p==='/api/health')return Response.json({name:'Nyra AI',status:'ok',chainId:4663});
 if(p.startsWith('/api/auth/'))return authHandler(r);
 if(p==='/mcp'||p==='/api/mcp'){if(r.method==='GET')return Response.json({name:'Nyra AI',transport:'stateless JSON-RPC POST',tools:'/api/tools'});return mcpHandler(r);}
 if(['/api/read','/api/tools'].includes(p))return apiHandler(r);
 return workspaceHandler(r);
}
export default async function handler(req:IncomingMessage,res:ServerResponse){
 try{
  const host=String(req.headers.host||''),origin='https://'+host;
  const allowed=[process.env.APP_ORIGIN,process.env.VERCEL_URL&&'https://'+process.env.VERCEL_URL,process.env.VERCEL_PROJECT_PRODUCTION_URL&&'https://'+process.env.VERCEL_PROJECT_PRODUCTION_URL].filter(Boolean);
  if(!allowed.includes(origin)){res.writeHead(400);res.end('Use the Nyra application URL.');return;}
  const headers=new Headers();for(const[k,v]of Object.entries(req.headers))if(v&&!k.startsWith('oai-'))headers.set(k,Array.isArray(v)?v.join(','):v);
  const chunks:Buffer[]=[];let length=0;for await(const c of req){length+=c.length;if(length>16000){res.writeHead(413);res.end('Request is too large.');return;}chunks.push(c);}
  const r=new Request(origin+(req.url||'/'),{method:req.method,headers,body:['GET','HEAD'].includes(req.method||'GET')?undefined:Buffer.concat(chunks)});
  const result=await webHandler(r);result.headers.set('Cache-Control','no-store');result.headers.forEach((v,k)=>res.setHeader(k,v));res.statusCode=result.status;res.end(Buffer.from(await result.arrayBuffer()));
 }catch(e){console.error('Nyra request failed:',e instanceof Error?e.name:'unknown');res.writeHead(503,{'Content-Type':'application/json','Cache-Control':'no-store'});res.end(JSON.stringify({error:'Nyra could not complete this request. Your saved data is preserved; retry shortly.'}));}
}
