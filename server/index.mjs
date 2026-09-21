import {createEmailAuth,configuredMailer} from './email-auth.mjs';
import http from 'node:http';
import {commerceRoutes} from './commerce-routes.mjs';
import { openDatabase } from './database.mjs';
import { createImageStorage } from './image-storage.mjs';
import { randomUUID, randomBytes, scrypt as scryptCallback, timingSafeEqual, createHash } from 'node:crypto';
import { promisify } from 'node:util';
import { readFileSync, writeFileSync, mkdirSync, existsSync, statSync, createReadStream } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { apply as applyDomain, emptyState } from '../lib/domain.ts';
import { authorize, scoped, profileFields } from '../lib/permissions.ts';
function apply(...args) { try { return applyDomain(...args); } catch(e) { e.status = e.status || 400; throw e; } }
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
if (existsSync(path.join(ROOT, '.env')))
    process.loadEnvFile(path.join(ROOT, '.env'));
const PORT = Number(process.env.PORT || 3000), HOST = process.env.HOST || '127.0.0.1';
const ORIGIN = process.env.APP_ORIGIN || process.env.RENDER_EXTERNAL_URL || `http://localhost:${PORT}`;
const allowedOrigins = new Set([new URL(ORIGIN).origin, ...(HOST === '127.0.0.1' ? [`http://localhost:${PORT}`, `http://127.0.0.1:${PORT}`, 'http://localhost:5173', 'http://127.0.0.1:5173'] : [])]);
const ERP_ONLY=process.env.ERP_ONLY==='true';
const commerceSecret=process.env.COMMERCE_API_SECRET;
if(ERP_ONLY&&(!commerceSecret||commerceSecret.length<32))throw new Error('ERP_ONLY requires a random COMMERCE_API_SECRET of at least 32 characters.');
function commerceClient(req){
 const received=req.headers['x-commerce-api-secret'];
 return typeof received==='string'&&!!commerceSecret&&timingSafeEqual(createHash('sha256').update(received).digest(),createHash('sha256').update(commerceSecret).digest());
}
const DATA = process.env.DATA_DIR || path.join(ROOT, 'data'), UPLOADS = path.join(DATA, 'uploads');
const db = await openDatabase(ROOT, DATA);
const images = createImageStorage(UPLOADS);
const emailEnabled=process.env.EMAIL_AUTH_ENABLED==='true';
function emailOrigin(value){const u=new URL(value);if(u.username||u.password||u.pathname!=='/'||u.search||u.hash|| (u.protocol!=='https:'&&!['localhost','127.0.0.1'].includes(u.hostname)))throw new Error('Email link origins must be HTTPS origins, without paths.');return u.origin}
const emailAuth=createEmailAuth(db,{enabled:emailEnabled,erpOrigin:emailOrigin(ORIGIN),storeOrigin:emailOrigin(process.env.STOREFRONT_URL||(!ERP_ONLY?ORIGIN:'http://localhost:3001')),sendMail:emailEnabled?configuredMailer():null});
if(emailEnabled&&ERP_ONLY&&!process.env.STOREFRONT_URL)throw new Error('Set STOREFRONT_URL before enabling email verification.');

const scrypt = promisify(scryptCallback), hash = v => createHash('sha256').update(v).digest('hex');
const fail = (m, status = 400) => { throw Object.assign(new Error(m), { status }); };
const text = (v, max = 300) => String(v ?? '').trim().slice(0, max);
const email = v => { const e = text(v, 254).toLowerCase(); if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(e))
    fail('Enter a valid email address'); return e; };
const validatePassword = p => { if (typeof p !== 'string' || p.length < 10 || p.length > 128)
    fail('Use a password with 10–128 characters'); return p; };
async function passwordHash(p) { const salt = randomBytes(16).toString('hex'); return salt + ':' + (await scrypt(validatePassword(p), salt, 64)).toString('hex'); }
async function checkPassword(p, stored) { if (typeof p !== 'string' || p.length > 128)
    return false; const [salt, key] = stored.split(':'); const actual = await scrypt(p, salt, 64); const expected = Buffer.from(key, 'hex'); return actual.length === expected.length && timingSafeEqual(actual, expected); }
const tx = fn => db.transaction(fn);
const read = async (id) => { const r = await db.prepare('SELECT data,revision FROM workspaces WHERE id=?').get(id); if (!r)
    fail('Business not found', 404); return { state: JSON.parse(r.data), revision: r.revision }; };
async function save(id, state, revision) { const data = JSON.stringify(state); if (Buffer.byteLength(data) > 1700000)
    fail('Project workspace limit reached. Export records before extending this prototype.'); const r = await db.prepare('UPDATE workspaces SET data=?,revision=revision+1 WHERE id=? AND revision=?').run(data, id, revision); if (!r.changes)
    fail('Data changed. Refresh and retry.', 409); }
const cookies = req => Object.fromEntries((req.headers.cookie || '').split(';').filter(x => x.includes('=')).map(x => { const [k, ...v] = x.trim().split('='); return [k, v.join('=')]; }));
const cookieName = kind => kind === 'customer' ? 'shop_session' : 'erp_session';
async function session(req, kind = 'erp', optional = false) { const token = cookies(req)[cookieName(kind)]; const u = token ? await db.prepare('SELECT u.* FROM users u JOIN sessions s ON s.user_id=u.id WHERE s.hash=? AND s.expires_at>? AND u.kind=?').get(hash(token), Date.now(), kind) : null; if (!u && !optional)
    fail('Please sign in', 401); if(u&&emailEnabled&&!await emailAuth.verified(u)){if(optional)return null;fail('Verify your email before signing in. Use Resend verification email on the login page.',403)} return u; }
async function identity(req) { const u = await session(req); if (u.role === 'Owner')
    return { userId: u.id, email: u.email, workspace: u.workspace, role: 'Owner', shop: null, profile: u }; const g = await db.prepare("SELECT * FROM access WHERE user_id=? AND email=? AND workspace=? AND status='active'").get(u.id, u.email, u.workspace); if (!g || !['Manager', 'Cashier'].includes(g.role))
    fail('Your staff access is no longer active. Contact your shop owner.', 403); return { userId: u.id, email: u.email, workspace: g.workspace, role: g.role, shop: g.shop, profile: u }; }
function safeUser(u) { if (!u)
    return null; const { password_hash, ...safe } = u; return safe; }
async function setSession(res, u) { await db.prepare('DELETE FROM sessions WHERE expires_at<=?').run(Date.now()); const token = randomBytes(32).toString('hex'); await db.prepare('INSERT INTO sessions(hash,user_id,expires_at) VALUES(?,?,?)').run(hash(token), u.id, Date.now() + 12 * 3600000); res.setHeader('Set-Cookie', `${cookieName(u.kind)}=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=43200${process.env.COOKIE_SECURE === 'true' ? '; Secure' : ''}`); }
const rates = new Map();
function throttle(req, key, max = 30) { const k = `${req.socket.remoteAddress}:${key}`; const now = Date.now(); if (rates.size > 5000)
    for (const [id, v] of rates)
        if (v.until < now)
            rates.delete(id); const v = rates.get(k); if (v && v.until > now) {
    if (++v.count > max)
        fail('Too many attempts. Please try again in 15 minutes.', 429);
}
else
    rates.set(k, { until: now + 900000, count: 1 }); }
async function body(req, max = 100000) { let size = 0; const chunks = []; for await (const chunk of req) {
    size += chunk.length;
    if (size > max)
        fail('Request too large', 413);
    chunks.push(chunk);
} return Buffer.concat(chunks); }
async function json(req) { if (!String(req.headers['content-type'] || '').includes('application/json'))
    fail('Send application/json', 415); try {
    const parsed=JSON.parse((await body(req)).toString());
        if(ERP_ONLY&&req.url.startsWith('/api/auth/')){if(commerceClient(req)){if(parsed.kind!=='customer')fail('Customer account required',403)}else if(parsed.kind==='customer')fail('Use the customer website',403)}
        return parsed;
}
catch (e) {
    if (e.status)
        throw e;
    fail('Invalid JSON');
} }
function send(res, value, status = 200) { res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' }); res.end(JSON.stringify(value)); }
function projected(workspace, state, p) {
    const imageUrl=value=>ERP_ONLY&&value?.startsWith('/uploads/')?new URL(value,ORIGIN).href:value; const sh = state.shops.find(x => x.id === p.shop); if (!sh)
    return null; return { key: `${workspace}:${p.id}`, id: p.id, business_id: workspace, shop_id: p.shop, shop_name: sh.name, shop_city: sh.location, shop_phone: sh.phone, shop_description: sh.description || '', business_name: state.settings.business, name: p.name, description: p.description, category: p.category, variant: p.variant, brand: p.brand, sku: p.sku, price: p.price, stock: p.stock, images: (p.images?.length ? p.images : p.image ? [p.image] : []).map(imageUrl), image: imageUrl(p.image) || '', tax_rate: state.settings.tax, currency: 'LKR', updated: p.updated }; }
async function catalog(workspace) { const rows = workspace ? [{ id: workspace, ...await db.prepare('SELECT data FROM workspaces WHERE id=?').get(workspace) }] : await db.prepare('SELECT id,data FROM workspaces').all(); return rows.flatMap(r => { if (!r.data)
    return []; const state = JSON.parse(r.data); return state.products.filter(p => p.published && (!p.expiry || p.expiry >= new Date().toISOString().slice(0, 10))).map(p => projected(r.id, state, p)).filter(Boolean); }); }
async function mutate(workspace, action, p, actor, expected) { return await tx(async () => { const { state, revision } = await read(workspace); if (p.requestId) {
    const old = state.requests.find(r => r.id === p.requestId);
    if (old) {
        if (old.signature !== JSON.stringify({ ...p, requestId: undefined }))
            fail('Idempotency key already used for different details', 409);
        return { state, revision, result: { order: state.orders.find(x => x.id === old.order), duplicate: true } };
    }
} if (expected !== undefined && expected !== revision)
    fail('Data changed. Refresh and retry.', 409); const result = apply(state, action, p, actor); if (p.requestId) {
    const r = state.requests.find(x => x.id === p.requestId);
    if (r)
        r.signature = JSON.stringify({ ...p, requestId: undefined });
} await save(workspace, state, revision); return { state, revision: revision + 1, result }; }); }
async function external(req) { const key = String(req.headers.authorization || '').replace(/^Bearer /, ''); const r = await db.prepare('SELECT workspace FROM integrations WHERE hash=?').get(hash(key)); if (!r)
    fail('Valid API key required', 401); return r.workspace; }
function customerOrder(u, workspace, o, state) { const { lines, actor, ...rest } = o; return { ...rest, workspace, shop_name: state.shops.find(x => x.id === o.shop)?.name, lines: lines.map(({ cost, ...l }) => l) }; }
async function api(req, res, url) {
    const route = url.pathname;
    if(ERP_ONLY){
        if(req.headers['x-commerce-api-secret']&&!commerceClient(req))fail('Invalid commerce API credentials',401);
        if(commerceClient(req)&&!commerceRoutes.get(route)?.includes(req.method))fail('Customer API operation not allowed',403);
        if(route.startsWith('/api/store/')&&!commerceClient(req))fail('Commerce API credentials required',401);
        if(route==='/api/auth/session'){
            if(commerceClient(req)&&url.searchParams.get('kind')!=='customer')fail('Customer account required',403);
            if(!commerceClient(req)&&url.searchParams.get('kind')==='customer')fail('Use the customer website',403);
        }
    }
    if (route === '/api/health')
        return send(res, { ok: true, application: 'ShopLink ERP + Commerce' });
    if (route === '/api/auth/session') {
        const kind = url.searchParams.get('kind') === 'customer' ? 'customer' : 'erp';
        const u = await session(req, kind, true);
        if (kind === 'erp' && u)
            await identity(req);
        return send(res, { user: safeUser(u) });
    }
    if (['/api/auth/forgot-password','/api/auth/resend-verification','/api/auth/verify-email','/api/auth/reset-password'].includes(route) && req.method==='POST') {
        throttle(req,'email-auth',60);
        const p=await json(req),kind=p.kind==='customer'?'customer':'erp';
        if(route.endsWith('/forgot-password')||route.endsWith('/resend-verification'))return send(res,await emailAuth.request(kind,email(p.email),route.endsWith('/forgot-password')?'reset':'verify'));
        const purpose=route.endsWith('/reset-password')?'reset':'verify';
        const next=purpose==='reset'?await passwordHash(p.newPassword):undefined;
        return send(res,await emailAuth.consume(kind,p.token,purpose,next));
    }
    if (route === '/api/auth/register' && req.method === 'POST') {
        throttle(req, 'register', 20);
        const p = await json(req);
        const kind = p.kind === 'customer' ? 'customer' : 'erp';
        const mail = email(p.email), fields = profileFields(p);
        const pass = await passwordHash(p.password);
        const uid = randomUUID(), now = new Date().toISOString();
        await tx(async () => {
            if (await db.prepare('SELECT id FROM users WHERE kind=? AND email=?').get(kind, mail))
                fail('An account already exists for this email. Please sign in.');
            let role = 'Customer', workspace = null;
            if (kind === 'erp') {
                if (p.accountType === 'staff') {
                    const g = await db.prepare("SELECT * FROM access WHERE email=? AND status='pending' AND invite_hash=?").get(mail, hash(text(p.inviteCode, 200)));
                    if (!g)
                        fail('Invitation code or email is incorrect', 403);
                    if (!(await read(g.workspace)).state.shops.some(x => x.id === g.shop))
                        fail('Assigned shop is unavailable');
                    role = 'Staff';
                    workspace = g.workspace;
                    await db.prepare("UPDATE access SET status='active',user_id=? WHERE email=?").run(uid, mail);
                }
                else {
                    role = 'Owner';
                    workspace = uid;
                    const s = emptyState();
                    const business = text(p.business), shopName = text(p.shopName), category = text(p.category), address = text(p.shopAddress, 500), city = text(p.city), phone = text(p.shopPhone, 25);
                    if (!business || !shopName || !category || !address || !city || !phone)
                        fail('Complete all required shop details');
                    s.settings.business = business;
                    apply(s, 'shop', { name: shopName, category, address, location: city, phone, description: text(p.description, 2000) }, mail);
                    await db.prepare('INSERT INTO workspaces(id,data,revision) VALUES(?,?,0)').run(workspace, JSON.stringify(s));
                }
            }
            await db.prepare('INSERT INTO users(id,kind,email,full_name,phone,address,password_hash,role,workspace,created_at) VALUES(?,?,?,?,?,?,?,?,?,?)').run(uid, kind, mail, fields.fullName, fields.phone, text(p.address, 500), pass, role, workspace, now);
        });
        const u = await db.prepare('SELECT * FROM users WHERE id=?').get(uid);
        if(emailEnabled){await emailAuth.request(kind,mail,'verify');return send(res,{verificationRequired:true,message:'Account created. Check your email to verify before signing in. If no email arrives, use Resend verification email.'},201)}
        await setSession(res, u);
        return send(res, { user: safeUser(u) }, 201);
    }
    if (route === '/api/auth/login' && req.method === 'POST') {
        throttle(req, 'login');
        const p = await json(req);
        const kind = p.kind === 'customer' ? 'customer' : 'erp';
        const u = await db.prepare('SELECT * FROM users WHERE kind=? AND email=?').get(kind, email(p.email));
        const valid = await checkPassword(p.password, u?.password_hash || '00000000000000000000000000000000:' + ('0'.repeat(128)));
        if (!u || !valid)
            fail('Email or password is incorrect', 401);
        if(emailEnabled&&!await emailAuth.verified(u))return send(res,{error:'Verify your email before signing in. Use Resend verification email below.',verificationRequired:true},403);
        if (u.role === 'Staff' && !await db.prepare("SELECT email FROM access WHERE user_id=? AND status='active'").get(u.id))
            fail('Your staff access is no longer active', 403);
        await setSession(res, u);
        return send(res, { user: safeUser(u) });
    }
    if (route === '/api/auth/logout' && req.method === 'POST') {
        const p = await json(req), kind = p.kind === 'customer' ? 'customer' : 'erp';
        const token = cookies(req)[cookieName(kind)];
        if (token)
            await db.prepare('DELETE FROM sessions WHERE hash=?').run(hash(token));
        res.setHeader('Set-Cookie', `${cookieName(kind)}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`);
        return send(res, { ok: true });
    }
    if (route === '/api/auth/password' && req.method === 'POST') {
        throttle(req, 'password', 10);
        const p = await json(req), u = await session(req, p.kind === 'customer' ? 'customer' : 'erp');
        if (!await checkPassword(p.currentPassword, u.password_hash))
            fail('Current password is incorrect', 403);
        const next = await passwordHash(p.newPassword);
        await tx(async () => { await db.prepare('UPDATE users SET password_hash=? WHERE id=?').run(next, u.id); await db.prepare('DELETE FROM sessions WHERE user_id=?').run(u.id); });
        await setSession(res, u);
        return send(res, { ok: true });
    }
    if (route === '/api/profile' && req.method === 'POST') {
        const who = await identity(req), p = await json(req), f = profileFields(p);
        await db.prepare('UPDATE users SET full_name=?,phone=? WHERE id=?').run(f.fullName, f.phone, who.userId);
        return send(res, { ok: true });
    }
    if (route === '/api/erp') {
        const who = await identity(req);
        if (req.method === 'GET') {
            const r = await read(who.workspace);
            const members = who.role === 'Owner' ? await db.prepare('SELECT email,role,shop,status FROM access WHERE workspace=?').all(who.workspace) : [];
            return send(res, { ...r, state: scoped(r.state, who), who: { ...who, profile: safeUser(who.profile) }, members });
        }
        if (req.method !== 'POST')
            fail('Method not allowed', 405);
        const { action, payload = {}, revision } = await json(req);
        const { state } = await read(who.workspace);
        try {
            authorize(action, payload, state, who);
        }
        catch (e) {
            fail(e.message, 403);
        }
        if (action === 'contact' && who.role !== 'Owner')
            payload.shop = who.shop;
        if (action === 'member') {
            const mail = email(payload.email);
            if (mail === who.email)
                fail('Use a staff member’s email');
            if (payload.remove) {
                await db.prepare('DELETE FROM access WHERE email=? AND workspace=?').run(mail, who.workspace);
                return send(res, { ok: true });
            }
            if (!['Manager', 'Cashier'].includes(payload.role) || !state.shops.some(x => x.id === payload.shop))
                fail('Select a valid role and shop');
            const existing = await db.prepare('SELECT * FROM access WHERE email=?').get(mail), registered = await db.prepare("SELECT * FROM users WHERE kind='erp' AND email=?").get(mail);
            if ((existing && existing.workspace !== who.workspace) || (registered && registered.workspace !== who.workspace))
                fail('Account belongs to another business');
            const code = randomBytes(24).toString('hex');
            await db.prepare("INSERT INTO access(email,workspace,role,shop,status,user_id,invite_hash) VALUES(?,?,?,?,'pending',?,?) ON CONFLICT(email) DO UPDATE SET role=excluded.role,shop=excluded.shop,invite_hash=excluded.invite_hash,status=CASE WHEN access.user_id IS NOT NULL THEN 'active' ELSE 'pending' END").run(mail, who.workspace, payload.role, payload.shop, registered?.id || null, hash(code));
            if (registered)
                await db.prepare("UPDATE access SET status='active' WHERE email=?").run(mail);
            return send(res, { ok: true, inviteCode: registered ? null : code });
        }
        if (action === 'key') {
            const key = 'sl_' + randomBytes(32).toString('hex');
            await tx(async () => { await db.prepare('DELETE FROM integrations WHERE workspace=?').run(who.workspace); await db.prepare('INSERT INTO integrations(hash,workspace) VALUES(?,?)').run(hash(key), who.workspace); });
            return send(res, { token: key });
        }
        const r = await mutate(who.workspace, action, payload, who.email, revision);
        if (who.role === 'Cashier' && r.result.order)
            r.result.order = customerOrder(null, who.workspace, r.result.order, r.state);
        return send(res, { ...r, state: scoped(r.state, who) });
    }
    if (route === '/api/uploads' && req.method === 'POST') {
        const who = await identity(req);
        if (!['Owner', 'Manager'].includes(who.role))
            fail('Only owners and managers can upload images', 403);
        throttle(req, 'upload', 100);
        const mime = String(req.headers['content-type'] || '').split(';')[0];
        const types = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' };
        if (!types[mime])
            fail('Use JPG, PNG or WebP images');
        const bytes = await body(req, 5 * 1024 * 1024);
        const valid = mime === 'image/png' ? bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])) : mime === 'image/jpeg' ? bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255 : bytes.toString('ascii', 0, 4) === 'RIFF' && bytes.toString('ascii', 8, 12) === 'WEBP';
        if (!valid)
            fail('File contents do not match the image type');
        const filename = randomUUID() + '.' + types[mime];
        const imageUrl = await images.put(filename, bytes, mime);
        try { await db.prepare('INSERT INTO uploads VALUES(?,?,?,?,?)').run(filename, who.workspace, mime, bytes.length, new Date().toISOString()); } catch(e) { await images.remove(filename); throw e; }
        return send(res, { url: imageUrl }, 201);
    }
    if (route === '/api/store/catalog' && req.method === 'GET') {
        let products = await catalog();
        const q = text(url.searchParams.get('q')).toLowerCase(), category = url.searchParams.get('category'), shop = url.searchParams.get('shop');
        if (q)
            products = products.filter(p => `${p.name} ${p.shop_name} ${p.description} ${p.brand}`.toLowerCase().includes(q));
        if (category)
            products = products.filter(p => p.category === category);
        if (shop)
            products = products.filter(p => `${p.business_id}:${p.shop_id}` === shop);
        return send(res, { products });
    }
    if (route === '/api/store/profile') {
        const u = await session(req, 'customer');
        if (req.method === 'GET')
            return send(res, { user: safeUser(u) });
        if (req.method !== 'POST')
            fail('Method not allowed', 405);
        const p = await json(req), f = profileFields(p);
        await db.prepare('UPDATE users SET full_name=?,phone=?,address=? WHERE id=?').run(f.fullName, f.phone, text(p.address, 500), u.id);
        return send(res, { user: safeUser(await db.prepare('SELECT * FROM users WHERE id=?').get(u.id)) });
    }
    if (route === '/api/store/orders') {
        const u = await session(req, 'customer');
        if (req.method === 'GET') {
            const records = await db.prepare('SELECT * FROM customer_orders WHERE customer_id=? ORDER BY created_at DESC').all(u.id);
            return send(res, { orders: (await Promise.all(records.map(async (r) => { const { state } = await read(r.workspace); const o = state.orders.find(x => x.id === r.order_id); return o ? customerOrder(u, r.workspace, o, state) : null; }))).filter(Boolean) });
        }
        if (req.method !== 'POST')
            fail('Method not allowed', 405);
        const p = await json(req);
        const requestId = text(req.headers['idempotency-key'], 100);
        if (!requestId)
            fail('Idempotency-Key is required');
        const signature = hash(JSON.stringify(p));
        const output = await tx(async () => {
            const prior = await db.prepare('SELECT * FROM checkouts WHERE customer_id=? AND request_id=?').get(u.id, requestId);
            if (prior) {
                if (prior.signature !== signature)
                    fail('Checkout key was used for different details', 409);
                return JSON.parse(prior.response);
            }
            if (!Array.isArray(p.lines) || !p.lines.length || p.lines.length > 100)
                fail('Add between 1 and 100 products');
            const delivery = profileFields({ fullName: p.name, phone: p.phone });
            const address = text(p.address, 500);
            if (!address)
                fail('Delivery address is required');
            const states = new Map(), groups = new Map();
            for (const line of p.lines) {
                const [ws, pid] = String(line.key).split(':');
                if (!ws || !pid)
                    fail('Invalid product');
                if (!states.has(ws))
                    states.set(ws, await read(ws));
                const state = states.get(ws).state;
                const item = state.products.find(x => x.id === pid);
                if (!item || !item.published)
                    fail('An item is no longer available', 409);
                if (Number(line.expectedPrice) !== item.price || Number(line.expectedTax) !== state.settings.tax)
                    fail('A price or tax rate changed. Refresh your cart before ordering.', 409);
                const key = `${ws}:${item.shop}`;
                if (!groups.has(key))
                    groups.set(key, { ws, shop: item.shop, lines: [] });
                groups.get(key).lines.push({ id: pid, qty: line.qty });
            }
            const orders = [];
            for (const g of groups.values()) {
                const state = states.get(g.ws).state;
                const result = apply(state, 'sale', { shop: g.shop, channel: 'Online', customer: delivery.fullName, phone: delivery.phone, address, lines: g.lines }, u.email);
                result.order.customerAccount = u.id;
                orders.push(customerOrder(u, g.ws, result.order, state));
                await db.prepare('INSERT INTO customer_orders VALUES(?,?,?,?)').run(u.id, g.ws, result.order.id, result.order.at);
            }
            for (const [ws, r] of states)
                await save(ws, r.state, r.revision);
            const result = { orders, total: Math.round(orders.reduce((a, o) => a + o.total, 0) * 100) / 100 };
            await db.prepare('INSERT INTO checkouts VALUES(?,?,?,?)').run(u.id, requestId, signature, JSON.stringify(result));
            return result;
        });
        return send(res, output, 201);
    }
    if (route === '/api/store/cancel' && req.method === 'POST') {
        const u = await session(req, 'customer'), p = await json(req);
        if (!await db.prepare('SELECT order_id FROM customer_orders WHERE customer_id=? AND workspace=? AND order_id=?').get(u.id, p.workspace, p.id))
            fail('Order not found', 404);
        await tx(async () => { const { state, revision } = await read(p.workspace); const order = state.orders.find(x => x.id === p.id); if (order?.status !== 'Pending')
            fail('Only pending orders can be cancelled. Contact the shop for other orders.'); apply(state, 'orderStatus', { id: p.id, status: 'Cancelled', reason: 'Cancelled by customer' }, u.email); await save(p.workspace, state, revision); });
        return send(res, { ok: true });
    }
    if (route === '/api/catalog' && req.method === 'GET') {
        const ws = await external(req);
        let products = await catalog(ws);
        if (url.searchParams.get('shop'))
            products = products.filter(p => p.shop_id === url.searchParams.get('shop'));
        if (url.searchParams.get('category'))
            products = products.filter(p => p.category === url.searchParams.get('category'));
        return send(res, { products });
    }
    if (route === '/api/orders' && req.method === 'POST') {
        const ws = await external(req), p = await json(req), requestId = text(req.headers['idempotency-key'], 100);
        if (!requestId)
            fail('Idempotency-Key is required');
        const r = await mutate(ws, 'sale', { ...p, channel: 'Online', requestId }, 'E-commerce integration');
        return send(res, { order: customerOrder(null, ws, r.result.order, r.state) }, r.result.duplicate ? 200 : 201);
    }
    fail('API route not found', 404);
}
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.webp': 'image/webp', '.ico': 'image/x-icon' };
const server = http.createServer(async (req, res) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
    res.setHeader('Content-Security-Policy', "default-src 'self'; img-src 'self' https: data: blob:; style-src 'self' 'unsafe-inline'; script-src 'self'; connect-src 'self'; font-src 'self' data:; frame-ancestors 'none'; base-uri 'self'");
    try {
        const url = new URL(req.url, 'http://localhost');
        if (req.method === 'OPTIONS') {
            res.writeHead(405);
            return res.end();
        }
        if (!['GET', 'HEAD'].includes(req.method) && req.headers.origin && !allowedOrigins.has(req.headers.origin))
            fail('Request origin not allowed', 403);
        if(ERP_ONLY&&url.pathname==='/'){res.writeHead(302,{Location:'/erp'});return res.end()}
        if(ERP_ONLY&&url.pathname==='/storefront'){
            if(!process.env.STOREFRONT_URL)fail('Set STOREFRONT_URL to your separate customer website address',503);
            const target=new URL(process.env.STOREFRONT_URL);if(target.protocol!=='https:'&&!['localhost','127.0.0.1'].includes(target.hostname))fail('Invalid storefront URL',503);
            res.writeHead(302,{Location:target.href});return res.end();
        }
        if(!ERP_ONLY&&url.pathname==='/storefront'){res.writeHead(302,{Location:'/'});return res.end()}
        if(ERP_ONLY&&['/login','/signup'].includes(url.pathname))fail('Customer pages are hosted on the separate storefront',404);
        if (url.pathname.startsWith('/api/'))
            return await api(req, res, url);
        if (!['GET', 'HEAD'].includes(req.method))
            fail('Method not allowed', 405);
        if(ERP_ONLY&&!path.extname(url.pathname)&&!['/erp','/erp/login','/erp/signup'].includes(url.pathname))fail('Page not found',404);
        let file;
        if (url.pathname.startsWith('/uploads/')) {
            const name = url.pathname.slice(9);
            if (!/^[a-f0-9-]+\.(jpg|png|webp)$/.test(name) || !await db.prepare('SELECT filename FROM uploads WHERE filename=?').get(name))
                fail('Image not found', 404);
            if(images.url(name)){res.writeHead(302,{Location:images.url(name)});return res.end();}
            file = path.join(UPLOADS, name);
        }
        else {
            const base = path.join(ROOT, 'dist');
            const relative = decodeURIComponent(url.pathname).replace(/^\/+/, '');
            file = path.resolve(base, relative);
            if (!file.startsWith(base + path.sep) && file !== base)
                fail('Not found', 404);
            if (!existsSync(file) || statSync(file).isDirectory()) {
                if (path.extname(url.pathname))
                    fail('File not found', 404);
                file = path.join(base, 'index.html');
            }
        }
        if (!existsSync(file))
            fail('Frontend build missing. Run pnpm build.', 503);
        res.setHeader('Content-Type', MIME[path.extname(file)] || 'application/octet-stream');
        res.setHeader('Cache-Control', file.includes(path.sep + 'uploads' + path.sep) ? 'public, max-age=86400' : 'no-cache');
        res.writeHead(200);
        if (req.method === 'HEAD')
            return res.end();
        createReadStream(file).pipe(res);
    }
    catch (e) {
        if (!res.headersSent) {
            const duplicate = e.code === '23505' || /UNIQUE constraint/.test(e.message);
            const status = e.status || (duplicate ? 409 : 503);
            const message = e.status ? e.message : duplicate ? 'A record already exists. Refresh and retry.' : 'The service could not complete this request. Please retry shortly.';
            if(!e.status) console.error('Request failed:', e.code || e.name);
            send(res, { error: message }, status);
        }
        else
            res.end();
    }
});
server.listen(PORT, HOST, () => console.log(`ShopLink ready: ${ORIGIN}\nERP: ${ORIGIN}/erp\nData: ${DATA}`));
for (const signal of ['SIGTERM', 'SIGINT'])
    process.on(signal, () => server.close(async () => { await db.close(); process.exit(0); }));
