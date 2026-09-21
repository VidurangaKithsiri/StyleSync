import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {openDatabase} from '../server/database.mjs';
import {createEmailAuth} from '../server/email-auth.mjs';
test('recovery tokens: kind isolation, expiry, single use, sessions, delivery failures',async()=>{
 const dir=mkdtempSync(path.join(os.tmpdir(),'email-')),db=await openDatabase(path.resolve(import.meta.dirname,'..'),dir),sent=[];
 const config={enabled:true,erpOrigin:'https://erp.example.com',storeOrigin:'https://shop.example.com',sendMail:async m=>sent.push(m)},auth=createEmailAuth(db,config);
 const token=()=>sent.at(-1).text.match(/token=([a-f0-9]+)/)[1];
 try{
 for(const kind of ['erp','customer'])await db.prepare('INSERT INTO users(id,kind,email,full_name,phone,password_hash,role,created_at) VALUES(?,?,?,?,?,?,?,?)').run(kind,kind,'user@example.com','User','123','old','Owner','2026-09-21');
 const generic=await auth.request('customer','unknown@example.com','reset');assert.equal(sent.length,0);
 assert.deepEqual(await auth.request('customer','user@example.com','reset'),generic);
 assert.match(sent[0].text,/https:\/\/shop.example.com\/login#/);const t=token();
 assert.notEqual((await db.prepare('SELECT hash FROM email_tokens').get()).hash,t);
 await assert.rejects(auth.consume('erp',t,'reset','new'));
 await assert.rejects(auth.consume('customer',t,'verify'));
 await db.prepare('INSERT INTO sessions VALUES(?,?,?)').run('session','customer',Date.now()+100000);
 const results=await Promise.allSettled([auth.consume('customer',t,'reset','new'),auth.consume('customer',t,'reset','new')]);assert.equal(results.filter(x=>x.status==='fulfilled').length,1);
 assert.equal((await db.prepare('SELECT password_hash FROM users WHERE id=?').get('customer')).password_hash,'new');
 assert.equal((await db.prepare('SELECT password_hash FROM users WHERE id=?').get('erp')).password_hash,'old');
 assert.equal((await db.prepare('SELECT * FROM sessions').all()).length,0);
 assert.equal(await auth.verified({id:'customer',email:'user@example.com'}),true);
 await auth.request('erp','user@example.com','verify');assert.match(sent.at(-1).text,/https:\/\/erp.example.com\/erp\/login#/);
 const expired=token();await db.prepare('UPDATE email_tokens SET expires_at=0').run();await assert.rejects(auth.consume('erp',expired,'verify'));
 await db.prepare('DELETE FROM email_cooldowns').run();await auth.request('erp','user@example.com','verify');await auth.consume('erp',token(),'verify');assert.equal(await auth.verified({id:'erp',email:'user@example.com'}),true);
 await assert.rejects(auth.consume('erp',token(),'verify'));
 await auth.request('customer','user@example.com','reset');const count=sent.length;await auth.request('customer','user@example.com','reset');assert.equal(sent.length,count);
 const failing=createEmailAuth(db,{...config,sendMail:async()=>{throw Error('offline')}});
 assert.deepEqual(await failing.request('erp','user@example.com','reset'),generic);
 assert.equal((await db.prepare("SELECT * FROM email_tokens WHERE user_id='erp'").all()).length,0);
 }finally{await db.close();rmSync(dir,{recursive:true,force:true})}
});
