import {test} from 'node:test';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import net from 'node:net';
const root=path.resolve(import.meta.dirname,'..');
const temp=mkdtempSync(path.join(tmpdir(),'shoplink-test-'));
const listener=net.createServer();await new Promise(r=>listener.listen(0,'127.0.0.1',r));const port=listener.address().port;await new Promise(r=>listener.close(r));
const base=`http://127.0.0.1:${port}`;
const child=spawn(process.execPath,['server/index.mjs'],{cwd:root,env:{...process.env,PORT:String(port),HOST:'127.0.0.1',APP_ORIGIN:base,DATA_DIR:temp},stdio:['ignore','pipe','pipe']});
await new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(new Error('Server startup timeout')),15000);child.stdout.on('data',d=>{if(d.toString().includes('ShopLink ready')){clearTimeout(timer);resolve()}});child.stderr.on('data',d=>{process.stderr.write(d)});child.once('exit',c=>{clearTimeout(timer);reject(new Error('Server exited '+c))})});
async function request(route,{method='GET',body,cookie='',headers={},expected=200}={}){const r=await fetch(base+route,{method,headers:{...(body!==undefined?{'Content-Type':'application/json'}:{}),...(cookie?{Cookie:cookie}:{}),...headers},...(body!==undefined?{body:JSON.stringify(body)}:{})});const d=await r.json();assert.equal(r.status,expected,JSON.stringify(d));return{data:d,cookie:r.headers.get('set-cookie')?.split(';')[0]||cookie}}
const ownerBody=email=>({kind:'erp',email,password:'TestPassword-2026!',fullName:'Test Shop Owner',phone:'+94 771234567',accountType:'owner',business:'Test business',shopName:'Test shop '+email,category:'Textiles',shopAddress:'12 Main Street',city:'Colombo',shopPhone:'+94 112345678'});
const customerBody=email=>({kind:'customer',email,password:'CustomerPassword-2026!',fullName:'Test Customer',phone:'+94 772222222',address:'21 Test Lane, Colombo'});
try{
await test('complete local ERP and e-commerce integration',async t=>{
 let owner1,owner2,c1,c2,ws1,ws2,shop1,shop2,p1,p2,key,customerOrder,staff;
 await t.test('register isolated shops and customer accounts',async()=>{
  const a=await request('/api/auth/register',{method:'POST',body:ownerBody('owner1@example.test'),expected:201});owner1=a.cookie;ws1=a.data.user.workspace;assert.equal(a.data.user.password_hash,undefined);
  const b=await request('/api/auth/register',{method:'POST',body:ownerBody('owner2@example.test'),expected:201});owner2=b.cookie;ws2=b.data.user.workspace;
  c1=(await request('/api/auth/register',{method:'POST',body:customerBody('customer1@example.test'),expected:201})).cookie;c2=(await request('/api/auth/register',{method:'POST',body:customerBody('customer2@example.test'),expected:201})).cookie;
  shop1=(await request('/api/erp',{cookie:owner1})).data.state.shops[0].id;shop2=(await request('/api/erp',{cookie:owner2})).data.state.shops[0].id;
  await request('/api/erp',{cookie:c1,expected:401});await request('/api/store/orders',{expected:401});
 });
 await t.test('upload images, publish and expose only public product fields',async()=>{
  const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a0S8AAAAASUVORK5CYII=','base64');const images=[];
  for(let i=0;i<2;i++){const r=await fetch(base+'/api/uploads',{method:'POST',headers:{Cookie:owner1,'Content-Type':'image/png'},body:png});assert.equal(r.status,201);images.push((await r.json()).url)}
  const asset=await fetch(new URL(images[0],base));assert.equal(asset.status,200);assert.equal(asset.headers.get('content-type'),'image/png');assert.deepEqual(Buffer.from(await asset.arrayBuffer()),png);
  const bad=await fetch(base+'/api/uploads',{method:'POST',headers:{Cookie:owner1,'Content-Type':'image/png'},body:'<svg>not a png</svg>'});assert.equal(bad.status,400);
  await request('/api/erp',{cookie:owner1,method:'POST',body:{action:'product',payload:{shop:shop1,name:'Cotton shirt',sku:'TS-001',category:'Textiles',variant:'M · Green',price:2000,cost:900,stock:5,threshold:2,description:'Pure cotton shirt',images,published:false}}});
  let s=(await request('/api/erp',{cookie:owner1})).data.state;p1=s.products[0];assert.equal(p1.images.length,2);assert.equal((await request('/api/store/catalog')).data.products.length,0);
  await request('/api/erp',{cookie:owner1,method:'POST',body:{action:'publish',payload:{id:p1.id,published:true}}});
  await request('/api/erp',{cookie:owner2,method:'POST',body:{action:'product',payload:{shop:shop2,name:'Face serum',sku:'CS-001',category:'Cosmetics',variant:'30 ml',price:3000,cost:1200,stock:3,threshold:1,description:'Sample serum',published:true}}});p2=(await request('/api/erp',{cookie:owner2})).data.state.products[0];
  const catalog=(await request('/api/store/catalog')).data.products;assert.equal(catalog.length,2);assert.equal(catalog[0].cost,undefined);assert.equal(catalog[0].images.length,2);assert.equal(catalog[0].shop_name,'Test shop owner1@example.test');
  const filtered=await request('/api/store/catalog?category=Cosmetics');assert.equal(filtered.data.products.length,1);
 });
 const payload=()=>({name:'Customer One',phone:'+94 772222222',address:'Customer delivery address',lines:[{key:ws1+':'+p1.id,qty:2,expectedPrice:2000,expectedTax:0},{key:ws2+':'+p2.id,qty:1,expectedPrice:3000,expectedTax:0}]});
 await t.test('multi-shop checkout updates both inventories and is idempotent',async()=>{
  const d=(await request('/api/store/orders',{method:'POST',cookie:c1,body:payload(),headers:{'Idempotency-Key':'checkout-1'},expected:201})).data;assert.equal(d.orders.length,2);assert.equal(d.total,7000);customerOrder=d.orders.find(o=>o.workspace===ws1);assert.equal(customerOrder.lines[0].cost,undefined);
  await request('/api/store/orders',{method:'POST',cookie:c1,body:payload(),headers:{'Idempotency-Key':'checkout-1'},expected:201});
  const s1=(await request('/api/erp',{cookie:owner1})).data.state,s2=(await request('/api/erp',{cookie:owner2})).data.state;assert.equal(s1.products[0].stock,3);assert.equal(s2.products[0].stock,2);assert.equal(s1.orders[0].channel,'Online');assert.equal(s1.orders[0].address,'Customer delivery address');assert.equal(s1.orders[0].number,customerOrder.number);
  assert.equal((await request('/api/store/orders',{cookie:c1})).data.orders.length,2);assert.equal((await request('/api/store/orders',{cookie:c2})).data.orders.length,0);
  const changed=payload();changed.lines[0].qty=1;await request('/api/store/orders',{method:'POST',cookie:c1,body:changed,headers:{'Idempotency-Key':'checkout-1'},expected:409});
 });
 await t.test('invalid checkout rolls back all shops and rejects stale pricing',async()=>{
  const bad=payload();bad.lines[1].qty=100;await request('/api/store/orders',{method:'POST',cookie:c1,body:bad,headers:{'Idempotency-Key':'bad-stock'},expected:400});assert.equal((await request('/api/erp',{cookie:owner1})).data.state.products[0].stock,3);
  const price=payload();price.lines[0].expectedPrice=1;await request('/api/store/orders',{method:'POST',cookie:c1,body:price,headers:{'Idempotency-Key':'bad-price'},expected:409});
 });
 await t.test('competing checkouts cannot oversell the final units',async()=>{
  const b={name:'Final units buyer',phone:'+94 775555555',address:'Colombo',lines:[{key:ws1+':'+p1.id,qty:3,expectedPrice:2000,expectedTax:0}]};
  const outcomes=await Promise.all([c1,c2].map(async(cookie,i)=>{const r=await fetch(base+'/api/store/orders',{method:'POST',headers:{Cookie:cookie,'Content-Type':'application/json','Idempotency-Key':'race-'+i},body:JSON.stringify(b)});return{status:r.status,data:await r.json(),cookie}}));
  assert.deepEqual(outcomes.map(x=>x.status).sort(),[201,400]);assert.equal((await request('/api/erp',{cookie:owner1})).data.state.products[0].stock,0);
  const winner=outcomes.find(x=>x.status===201);const o=winner.data.orders[0];await request('/api/store/cancel',{cookie:winner.cookie,method:'POST',body:{workspace:o.workspace,id:o.id}});assert.equal((await request('/api/erp',{cookie:owner1})).data.state.products[0].stock,3);
 });
 await t.test('order fulfilment and tracking reach only the purchasing customer',async()=>{
  await request('/api/store/cancel',{method:'POST',cookie:c2,body:{workspace:ws1,id:customerOrder.id},expected:404});
  for(const status of ['Processing','Shipped','Completed'])await request('/api/erp',{method:'POST',cookie:owner1,body:{action:'orderStatus',payload:{id:customerOrder.id,status,courier:'Test Courier',trackingNumber:'TRACK-123'}}});
  const o=(await request('/api/store/orders',{cookie:c1})).data.orders.find(x=>x.id===customerOrder.id);assert.equal(o.status,'Completed');assert.equal(o.trackingNumber,'TRACK-123');
  await request('/api/store/cancel',{method:'POST',cookie:c1,body:{workspace:ws1,id:customerOrder.id},expected:400});
  const second=(await request('/api/store/orders',{cookie:c1})).data.orders.find(x=>x.workspace===ws2);await request('/api/store/cancel',{method:'POST',cookie:c1,body:{workspace:ws2,id:second.id}});assert.equal((await request('/api/erp',{cookie:owner2})).data.state.products[0].stock,3);
 });
 await t.test('staff invitation, role enforcement and revocation',async()=>{
  const invite=(await request('/api/erp',{cookie:owner1,method:'POST',body:{action:'member',payload:{email:'staff@example.test',role:'Cashier',shop:shop1}}})).data.inviteCode;assert(invite);
  await request('/api/auth/register',{method:'POST',body:{...ownerBody('wrongstaff@example.test'),accountType:'staff',inviteCode:'wrong'},expected:403});
  staff=(await request('/api/auth/register',{method:'POST',body:{...ownerBody('staff@example.test'),accountType:'staff',inviteCode:invite,role:'Owner'},expected:201})).cookie;
  const d=(await request('/api/erp',{cookie:staff})).data;assert.equal(d.who.role,'Cashier');assert.equal(d.state.products[0].cost,undefined);await request('/api/erp',{cookie:staff,method:'POST',body:{action:'stock',payload:{id:p1.id,delta:1,reason:'Unauthorized'}},expected:403});
  await request('/api/erp',{cookie:owner1,method:'POST',body:{action:'member',payload:{email:'staff@example.test',role:'Manager',shop:shop1}}});
  await request('/api/erp',{cookie:staff,method:'POST',body:{action:'stock',payload:{id:p2.id,shop:shop1,delta:1,reason:'Forged shop'}},expected:403});
  await request('/api/erp',{cookie:owner1,method:'POST',body:{action:'member',payload:{email:'staff@example.test',remove:true}}});await request('/api/erp',{cookie:staff,expected:403});
 });
 await t.test('external API key, profile protection, password and CSRF',async()=>{
  key=(await request('/api/erp',{cookie:owner1,method:'POST',body:{action:'key'}})).data.token;const external=(await request('/api/catalog',{headers:{Authorization:'Bearer '+key}})).data.products;assert.equal(external.length,1);assert.equal(external[0].cost,undefined);
  await request('/api/catalog',{headers:{Authorization:'Bearer invalid'},expected:401});
  await request('/api/store/profile',{cookie:c1,method:'POST',body:{fullName:'Updated Customer',phone:'+94 779999999',address:'New address',role:'Owner',email:'fake@test.com'}});const profile=(await request('/api/store/profile',{cookie:c1})).data.user;assert.equal(profile.email,'customer1@example.test');assert.equal(profile.role,'Customer');
  await request('/api/store/profile',{cookie:c1,method:'POST',headers:{Origin:'https://evil.example'},body:{fullName:'Changed',phone:'+94 779999999'},expected:403});
  await request('/api/auth/password',{cookie:c1,method:'POST',body:{kind:'customer',currentPassword:'CustomerPassword-2026!',newPassword:'BetterPassword-2026!'}});await request('/api/store/profile',{cookie:c1,expected:401});
  await request('/api/auth/login',{method:'POST',body:{kind:'customer',email:'customer1@example.test',password:'BetterPassword-2026!'}});
 });
});
}finally{child.kill('SIGTERM');await new Promise(r=>child.once('exit',r));rmSync(temp,{recursive:true,force:true})}
