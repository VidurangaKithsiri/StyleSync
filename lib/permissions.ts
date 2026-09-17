import type {State} from './domain';
export type Identity={workspace:string;role:string;shop:string|null;email:string;userId:string;profile:any};
export function authorize(action:string,p:any,s:State,who:Pick<Identity,'role'|'shop'>){
 if(who.role==='Owner')return;
 if(!['Manager','Cashier'].includes(who.role)||!who.shop)throw new Error('Access denied: no valid shop assignment');
 const allowed=who.role==='Cashier'?['sale']:['product','publish','stock','sale','orderStatus','purchase','receive','expense','contact'];
 if(!allowed.includes(action))throw new Error('Your role cannot perform this action');
 // Check the stored record, not only a caller-supplied shop field.
 let record:any;
 if(action==='orderStatus')record=s.orders.find(x=>x.id===p.id);
 else if(action==='receive')record=s.purchases.find(x=>x.id===p.id);
 else if(action==='contact'&&p.id)record=s.contacts.find(x=>x.id===p.id);
 else if(['product','publish','stock'].includes(action)&&p.id)record=s.products.find(x=>x.id===p.id);
 const needsExisting=['publish','stock','orderStatus','receive'].includes(action)||(['product','contact'].includes(action)&&!!p.id);
 if(needsExisting&&(!record||record.shop!==who.shop))throw new Error('Access denied: this record is outside your assigned shop');
 if(p.shop&&p.shop!==who.shop)throw new Error('Access denied: this shop is not assigned to you');
 if(['sale','purchase','expense'].includes(action)&&p.shop!==who.shop)throw new Error('Access denied: select your assigned shop');
 if(action==='purchase'&&!s.contacts.some(x=>x.id===p.supplier&&x.shop===who.shop&&x.type==='Supplier'))throw new Error('Access denied: select a supplier for your assigned shop');
 if(action==='product'&&!p.id&&p.shop!==who.shop)throw new Error('Access denied: select your assigned shop');
}
export function scoped(s:State,who:Pick<Identity,'role'|'shop'>){
 if(who.role==='Owner')return {...s,requests:[]};
 const selected={...s,shops:s.shops.filter(x=>x.id===who.shop),products:s.products.filter(x=>x.shop===who.shop),orders:s.orders.filter(x=>x.shop===who.shop),contacts:s.contacts.filter(x=>x.shop===who.shop),purchases:s.purchases.filter(x=>x.shop===who.shop),expenses:s.expenses.filter(x=>x.shop===who.shop),movements:s.movements.filter(x=>x.shop===who.shop),audit:[],requests:[]};
 if(who.role==='Cashier')return {...selected,products:selected.products.map(({cost,...p})=>p),orders:selected.orders.map(o=>({...o,lines:o.lines.map(({cost,...l}:any)=>l)})),purchases:[],expenses:[],movements:[]};
 return selected;
}
export function profileFields(p:any){
 const fullName=String(p.fullName||'').trim();const phone=String(p.phone||'').trim();
 if(fullName.length<2||fullName.length>100)throw new Error('Enter your full name (2–100 characters)');
 if(!/^[+\d() .-]{7,25}$/.test(phone))throw new Error('Enter a valid contact phone number');
 return {fullName,phone};
}
