// Test-only adapters: real PostgreSQL SQL engine (PGlite) and simulated Storage HTTP.
import {registerHooks} from 'node:module';
import {mkdirSync,writeFileSync,readFileSync,existsSync,unlinkSync} from 'node:fs';
import path from 'node:path';
registerHooks({resolve(specifier,context,next){if(specifier==='pg')return {url:new URL('./pglite-pool.mjs',import.meta.url).href,shortCircuit:true};return next(specifier,context)}});
const nativeFetch=globalThis.fetch;
globalThis.fetch=async(input,options={})=>{
 const url=new URL(String(input));if(url.hostname!=='storage.example.test')return nativeFetch(input,options);
 const name=url.pathname.split('/').pop(),dir=process.env.TEST_STORAGE_DIR;
 if(!dir)throw new Error('TEST_STORAGE_DIR required');mkdirSync(dir,{recursive:true});const file=path.join(dir,name);
 if(options.method==='POST'){
  if(options.headers.Authorization!=='Bearer test-server-key')return new Response('',{status:403});
  writeFileSync(file,Buffer.from(options.body));return Response.json({Key:name});
 }
 if(options.method==='DELETE'){if(existsSync(file))unlinkSync(file);return Response.json({})}
 return existsSync(file)?new Response(readFileSync(file),{headers:{'Content-Type':'image/png'}}):new Response('',{status:404});
};
