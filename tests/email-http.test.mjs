import {test} from 'node:test';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {mkdtempSync,rmSync,readFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import net from 'node:net';
import {randomBytes} from 'node:crypto';
const root=path.resolve(import.meta.dirname,'..');
async function freePort(){const s=net.createServer();await new Promise(r=>s.listen(0,'127.0.0.1',r));const port=s.address().port;await new Promise(r=>s.close(r));return port}
function start(file,env){const child=spawn(process.execPath,file==='server/index.mjs'?['--import','./tests/email-delivery-mock.mjs',file]:[file],{cwd:root,env:{...process.env,...env},stdio:['ignore','pipe','pipe']});const ready=new Promise((resolve,reject)=>{let error='';const timer=setTimeout(()=>reject(new Error('Startup timed out: '+error)),15000);child.stderr.on('data',d=>error+=d);child.stdout.on('data',d=>{if(d.toString().includes('ready:')){clearTimeout(timer);resolve()}});child.once('exit',()=>{clearTimeout(timer);reject(new Error(error))})});return {child,ready}}
async function stop(child){if(child.exitCode!==null)return;await new Promise(resolve=>{child.once('exit',resolve);child.kill('SIGTERM')})}
async function request(base,route,{body,cookie='',headers={},method=body?'POST':'GET',status=200}={}){const res=await fetch(base+route,{method,headers:{...(body?{'Content-Type':'application/json'}:{}),Cookie:cookie,...headers},body:body?JSON.stringify(body):undefined});const data=await res.json();assert.equal(res.status,status,JSON.stringify(data));return {data,cookie:res.headers.get('set-cookie')?.split(';')[0]||cookie}}

await test('email verification and reset over both HTTP services',async t=>{
 const temp=mkdtempSync(path.join(tmpdir(),'email-http-')),mailfile=path.join(temp,'mail.jsonl');
 const erpPort=await freePort(),shopPort=await freePort(),erp=`http://127.0.0.1:${erpPort}`,shop=`http://127.0.0.1:${shopPort}`,secret=randomBytes(32).toString('hex');
 const a=start('server/index.mjs',{PORT:String(erpPort),HOST:'127.0.0.1',APP_ORIGIN:erp,ERP_ONLY:'true',COMMERCE_API_SECRET:secret,DATA_DIR:temp,STOREFRONT_URL:shop,DATABASE_URL:'',EMAIL_AUTH_ENABLED:'true',EMAIL_PROVIDER:'brevo',EMAIL_API_KEY:'test-key',EMAIL_FROM:'sender@example.com',TEST_MAIL_FILE:mailfile});
 let b;t.after(async()=>{if(b)await stop(b.child);await stop(a.child);rmSync(temp,{recursive:true,force:true})});await a.ready;
 b=start('server/storefront.mjs',{PORT:String(shopPort),HOST:'127.0.0.1',APP_ORIGIN:shop,ERP_API_URL:erp,COMMERCE_API_SECRET:secret});await b.ready;
 const lastToken=()=>JSON.parse(readFileSync(mailfile,'utf8').trim().split('\n').at(-1)).textContent.match(/token=([a-f0-9]+)/)[1];
 for(const [kind,base] of [['erp',erp],['customer',shop]]){
  const email='same@example.com',password='Example-password-123';
  const created=await request(base,'/api/auth/register',{body:{kind,email,password,fullName:'Test User',phone:'0771234567',business:'Test',shopName:'Test',category:'Textiles',shopAddress:'Colombo',city:'Colombo',shopPhone:'0771234567'},status:201});
  assert.equal(created.data.verificationRequired,true);assert.equal(created.cookie,'');
  await request(base,'/api/auth/login',{body:{kind,email,password},status:403});
  const token=lastToken();
  await request(base,'/api/auth/verify-email',{body:{kind,token}});
  await request(base,'/api/auth/verify-email',{body:{kind,token},status:400});
  const login=await request(base,'/api/auth/login',{body:{kind,email,password}});
  await request(base,'/api/auth/forgot-password',{body:{kind,email}});const reset=lastToken();
  await request(base,'/api/auth/reset-password',{body:{kind,token:reset,newPassword:'New-password-123'}});
  const expired=await request(base,'/api/auth/session?kind='+kind,{cookie:login.cookie});assert.equal(expired.data.user,null);
  await request(base,'/api/auth/login',{body:{kind,email,password},status:401});
  await request(base,'/api/auth/login',{body:{kind,email,password:'New-password-123'}});
 }
 await request(shop,'/api/auth/forgot-password',{body:{kind:'erp',email:'same@example.com'},status:403});
});
