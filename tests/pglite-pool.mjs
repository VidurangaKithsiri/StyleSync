import {PGlite} from '@electric-sql/pglite';
export class Pool {
 constructor(){this.db=new PGlite(process.env.TEST_PG_DIR);this.pending=Promise.resolve()}
 on(){}
 async connect(){const previous=this.pending;let release;this.pending=new Promise(r=>release=r);await previous;return {query:(sql,args)=>this.execute(sql,args),release}}
 async query(sql,args){const client=await this.connect();try{return await client.query(sql,args)}finally{client.release()}}
 async execute(sql,args){
  if(sql.includes('pg_advisory_xact_lock'))return {rows:[],rowCount:0}; // PGlite has one connection; the pool gate serializes transactions.
  if(sql.includes('CREATE SCHEMA')){await this.db.exec(sql);await this.db.exec('SET search_path=shoplink,public');return {rows:[],rowCount:0}}
  const r=await this.db.query(sql,args);return {rows:r.rows,rowCount:r.affectedRows||0};
 }
 async end(){await this.db.close()}
}
