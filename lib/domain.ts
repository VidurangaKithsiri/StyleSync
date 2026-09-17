export type RecordData = Record<string, any>;
export type State = { shops:RecordData[]; products:RecordData[]; orders:RecordData[]; purchases:RecordData[]; contacts:RecordData[]; expenses:RecordData[]; movements:RecordData[]; audit:RecordData[]; settings:RecordData; requests:RecordData[] };
export const emptyState = ():State => ({shops:[],products:[],orders:[],purchases:[],contacts:[],expenses:[],movements:[],audit:[],requests:[],settings:{business:'My retail business',currency:'LKR',tax:0}});
const fail=(s:string):never=>{throw new Error(s)};
const str=(v:any,n=160)=>String(v??'').trim().slice(0,n);
const required=(v:any,label:string)=>str(v)||fail(`${label} is required`);
const num=(v:any,min=0)=>{const n=Number(v);if(!Number.isFinite(n)||n<min||n>1e9)fail('Enter a valid amount');return n};
const qty=(v:any,min=0)=>{const n=num(v,min);if(!Number.isInteger(n))fail('Quantity must be a whole number');return n};
const money=(v:any)=>Math.round(num(v)*100)/100;
const id=()=>crypto.randomUUID();
export function apply(s:State, action:string, p:RecordData, actor:string){
 const now=new Date().toISOString(); let result:RecordData={};
 const shop=(i:string)=>s.shops.find(x=>x.id===i)||fail('Shop not found');
 const product=(i:string)=>s.products.find(x=>x.id===i)||fail('Product not found');
 const move=(x:RecordData,delta:number,reason:string,ref:string)=>{if(x.stock+delta<0)fail(`Not enough stock: ${x.name}`);x.stock+=delta;x.updated=now;s.movements.unshift({id:id(),product:x.id,name:x.name,shop:x.shop,delta,balance:x.stock,reason,ref,at:now,actor})};
 if(action==='demo'){
  if(s.products.length||s.orders.length)fail('Sample data can only be loaded into an empty business');
  s.shops.push({id:'textile',name:'Thread & Co.',category:'Textiles',location:'Colombo',phone:'',active:true},{id:'beauty',name:'Bloom Beauty',category:'Cosmetics',location:'Kandy',phone:'',active:true});
  const rows=[['Classic cotton shirt','Textiles','textile','M · Sage',3850,2100,24],['Linen blend trousers','Textiles','textile','32 · Sand',5200,3100,8],['Floral summer dress','Textiles','textile','S · Botanical',6450,3900,15],['Everyday cotton tee','Textiles','textile','L · Ivory',2200,1100,4],['Hydrating face serum','Cosmetics','beauty','30 ml',4800,2800,18],['Velvet matte lipstick','Cosmetics','beauty','Rose 04',2450,1350,6],['Daily mineral sunscreen','Cosmetics','beauty','50 ml',3600,2200,21],['Gentle cream cleanser','Cosmetics','beauty','150 ml',2950,1600,0]];
  rows.forEach((r,i)=>s.products.push({id:id(),name:r[0],category:r[1],shop:r[2],variant:r[3],price:r[4],cost:r[5],stock:r[6],sku:`${i<4?'THR':'BLM'}-${1001+i}`,description:`${r[0]} — ${r[3]}. Sample product; replace with your own product information.`,threshold:10,published:i!==3,brand:i<4?'Thread & Co.':'Bloom',barcode:'',batch:'',expiry:'',image:'',updated:now}));
  s.contacts=[{id:id(),type:'Supplier',name:'Lanka Textile Supply',email:'',phone:'',address:'Colombo'},{id:id(),type:'Supplier',name:'Beauty Wholesale',email:'',phone:'',address:'Kandy'}];s.settings.business='ShopLink Retail';result={message:'Sample shops and products added. Sales figures start at zero.'};
 }else if(action==='shop'){
  const x={id:p.id||id(),name:required(p.name,'Shop name'),category:required(p.category,'Category'),location:str(p.location),phone:str(p.phone),address:str(p.address,500),description:str(p.description,2000),registration:str(p.registration,100),active:true};
  if(p.id){Object.assign(shop(p.id),x)}else{s.shops.push(x)}
 }else if(action==='product'){
  shop(p.shop);if(Array.isArray(p.images)&&p.images.length>8)fail('Use up to 8 product images');const sku=required(p.sku,'SKU');if(s.products.some(x=>x.id!==p.id&&x.shop===p.shop&&x.sku.toLowerCase()===sku.toLowerCase()))fail('This SKU already exists in this shop');
  const x={id:p.id||id(),name:required(p.name,'Product name'),sku,shop:p.shop,category:required(p.category,'Category'),variant:str(p.variant),brand:str(p.brand),description:str(p.description,4000),barcode:str(p.barcode),batch:str(p.batch),expiry:str(p.expiry,10),images:Array.isArray(p.images)?p.images.map((v:any)=>str(v,1000)).filter(Boolean).slice(0,8):[],image:str(p.image,1000),price:money(p.price),cost:money(p.cost),threshold:qty(p.threshold),published:!!p.published,updated:now};
  if(!x.images.length&&x.image)x.images=[x.image];if(x.images.length)x.image=x.images[0];if(x.images.some((v:string)=>!/^https:\/\//.test(v)&&!/^\/uploads\/[a-f0-9-]+\.(jpg|png|webp)$/.test(v)))fail('Use uploaded images or HTTPS image URLs');
  if(x.expiry&&!/^\d{4}-\d{2}-\d{2}$/.test(x.expiry))fail('Use a valid expiry date');
  if(p.id){const old=product(p.id);if(old.shop!==p.shop)fail('Shop cannot change after a product is created');Object.assign(old,x)}else{const item={...x,stock:0};s.products.push(item);move(item,qty(p.stock),'Opening stock',item.id)}
 }else if(action==='publish'){
  const x=product(p.id);x.published=!!p.published;x.updated=now;
 }else if(action==='stock'){
  const x=product(p.id);const delta=Number(p.delta);if(!Number.isSafeInteger(delta)||delta===0||Math.abs(delta)>1e6)fail('Enter a non-zero whole quantity');move(x,delta,required(p.reason,'Reason'),id());
 }else if(action==='contact'){
  if(!['Customer','Supplier'].includes(p.type))fail('Invalid contact type');
  const x={id:p.id||id(),name:required(p.name,'Name'),type:p.type,email:str(p.email),phone:str(p.phone),address:str(p.address,500),shop:p.shop||null};
  if(p.id){const old=s.contacts.find(c=>c.id===p.id)||fail('Contact not found');Object.assign(old,x)}else{s.contacts.push(x)}
 }else if(action==='sale'){
  if(p.requestId&&s.requests.some(x=>x.id===p.requestId))return {duplicate:true,order:s.orders.find(x=>x.id===s.requests.find(r=>r.id===p.requestId)?.order)};
  const sh=shop(p.shop);if(!Array.isArray(p.lines)||!p.lines.length||p.lines.length>100)fail('Add between 1 and 100 items');
  const channel=p.channel==='Online'?'Online':'POS';const grouped=new Map<string,number>();p.lines.forEach((l:RecordData)=>grouped.set(l.id,(grouped.get(l.id)||0)+qty(l.qty,1)));
  const lines=[...grouped].map(([i,q])=>{const x=product(i);if(x.shop!==sh.id)fail('A sale must contain items from one shop');if(channel==='Online'&&!x.published)fail('Product is not available online');if(x.expiry&&x.expiry<now.slice(0,10))fail(`${x.name} has expired`);if(x.stock<q)fail(`Not enough stock: ${x.name}`);return {id:x.id,name:x.name,sku:x.sku,variant:x.variant,qty:q,price:x.price,cost:x.cost}});
  const subtotal=money(lines.reduce((a,l)=>a+l.price*l.qty,0));const discount=channel==='Online'?0:money(p.discount||0);if(discount>subtotal)fail('Discount exceeds the sale total');const tax=money((subtotal-discount)*s.settings.tax/100);const total=money(subtotal-discount+tax);
  const payment=channel==='Online'?'Cash on delivery':p.payment;if(!['Cash','Card','Bank transfer','Cash on delivery'].includes(payment))fail('Invalid payment method');
  const order={id:id(),number:`SL-${String(s.orders.length+1).padStart(5,'0')}`,shop:sh.id,channel,customer:str(p.customer)||'Walk-in customer',phone:str(p.phone),address:str(p.address,500),lines,subtotal,discount,tax,total,payment,status:channel==='Online'?'Pending':'Completed',at:now,actor};
  if(channel==='Online'&&(!str(p.customer)||!str(p.phone)||!str(p.address)))fail('Customer name, phone and delivery address are required');
  lines.forEach(l=>move(product(l.id),-l.qty,`${channel} sale`,order.number));s.orders.unshift(order);if(p.requestId)s.requests.push({id:str(p.requestId),order:order.id});result={order};
 }else if(action==='orderStatus'){
  const o=s.orders.find(x=>x.id===p.id)||fail('Order not found');const transitions:Record<string,string[]>={Pending:['Processing','Cancelled'],Processing:['Shipped','Cancelled'],Shipped:['Completed'],Completed:['Returned']};
  if(!transitions[o.status]?.includes(p.status))fail('This order status change is not allowed');
  if(['Cancelled','Returned'].includes(p.status)){required(p.reason,'Return or cancellation reason');o.lines.forEach((l:RecordData)=>move(product(l.id),l.qty,p.status,o.number));o.reason=str(p.reason,500);o.refund=p.status==='Returned'?o.total:0}o.status=p.status;o.updated=now;if(p.status==='Shipped'){o.courier=str(p.courier);o.trackingNumber=str(p.trackingNumber)}
 }else if(action==='purchase'){
  shop(p.shop);const supplier=s.contacts.find(x=>x.id===p.supplier&&x.type==='Supplier')||fail('Select a supplier');const x=product(p.product);if(x.shop!==p.shop)fail('Product belongs to another shop');
  s.purchases.unshift({id:id(),number:`PO-${s.purchases.length+1}`,shop:p.shop,supplier:supplier.name,product:x.id,name:x.name,qty:qty(p.qty,1),cost:money(p.cost),status:'Ordered',at:now});
 }else if(action==='receive'){
  const po=s.purchases.find(x=>x.id===p.id)||fail('Purchase not found');if(po.status!=='Ordered')fail('Purchase already received');move(product(po.product),po.qty,'Purchase received',po.number);po.status='Received';po.received=now;
 }else if(action==='expense'){
  shop(p.shop);s.expenses.unshift({id:id(),shop:p.shop,name:required(p.name,'Expense description'),category:required(p.category,'Expense category'),amount:money(p.amount),at:now});
 }else if(action==='settings'){
  const tax=num(p.tax);if(tax>100)fail('Tax must be between 0 and 100');s.settings={business:required(p.business,'Business name'),currency:'LKR',tax};
 }else{fail('Unknown action')}
 s.audit.unshift({id:id(),action,actor,at:now,detail:str(p.name||p.reason||p.id||result.order?.number||action,300)});
 return result;
}
