import {AsyncLocalStorage} from 'node:async_hooks';
import {mkdirSync,readFileSync} from 'node:fs';
import path from 'node:path';

// The application uses one async interface for local SQLite and hosted PostgreSQL.
export async function openDatabase(root,data){
 const context=new AsyncLocalStorage();
 if(!process.env.DATABASE_URL){
  if(process.env.RENDER==='true')throw new Error('DATABASE_URL is required on Render. Refusing to store business data on an ephemeral disk.');
  const {DatabaseSync}=await import('node:sqlite');mkdirSync(data,{recursive:true});
  const sqlite=new DatabaseSync(path.join(data,'shoplink.sqlite'));
  sqlite.exec('PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000;');sqlite.exec(readFileSync(path.join(root,'server/schema.sql'),'utf8'));
  let pending=Promise.resolve();
  const exclusive=fn=>{const result=pending.then(fn);pending=result.catch(()=>{});return result};
  return {
   prepare(sql){return Object.fromEntries(['get','all','run'].map(method=>[method,(...args)=>context.getStore()?Promise.resolve(sqlite.prepare(sql)[method](...args)):exclusive(()=>sqlite.prepare(sql)[method](...args))]))},
   transaction(fn){if(context.getStore())return fn();return exclusive(()=>context.run(true,async()=>{sqlite.exec('BEGIN IMMEDIATE');try{const result=await fn();sqlite.exec('COMMIT');return result}catch(e){sqlite.exec('ROLLBACK');throw e}}))},
   close(){sqlite.close()},kind:'sqlite'
  };
 }
 const {Pool}=await import('pg');
 const connection=new URL(process.env.DATABASE_URL);
 // Avoid connection-string options silently overriding certificate verification.
 for(const key of ['sslmode','sslcert','sslkey','sslrootcert'])connection.searchParams.delete(key);
 const ca=process.env.PG_CA_CERT?.replace(/\\n/g,'\n');
 const pool=new Pool({connectionString:connection.toString(),max:5,connectionTimeoutMillis:15000,idleTimeoutMillis:30000,ssl:{rejectUnauthorized:true,...(ca?{ca}:{})},options:'-c search_path=shoplink,public -c statement_timeout=30000'});
 pool.on('error',()=>console.error('Database connection interrupted; subsequent requests will reconnect.'));
 const transaction=async fn=>{
  if(context.getStore())return fn();
  const client=await pool.connect();
  try{return await context.run(client,async()=>{
   await client.query('BEGIN');
   // Serializes business transactions across processes, including multi-shop carts.
   await client.query('SELECT pg_advisory_xact_lock(1937013100)');
   try{const result=await fn();await client.query('COMMIT');return result}catch(e){await client.query('ROLLBACK');throw e}
  })}finally{client.release()}
 };
 const db={
  prepare(sql){let index=0;const query=sql.replace(/\?/g,()=>'$'+(++index));const execute=args=>(context.getStore()||pool).query(query,args);return {
   async get(...args){return (await execute(args)).rows[0]},
   async all(...args){return (await execute(args)).rows},
   async run(...args){return {changes:(await execute(args)).rowCount}}
  }},transaction,close:()=>pool.end(),kind:'postgres'
 };
 try{await transaction(()=>context.getStore().query(readFileSync(path.join(root,'server/schema.postgres.sql'),'utf8')))}catch(e){await pool.end();throw e}
 return db;
}
