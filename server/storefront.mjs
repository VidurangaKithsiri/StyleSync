import http from 'node:http';
import {existsSync,statSync,createReadStream} from 'node:fs';
import path from 'node:path';
import {commerceRoutes} from './commerce-routes.mjs';
const root=path.resolve(import.meta.dirname,'..');
if(existsSync(path.join(root,'.env')))process.loadEnvFile(path.join(root,'.env'));
const port=Number(process.env.PORT||3001),host=process.env.HOST||'127.0.0.1';
const origin=new URL(process.env.APP_ORIGIN||process.env.RENDER_EXTERNAL_URL||`http://localhost:${port}`).origin;
const upstream=new URL(process.env.ERP_API_URL||'http://localhost:3000');
const key=process.env.COMMERCE_API_SECRET;
if(!key||key.length<32)throw new Error('Set COMMERCE_API_SECRET to the same random 32+ character value on both services.');
if(upstream.protocol!=='https:'&&!['localhost','127.0.0.1'].includes(upstream.hostname))throw new Error('ERP_API_URL must use HTTPS outside localhost.');
if(upstream.username||upstream.password||upstream.pathname!=='/'||upstream.search||upstream.hash)throw new Error('ERP_API_URL must be only the ERP origin, without credentials or a path.');
const fail=(message,status)=>{throw Object.assign(new Error(message),{status})};
const send=(res,value,status=200)=>{res.writeHead(status,{'Content-Type':'application/json','Cache-Control':'no-store'});res.end(JSON.stringify(value))};
const mime={'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.svg':'image/svg+xml','.png':'image/png','.ico':'image/x-icon'};
const server=http.createServer(async(req,res)=>{
 res.setHeader('X-Content-Type-Options','nosniff');res.setHeader('X-Frame-Options','DENY');res.setHeader('Referrer-Policy','strict-origin-when-cross-origin');
 res.setHeader('Content-Security-Policy',"default-src 'self'; img-src 'self' https: data: blob:; style-src 'self' 'unsafe-inline'; script-src 'self'; connect-src 'self'; font-src 'self' data:; frame-ancestors 'none'; base-uri 'self'");
 try{
  const url=new URL(req.url,'http://localhost');
  if(!['GET','HEAD'].includes(req.method)&&((req.headers.origin&&req.headers.origin!==origin)||req.headers['sec-fetch-site']==='cross-site'))fail('Request origin not allowed',403);
  if(url.pathname==='/api/health'&&req.method==='GET')return send(res,{ok:true,application:'StyleSync customer storefront'});
  if(url.pathname.startsWith('/api/')){
   if(!commerceRoutes.get(url.pathname)?.includes(req.method))fail('Route not available on the customer website',404);
   let payload;
   if(req.method==='POST'){
    if(!String(req.headers['content-type']||'').includes('application/json'))fail('Send application/json',415);
    let size=0;const chunks=[];for await(const chunk of req){size+=chunk.length;if(size>100000)fail('Request too large',413);chunks.push(chunk)}
    try{payload=JSON.parse(Buffer.concat(chunks).toString())}catch{fail('Invalid JSON',400)}
    if(!payload||typeof payload!=='object'||Array.isArray(payload))fail('Invalid request',400);
    if(url.pathname.startsWith('/api/auth/')){if(payload.kind&&payload.kind!=='customer')fail('Only customer accounts are allowed here',403);payload.kind='customer'}
   }
   if(url.pathname==='/api/auth/session'){if(url.searchParams.has('kind')&&url.searchParams.get('kind')!=='customer')fail('Only customer accounts are allowed here',403);url.searchParams.set('kind','customer')}
   // Never forward browser-supplied authorization, ERP cookies, origin or integration headers.
   const headers={'x-commerce-api-secret':key};
   const cookie=(req.headers.cookie||'').split(';').map(x=>x.trim()).find(x=>/^shop_session=[a-f0-9]+$/.test(x));if(cookie)headers.Cookie=cookie;
   if(payload)headers['Content-Type']='application/json';
   if(req.headers['idempotency-key'])headers['Idempotency-Key']=req.headers['idempotency-key'];
   let response;try{response=await fetch(new URL(url.pathname+url.search,upstream),{method:req.method,headers,body:payload?JSON.stringify(payload):undefined,redirect:'error',signal:AbortSignal.timeout(90000)})}catch{fail('The shop service is waking up or temporarily unavailable. Please retry shortly.',503)}
   const type=response.headers.get('content-type')||'';if(!type.includes('application/json'))fail('The shop service is temporarily unavailable. Please retry.',502);
   for(const c of response.headers.getSetCookie()){if(c.startsWith('shop_session=')&&!/;\s*domain=/i.test(c))res.setHeader('Set-Cookie',c)}
   res.writeHead(response.status,{'Content-Type':type,'Cache-Control':'no-store'});return res.end(await response.text());
  }
  if(!['GET','HEAD'].includes(req.method))fail('Method not allowed',405);
  if(url.pathname==='/erp'||url.pathname.startsWith('/erp/'))fail('This website is for customers',404);
  const base=path.join(root,'dist'),filePath=path.resolve(base,decodeURIComponent(url.pathname).replace(/^\/+/,''));
  if(filePath!==base&&!filePath.startsWith(base+path.sep))fail('Not found',404);
  let file=filePath;
  if(!existsSync(file)||statSync(file).isDirectory()){
   if(!['/','/login','/signup'].includes(url.pathname))fail('Not found',404);
   file=path.join(base,'index.html');
  }
  if(!existsSync(file))fail('Frontend build missing',503);
  res.writeHead(200,{'Content-Type':mime[path.extname(file)]||'application/octet-stream','Cache-Control':'no-cache'});
  if(req.method==='HEAD')return res.end();createReadStream(file).pipe(res);
 }catch(e){if(!res.headersSent)send(res,{error:e.status?e.message:'Service unavailable'},e.status||503);else res.end()}
});
server.listen(port,host,()=>console.log(`Storefront ready: ${origin}`));
for(const signal of ['SIGTERM','SIGINT'])process.on(signal,()=>server.close(()=>process.exit(0)));
