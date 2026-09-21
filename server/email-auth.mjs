import {randomBytes,createHash} from 'node:crypto';
const digest=s=>createHash('sha256').update(s).digest('hex');
const fail=(m,status=400)=>{throw Object.assign(new Error(m),{status})};
export function createEmailAuth(db,{enabled,erpOrigin,storeOrigin,sendMail}) {
 const generic='If this account is eligible, an email will arrive shortly. Check your spam folder.';
 async function verified(u){return !!await db.prepare('SELECT user_id FROM email_verified WHERE user_id=? AND email=?').get(u.id,u.email)}
 async function request(kind,email,purpose){
  if(!enabled)fail('Email recovery is not configured yet. Contact the shop administrator.',503);
  const now=Date.now(),slot=digest(`${kind}:${email}:${purpose}`);
  // Persistent per-address cooldown also covers unknown accounts and survives restarts.
  const allowed=await db.transaction(async()=>{
   await db.prepare('DELETE FROM email_cooldowns WHERE until_ms<=?').run(now);
   if(await db.prepare('SELECT slot FROM email_cooldowns WHERE slot=?').get(slot))return false;
   await db.prepare('INSERT INTO email_cooldowns(slot,until_ms) VALUES(?,?)').run(slot,now+60000);return true;
  });
  if(!allowed)return {message:generic};
  const u=await db.prepare('SELECT * FROM users WHERE kind=? AND email=?').get(kind,email);
  if(!u||(purpose==='verify'&&await verified(u)))return {message:generic};
  const token=randomBytes(32).toString('hex'),tokenHash=digest(token);
  await db.transaction(async()=>{
   await db.prepare('DELETE FROM email_tokens WHERE expires_at<=?').run(now);
   await db.prepare('DELETE FROM email_tokens WHERE user_id=? AND purpose=?').run(u.id,purpose);
   await db.prepare('INSERT INTO email_tokens(hash,user_id,email,purpose,expires_at) VALUES(?,?,?,?,?)').run(tokenHash,u.id,u.email,purpose,now+(purpose==='reset'?30:1440)*60000);
  });
  const link=new URL(kind==='erp'?'/erp/login':'/login',kind==='erp'?erpOrigin:storeOrigin);
  // Fragments are not sent in HTTP requests or Referer headers.
  link.hash=new URLSearchParams({action:purpose,token}).toString();
  try{await sendMail({to:u.email,subject:purpose==='reset'?'Reset your StyleSync password':'Verify your StyleSync email',text:`${kind==='erp'?'Shop and staff':'Customer'} account\n\n${purpose==='reset'?'Choose a new password':'Confirm your email'}: ${link.href}\n\nThis single-use link expires in ${purpose==='reset'?'30 minutes':'24 hours'}. If you did not request this, ignore this email.`})}
  catch{await db.prepare('DELETE FROM email_tokens WHERE hash=?').run(tokenHash);console.error('Account email delivery failed. Check mail provider configuration and delivery logs.');}
  return {message:generic};
 }
 async function consume(kind,token,purpose,passwordHash){
  if(!enabled)fail('Email recovery is not configured yet.',503);
  if(typeof token!=='string'||! /^[a-f0-9]{64}$/.test(token))fail('This link is invalid or expired. Request a new email.');
  return db.transaction(async()=>{
   const t=await db.prepare('SELECT t.*,u.kind FROM email_tokens t JOIN users u ON u.id=t.user_id AND u.email=t.email WHERE t.hash=? AND t.purpose=? AND t.expires_at>? AND u.kind=?').get(digest(token),purpose,Date.now(),kind);
   if(!t)fail('This link is invalid or expired. Request a new email.');
   const deleted=await db.prepare('DELETE FROM email_tokens WHERE hash=?').run(digest(token));
   if(deleted.changes!==1)fail('This link has already been used.');
   await db.prepare('INSERT INTO email_verified(user_id,email,verified_at) VALUES(?,?,?) ON CONFLICT(user_id) DO UPDATE SET email=excluded.email,verified_at=excluded.verified_at').run(t.user_id,t.email,new Date().toISOString());
   // Both flows revoke older sessions; confirming ownership must not preserve a pre-verification session.
   await db.prepare('DELETE FROM sessions WHERE user_id=?').run(t.user_id);
   if(purpose==='reset'){
    await db.prepare('UPDATE users SET password_hash=? WHERE id=?').run(passwordHash,t.user_id);
    await db.prepare('DELETE FROM email_tokens WHERE user_id=?').run(t.user_id);
   }
   return {message:purpose==='reset'?'Password updated. Sign in with your new password.':'Email verified. You can now sign in.'};
  });
 }
 return {enabled,verified,request,consume};
}
export function configuredMailer(env=process.env){
 const provider=env.EMAIL_PROVIDER||'brevo',key=env.EMAIL_API_KEY,from=env.EMAIL_FROM;
 if(!['brevo','resend'].includes(provider)||!key||!from||!/^[^\s<>@]+@[^\s<>@]+\.[^\s<>@]+$/.test(from))throw new Error('Set EMAIL_PROVIDER (brevo or resend), EMAIL_API_KEY and EMAIL_FROM (verified sender email).');
 return async({to,subject,text})=>{
  const brevo=provider==='brevo';
  const response=await fetch(brevo?'https://api.brevo.com/v3/smtp/email':'https://api.resend.com/emails',{
   method:'POST',headers:{'Content-Type':'application/json',...(brevo?{'api-key':key}:{Authorization:`Bearer ${key}`})},
   body:JSON.stringify(brevo?{sender:{email:from,name:'StyleSync'},to:[{email:to}],subject,textContent:text}:{from,to:[to],subject,text}),signal:AbortSignal.timeout(15000)
  });
  if(!response.ok)throw new Error('Email provider rejected delivery');
 };
}
