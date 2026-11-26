import { createClient, type Client, type InValue } from '@libsql/client';
let client:Client|undefined;
export function sqlClient(){if(!client){if(!process.env.TURSO_DATABASE_URL)throw Error('Server storage is not configured.');client=createClient({url:process.env.TURSO_DATABASE_URL,authToken:process.env.TURSO_AUTH_TOKEN});}return client;}
class Statement {
 constructor(public sql:string,public args:InValue[]=[]){ }
 bind(...args:InValue[]){return new Statement(this.sql,args);}
 async all<T=Record<string,any>>(){const r=await sqlClient().execute(this);return {results:r.rows as unknown as T[],meta:{changes:r.rowsAffected}};}
 async first<T=Record<string,any>>(){const r=await this.all<T>();return r.results[0]??null;}
 async run(){return this.all();}
}
const adapter={prepare:(sql:string)=>new Statement(sql),batch:async(statements:Statement[])=>{const rows=await sqlClient().batch(statements,'write');return rows.map(r=>({results:r.rows,meta:{changes:r.rowsAffected}}));}};
export const database=()=>adapter;
