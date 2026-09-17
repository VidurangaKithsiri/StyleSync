import {test} from 'node:test';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import net from 'node:net';
import {randomBytes} from 'node:crypto';
const root=path.resolve(import.meta.dirname,'..');
async function freePort(){const s=net.createServer();await new Promise(r=>s.listen(0,'127.0.0.1',r));const port=s.address().port;await new Promise(r=>s.close(r));return port}
function start(file,env){const child=spawn(process.execPath,[file],{cwd:root,env:{...process.env,...env},stdio:['ignore','pipe','pipe']});const ready=new Promise((resolve,reject)=>{let error='';const timer=setTimeout(()=>reject(new Error('Startup timed out: '+error)),15000);child.stderr.on('data',d=>error+=d);child.stdout.on('data',d=>{if(d.toString().includes('ready:')){clearTimeout(timer);resolve()}});child.once('exit',()=>{clearTimeout(timer);reject(new Error(error))})});return {child,ready}}
async function stop(child){if(child.exitCode!==null)return;await new Promise(resolve=>{child.once('exit',resolve);child.kill('SIGTERM')})}
async function request(base,route,{body,cookie='',headers={},method=body?'POST':'GET',status=200}={}){const res=await fetch(base+route,{method,headers:{...(body?{'Content-Type':'application/json'}:{}),Cookie:cookie,...headers},body:body?JSON.stringify(body):undefined});const data=await res.json();assert.equal(res.status,status,JSON.stringify(data));return {data,cookie:res.headers.get('set-cookie')?.split(';')[0]||cookie}}
await test('ERP and storefront run as separate HTTP services',async t=>{
 const temp=mkdtempSync(path.join(tmpdir(),'shoplink-split-'));
 const erpPort=await freePort(),shopPort=await freePort(),erp=`http://127.0.0.1:${erpPort}`,shop=`http://127.0.0.1:${shopPort}`;
 const secret=randomBytes(32).toString('hex');
 const a=start('server/index.mjs',{PORT:String(erpPort),HOST:'127.0.0.1',APP_ORIGIN:erp,ERP_ONLY:'true',COMMERCE_API_SECRET:secret,DATA_DIR:temp,STOREFRONT_URL:shop,DATABASE_URL:''});
 let b;t.after(async()=>{if(b)await stop(b.child);await stop(a.child);rmSync(temp,{recursive:true,force:true})});await a.ready;
 b=start('server/storefront.mjs',{PORT:String(shopPort),HOST:'127.0.0.1',APP_ORIGIN:shop,ERP_API_URL:erp,COMMERCE_API_SECRET:secret,DATABASE_URL:'',SUPABASE_SERVICE_ROLE_KEY:''});await b.ready;
 let owner,customer,product,workspace,shopId,order;
 await t.test('separate pages and protected API boundaries',async()=>{
  assert.equal((await fetch(erp,{redirect:'manual'})).headers.get('location'),'/erp');
  assert.equal((await fetch(shop)).status,200);
  assert.equal((await fetch(shop+'/erp')).status,404);
  assert.equal((await fetch(erp+'/signup')).status,404);
  assert.equal((await fetch(erp+'/unexpected')).status,404);
  await request(erp,'/api/store/catalog',{status:401});
  await request(erp,'/api/store/catalog',{headers:{'x-commerce-api-secret':'wrong'},status:401});
  await request(shop,'/api/erp',{status:404});
  await request(shop,'/api/auth/session?kind=erp',{status:403});
  await request(erp,'/api/erp',{headers:{'x-commerce-api-secret':secret},status:403});
  await request(shop,'/api/auth/register',{body:{kind:'erp'},status:403});
  await request(erp,'/api/auth/register',{body:{kind:'customer'},status:403});
 });
 await t.test('owner publishes product and customer retrieves it through HTTP API',async()=>{
  owner=await request(erp,'/api/auth/register',{body:{kind:'erp',fullName:'Shop owner',email:'split-owner@example.test',phone:'0771234567',password:'Example-password-123',accountType:'owner',business:'Split business',shopName:'Textile shop',category:'Textiles',shopAddress:'Main Street',city:'Colombo',shopPhone:'0771234567'},status:201});
  const state=await request(erp,'/api/erp',{cookie:owner.cookie});workspace=state.data.who.workspace;shopId=state.data.state.shops[0].id;
  const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a0S8AAAAASUVORK5CYII=','base64');
  const upload=await fetch(erp+'/api/uploads',{method:'POST',headers:{Cookie:owner.cookie,'Content-Type':'image/png'},body:png});assert.equal(upload.status,201);const image=(await upload.json()).url;
  await request(erp,'/api/erp',{cookie:owner.cookie,body:{action:'product',payload:{shop:shopId,name:'Green shirt',sku:'SPLIT-1',category:'Textiles',price:2500,cost:1200,stock:1,threshold:1,images:[image],published:true}}});
  const catalog=await request(shop,'/api/store/catalog');assert.equal(catalog.data.products.length,1);product=catalog.data.products[0];assert.equal(product.shop_name,'Textile shop');assert.equal(product.cost,undefined);assert.ok(product.image.startsWith(erp));assert.equal((await fetch(product.image)).status,200);
 });
 await t.test('customer signup, profile and checkout arrive in ERP without staff access',async()=>{
  customer=await request(shop,'/api/auth/register',{body:{kind:'customer',fullName:'Customer',email:'split-customer@example.test',phone:'0771234567',password:'Example-password-123',address:'Colombo'},status:201});assert.ok(customer.cookie.startsWith('shop_session='));
  await request(shop,'/api/store/profile',{cookie:customer.cookie,body:{fullName:'Updated customer',phone:'0771234567',address:'Kandy'}});
  assert.equal((await request(shop,'/api/store/profile',{cookie:customer.cookie})).data.user.full_name,'Updated customer');
  await request(erp,'/api/erp',{cookie:customer.cookie,status:401});
  const body={name:'Updated customer',phone:'0771234567',address:'Kandy',lines:[{key:product.key,qty:1,expectedPrice:2500,expectedTax:0}]};
  const placed=await request(shop,'/api/store/orders',{cookie:customer.cookie,body,headers:{'Idempotency-Key':'split-order'},status:201});order=placed.data.orders[0];
  await request(shop,'/api/store/orders',{cookie:customer.cookie,body,headers:{'Idempotency-Key':'split-order'},status:201});
  const s=(await request(erp,'/api/erp',{cookie:owner.cookie})).data.state;assert.equal(s.products[0].stock,0);assert.equal(s.orders.length,1);assert.equal(s.orders[0].channel,'Online');
  assert.equal((await request(shop,'/api/store/catalog')).data.products[0].stock,0);
  await request(shop,'/api/store/orders',{cookie:customer.cookie,body,headers:{'Idempotency-Key':'second-order'},status:400});
  await request(shop,'/api/store/profile',{cookie:customer.cookie,body:{fullName:'Attack',phone:'0771234567'},headers:{Origin:'https://other.example'},status:403});
 });
 await t.test('ERP fulfilment reaches the correct customer through the API',async()=>{
  for(const status of ['Processing','Shipped'])await request(erp,'/api/erp',{cookie:owner.cookie,body:{action:'orderStatus',payload:{id:order.id,status,courier:'Test courier',trackingNumber:'TRACK-1'}}});
  const orders=(await request(shop,'/api/store/orders',{cookie:customer.cookie})).data.orders;assert.equal(orders[0].status,'Shipped');assert.equal(orders[0].trackingNumber,'TRACK-1');
  await request(shop,'/api/store/orders',{status:401});
 });
 await t.test('storefront stays available and reports upstream failure',async()=>{
  await stop(a.child);assert.equal((await fetch(shop)).status,200);
  await request(shop,'/api/store/catalog',{status:503});
 });
});
