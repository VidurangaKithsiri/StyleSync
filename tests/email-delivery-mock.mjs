// Only loaded explicitly by the test runner, never imported by production.
import {appendFileSync} from 'node:fs';
const original=globalThis.fetch;
globalThis.fetch=async(url,options)=>{
 if(String(url)==='https://api.brevo.com/v3/smtp/email'){
  appendFileSync(process.env.TEST_MAIL_FILE,options.body+'\n');return new Response('{}',{status:201});
 }
 return original(url,options);
};
