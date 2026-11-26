import{createClient}from'@libsql/client';import{readFile,readdir}from'node:fs/promises';
if(!process.env.TURSO_DATABASE_URL)throw Error('TURSO_DATABASE_URL is required.');
const db=createClient({url:process.env.TURSO_DATABASE_URL,authToken:process.env.TURSO_AUTH_TOKEN});
await db.execute('CREATE TABLE IF NOT EXISTS nyra_migrations (name TEXT PRIMARY KEY,applied_at INTEGER NOT NULL)');
for(const file of(await readdir('drizzle')).filter(x=>x.endsWith('.sql')).sort()){
 const exists=await db.execute({sql:'SELECT name FROM nyra_migrations WHERE name=?',args:[file]});if(exists.rows.length)continue;
 const statements=(await readFile('drizzle/'+file,'utf8')).split('--> statement-breakpoint').map(x=>x.trim()).filter(Boolean);
 await db.batch([...statements,{sql:'INSERT INTO nyra_migrations (name,applied_at) VALUES (?,?)',args:[file,Date.now()]}],'write');console.log('Applied '+file);
}
await db.close();
