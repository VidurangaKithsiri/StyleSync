import {mkdirSync,writeFileSync,unlinkSync} from 'node:fs';
import path from 'node:path';
export function createImageStorage(directory){
 const base=process.env.SUPABASE_URL?.replace(/\/$/,'');
 const key=process.env.SUPABASE_SERVICE_ROLE_KEY;
 const bucket=process.env.SUPABASE_STORAGE_BUCKET||'product-images';
 if(process.env.DATABASE_URL&&(!base||!key))throw new Error('Hosted database requires SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY for persistent product images.');
 if(!base){mkdirSync(directory,{recursive:true});return {async put(name,bytes){writeFileSync(path.join(directory,name),bytes,{flag:'wx'});return '/uploads/'+name},async remove(name){try{unlinkSync(path.join(directory,name))}catch{}},url:()=>null}}
 if(!key||new URL(base).protocol!=='https:')throw new Error('Configure an HTTPS Supabase project URL and server service_role key.');
 const object=name=>`${base}/storage/v1/object/${encodeURIComponent(bucket)}/${encodeURIComponent(name)}`;
 return {
  url:name=>`${base}/storage/v1/object/public/${encodeURIComponent(bucket)}/${encodeURIComponent(name)}`,
  async put(name,bytes,mime){
   let response;try{response=await fetch(object(name),{method:'POST',headers:{apikey:key,Authorization:`Bearer ${key}`,'Content-Type':mime,'x-upsert':'false'},body:bytes,signal:AbortSignal.timeout(30000)})}catch{throw Object.assign(new Error('Image storage is unavailable. Please retry.'),{status:503})}
   if(!response.ok)throw Object.assign(new Error('Image upload failed. Check the product-images bucket and server storage settings.'),{status:502});
   return this.url(name);
  },
  async remove(name){try{await fetch(object(name),{method:'DELETE',headers:{apikey:key,Authorization:`Bearer ${key}`},signal:AbortSignal.timeout(15000)})}catch{}}
 };
}
