import {test} from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import {openDatabase} from '../server/database.mjs';
import {createImageStorage} from '../server/image-storage.mjs';
const root=path.resolve(import.meta.dirname,'..');
test('hosted records and images survive reconnect and failed transactions roll back',async()=>{
 const db=await openDatabase(root,'/unused');
 await db.transaction(async()=>{await db.prepare('INSERT INTO workspaces VALUES(?,?,?)').run('persistence-test','{"products":[]}',0)});
 await assert.rejects(db.transaction(async()=>{await db.prepare('UPDATE workspaces SET revision=1 WHERE id=?').run('persistence-test');throw new Error('abort')}));
 assert.equal((await db.prepare('SELECT revision FROM workspaces WHERE id=?').get('persistence-test')).revision,0);
 await db.close();
 const reopened=await openDatabase(root,'/unused');
 assert.equal((await reopened.prepare('SELECT revision FROM workspaces WHERE id=?').get('persistence-test')).revision,0);
 const storage=createImageStorage('/unused');const bytes=Buffer.from([137,80,78,71,13,10,26,10]);
 const url=await storage.put('persistence.png',bytes,'image/png');
 assert.deepEqual(Buffer.from(await (await fetch(url)).arrayBuffer()),bytes);
 const next=createImageStorage('/unused');assert.equal(next.url('persistence.png'),url);
 const original=globalThis.fetch;globalThis.fetch=async()=>new Response('',{status:503});
 try{await assert.rejects(next.put('fail.png',bytes,'image/png'),{status:502})}finally{globalThis.fetch=original}
 await next.remove('persistence.png');
 await reopened.close();
});
