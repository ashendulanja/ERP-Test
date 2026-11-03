import 'dotenv/config';
import express from 'express';
import helmet from 'helmet';
import cookieParser from 'cookie-parser';
import rateLimit from 'express-rate-limit';
import pg from 'pg';
import {hashPassword,verifyPassword,hashToken,newToken,publicAccount} from './security.mjs';
import {randomUUID} from 'node:crypto';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

if(!process.env.DATABASE_URL)throw Error('DATABASE_URL is required. Read README.md.');
const production=process.env.NODE_ENV==='production';
const pool=new pg.Pool({connectionString:process.env.DATABASE_URL,
 ssl:production?{rejectUnauthorized:true}:undefined,max:10,connectionTimeoutMillis:10000,
 idleTimeoutMillis:30000});
const app=express();app.disable('x-powered-by');app.set('trust proxy',1);
const cookieName=production?'__Host-nexa_sid':'nexa_sid';
app.use(helmet({contentSecurityPolicy:{directives:{defaultSrc:["'self'"],scriptSrc:["'self'"],
 styleSrc:["'self'"],imgSrc:["'self'","data:"],connectSrc:["'self'"],objectSrc:["'none'"],
 frameAncestors:["'none'"],baseUri:["'self'"],formAction:["'self'"]}}}));
app.use(express.json({limit:'1mb'}));app.use(cookieParser());
app.use((req,res,next)=>{res.set('Cache-Control','no-store');next()});
const route=fn=>(req,res,next)=>Promise.resolve(fn(req,res)).catch(next);
const bad=(status,message)=>Object.assign(new Error(message),{status});
const sendJson=(res,obj,status=200)=>res.status(status).json(obj);
const txt=(x,name,max=255)=>{if(typeof x!=='string'||!x.trim()||x.length>max)throw bad(400,`Invalid ${name}`);return x.trim()};
const str=(x,max=255)=>String(x??'').slice(0,max);
const val=(x,name,min=0,max=1e12)=>{let n=Number(x);if(!Number.isFinite(n)||n<min||n>max)throw bad(400,`Invalid ${name}`);return n};
const positive=(x,name)=>{const n=val(x,name,0.000001,1e12);return n};
const round2=n=>Math.round((n+Number.EPSILON)*100)/100;
const round3=n=>Math.round((n+Number.EPSILON)*1000)/1000;
const isId=x=>typeof x==='string'&&/^[\da-f]{8}-[\da-f]{4}-[1-8][\da-f]{3}-[89ab][\da-f]{3}-[\da-f]{12}$/i.test(x);
function checkId(x){if(!isId(x))throw bad(400,'Invalid record ID');return x}
const permit=(u,right)=>u.role==='admin'||(u.permissions||[]).includes('all')||(u.permissions||[]).includes(right);
const need=(req,right)=>{if(!permit(req.user,right))throw bad(403,`Permission required: ${right}`)};
const needAny=(req,rights)=>{if(!rights.some(r=>permit(req.user,r)))throw bad(403,'Insufficient permissions')};
const hasCost=u=>u.role==='admin'||u.show_cost;
const limiter=rateLimit({windowMs:15*60*1000,limit:10,standardHeaders:'draft-7',legacyHeaders:false,
 message:{error:'Too many attempts. Retry later.'}});
const sessionDays=1;
function setCookie(res,token){res.cookie(cookieName,token,{httpOnly:true,secure:production,
 sameSite:'strict',path:'/'});}
function clearCookie(res){res.clearCookie(cookieName,{httpOnly:true,secure:production,sameSite:'strict',path:'/'});}

async function auth(req,res,next){try{
 const token=req.cookies[cookieName];if(typeof token!=='string'||token.length<32)throw bad(401,'Sign in required');
 const result=await pool.query(`select a.* from public.app_session s
 join public.account a on a.id=s.account_id
 where s.token_hash=$1 and s.expires_at>now() and a.active=true`,[hashToken(token)]);
 if(!result.rowCount)throw bad(401,'Session expired');
 req.user=result.rows[0];next();
}catch(e){next(e)}}
function guardWrite(req,res,next){
 const allowed=process.env.APP_ORIGIN;
 const origin=req.get('origin');
 if(allowed&&origin&&origin!==allowed)return next(bad(403,'Invalid request origin'));
 if(req.get('X-Nexa-Request')!=='1')return next(bad(403,'Missing request protection header'));
 next();
}
async function transactional(fn){const c=await pool.connect();try{
 await c.query('BEGIN');const output=await fn(c);await c.query('COMMIT');return output;
}catch(e){await c.query('ROLLBACK');throw e}finally{c.release()}}
async function audit(c,user,action,details={}){await c.query('insert into public.audit_event(account_id,action,details) values($1,$2,$3)',
 [user.id,action,JSON.stringify(details)])}
async function number(c,kind,prefix){const r=await c.query('update public.app_sequence set val=val+1 where kind=$1 returning val',[kind]);
 if(!r.rowCount)throw bad(500,'Sequence configuration missing');
 const day=new Date().toISOString().slice(0,7).replace('-','');
 return `${prefix}-${day}-${String(r.rows[0].val).padStart(6,'0')}`;}
async function login(req,res){
 const username=txt(req.body?.username,'username',120),password=req.body?.password;
 if(typeof password!=='string'||password.length>256)throw bad(400,'Invalid password');
 const r=await pool.query('select * from public.account where username=$1',[username]);
 const user=r.rows[0];
 const success=user&&user.active&&(!user.locked_until||new Date(user.locked_until)<=new Date())&&await verifyPassword(password,user.password_hash);
 if(!success){
  if(user){await pool.query(`update public.account set failed_attempts=failed_attempts+1,
   locked_until=case when failed_attempts+1>=5 then now()+interval '15 minutes' else locked_until end where id=$1`,[user.id]);}
  throw bad(401,'Incorrect username or password');
 }
 await pool.query('update public.account set failed_attempts=0,locked_until=null where id=$1',[user.id]);
 const token=newToken();
 await pool.query(`insert into public.app_session(token_hash,account_id,expires_at)
 values($1,$2,now()+interval '24 hours')`,[hashToken(token),user.id]);
 setCookie(res,token);sendJson(res,{user:publicAccount(user)});
}
app.post('/api/login',limiter,guardWrite,route(login));
app.get('/api/health',route(async(req,res)=>{await pool.query('select 1');sendJson(res,{ok:true,service:'Nexa BillSuite API'})}));
app.use('/api',auth);
app.use('/api',(req,res,next)=>{if(req.user.must_change_password && !['/me','/change-password','/logout'].includes(req.path))return next(bad(403,'Change your initial password first'));next()});
app.get('/api/me',route(async(req,res)=>sendJson(res,{user:publicAccount(req.user)})));
app.post('/api/logout',guardWrite,route(async(req,res)=>{
 await pool.query('delete from public.app_session where token_hash=$1',[hashToken(req.cookies[cookieName])]);
 clearCookie(res);sendJson(res,{ok:true});
}));
app.post('/api/change-password',guardWrite,route(async(req,res)=>{
 const old=req.body?.oldPassword,next=req.body?.newPassword;
 if(!await verifyPassword(old,req.user.password_hash))throw bad(403,'Current password incorrect');
 if(typeof next!=='string'||next.length<12||next.length>256)throw bad(400,'Use a new password of at least 12 characters');
 if(next===old)throw bad(400,'Choose a different password');
 await transactional(async c=>{
  await c.query(`update public.account set password_hash=$1,must_change_password=false,updated_at=now() where id=$2`,
   [await hashPassword(next),req.user.id]);
  await c.query('delete from public.app_session where account_id=$1 and token_hash<>$2',
   [req.user.id,hashToken(req.cookies[cookieName])]);
  await audit(c,req.user,'account.password_change');
 });sendJson(res,{ok:true});
}));
app.get('/api/accounts',route(async(req,res)=>{
 if(req.user.role!=='admin')throw bad(403,'Administrator required');
 const r=await pool.query('select * from public.account order by created_at');
 sendJson(res,{accounts:r.rows.map(publicAccount)});
}));
app.post('/api/accounts',guardWrite,route(async(req,res)=>{
 if(req.user.role!=='admin')throw bad(403,'Administrator required');
 const b=req.body||{},username=txt(b.username,'username',120),name=txt(b.name,'name',120);
 const role=['admin','staff','cashier'].includes(b.role)?b.role:'cashier';
 if(typeof b.password!=='string'||b.password.length<12||b.password.length>256)throw bad(400,'New account password must be 12+ characters');
 const permissions=role==='admin'?['all']:Array.isArray(b.permissions)?b.permissions.filter(x=>typeof x==='string').slice(0,30):[];
 const screens=role==='admin'?['dashboard','pos','sales','quotes','proformas','products','stock','inventory','discounts','purchases','customers','suppliers','expenses','returns','barcode','printmanager','reports','bulk','accounts','settings']:
 Array.isArray(b.screens)?b.screens.filter(x=>typeof x==='string').slice(0,30):['pos'];
 const hash=await hashPassword(b.password);
 const r=await transactional(async c=>{
  const out=await c.query(`insert into public.account(username,display_name,password_hash,role,permissions,screens,show_cost,active,must_change_password)
   values($1,$2,$3,$4,$5,$6,$7,$8,true) returning *`,[username,name,hash,role,permissions,screens,role==='admin'||!!b.showCost,b.active!==false]);
  await audit(c,req.user,'account.create',{id:out.rows[0].id,username});return out.rows[0];
 });sendJson(res,{account:publicAccount(r)},201);
}));
app.patch('/api/accounts/:id',guardWrite,route(async(req,res)=>{
 if(req.user.role!=='admin')throw bad(403,'Administrator required');checkId(req.params.id);
 const b=req.body||{};const result=await transactional(async c=>{
 const old=await c.query('select * from public.account where id=$1 for update',[req.params.id]);
 if(!old.rowCount)throw bad(404,'Account not found');
 const current=old.rows[0],role=['admin','staff','cashier'].includes(b.role)?b.role:current.role;
 if(current.id===req.user.id&&(role!=='admin'||b.active===false))throw bad(400,'Cannot deactivate or demote current admin');
 const permissions=role==='admin'?['all']:Array.isArray(b.permissions)?b.permissions.slice(0,30):current.permissions;
 const screens=role==='admin'?current.screens:Array.isArray(b.screens)?b.screens.slice(0,30):current.screens;
 const hashed=b.password?await hashPassword(b.password):current.password_hash;
 if(b.password&&b.password.length<12)throw bad(400,'New password must be at least 12 characters');
 const r=await c.query(`update public.account set username=$1,display_name=$2,password_hash=$3,role=$4,
 permissions=$5,screens=$6,show_cost=$7,active=$8,must_change_password=$9,updated_at=now()
 where id=$10 returning *`,[b.username?txt(b.username,'username',120):current.username,
 b.name?txt(b.name,'name',120):current.display_name,hashed,role,permissions,screens,
 role==='admin'||(b.showCost===undefined?current.show_cost:!!b.showCost),
 b.active===undefined?current.active:!!b.active,b.password?true:current.must_change_password,req.params.id]);
 if(b.password||b.active===false)await c.query('delete from public.app_session where account_id=$1',[current.id]);
 await audit(c,req.user,'account.update',{id:current.id,passwordChanged:!!b.password});return r.rows[0];
 });sendJson(res,{account:publicAccount(result)});
}));

// Data APIs use the database as the source of truth, never browser storage.
const selectProduct=`id,sku,barcode,name,other_name,category,brand,unit,pack_name,pack_factor,cost,retail,wholesale,qty,reorder_qty,taxable,active,details,created_at,updated_at`;
function maskProduct(p,u){if(hasCost(u))return p;const {cost,...rest}=p;return rest}
app.get('/api/products',route(async(req,res)=>{
 needAny(req,['billing','products-edit','grn','stock-adjust','barcode','reports']);
 const r=await pool.query(`select ${selectProduct} from public.product order by name limit 10000`);
 sendJson(res,{products:r.rows.map(x=>maskProduct(x,req.user))});
}));
app.post('/api/products',guardWrite,route(async(req,res)=>{
 need(req,'products-edit');const b=req.body||{};
 const sku=txt(b.sku,'SKU',80),name=txt(b.name,'product name',255);
 const stock=val(b.qty??0,'opening stock',0,1e10);
 if(req.user.role!=='admin'&&(Number(b.cost||0)!==0||stock>0))throw bad(403,'Admin required to set opening cost or stock');
 const out=await transactional(async c=>{
 const r=await c.query(`insert into public.product(sku,barcode,name,other_name,category,brand,unit,pack_name,pack_factor,cost,retail,wholesale,qty,reorder_qty,taxable,details)
 values($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16) returning *`,
 [sku,b.barcode?txt(b.barcode,'barcode',120):null,name,str(b.otherName,255),str(b.category||'General',120),str(b.brand,120),
 str(b.unit||'PCS',40),str(b.packName||'Pack',40),val(b.packFactor??1,'pack factor',1,1e6),
 val(b.cost??0,'cost'),val(b.retail??0,'retail'),val(b.wholesale??0,'wholesale'),
 stock,val(b.reorder??0,'reorder'),!!b.taxable,JSON.stringify(b.details||{})]);
 if(stock>0)await c.query('insert into public.stock_move(product_id,delta,kind,reference,created_by) values($1,$2,$3,$4,$5)',
 [r.rows[0].id,stock,'OPENING','NEW',req.user.id]);
 await audit(c,req.user,'product.create',{id:r.rows[0].id,sku});return r.rows[0];
 });sendJson(res,{product:maskProduct(out,req.user)},201);
}));
app.patch('/api/products/:id',guardWrite,route(async(req,res)=>{
 need(req,'products-edit');checkId(req.params.id);
 const b=req.body||{};
 if('qty'in b)throw bad(400,'Use stock adjustment or GRN to change stock');
 if('cost'in b&&req.user.role!=='admin')throw bad(403,'Admin required to edit cost');
 const out=await transactional(async c=>{
 const q=await c.query('select * from public.product where id=$1 for update',[req.params.id]);
 if(!q.rowCount)throw bad(404,'Product not found');const p=q.rows[0];
 const r=await c.query(`update public.product set name=$1,other_name=$2,category=$3,brand=$4,
 unit=$5,pack_name=$6,pack_factor=$7,cost=$8,retail=$9,wholesale=$10,reorder_qty=$11,
 taxable=$12,active=$13,updated_at=now() where id=$14 returning *`,
 [b.name?txt(b.name,'name'):p.name,b.otherName===undefined?p.other_name:str(b.otherName,255),
 b.category===undefined?p.category:str(b.category,120),b.brand===undefined?p.brand:str(b.brand,120),
 b.unit===undefined?p.unit:str(b.unit,40),b.packName===undefined?p.pack_name:str(b.packName,40),
 b.packFactor===undefined?p.pack_factor:val(b.packFactor,'pack factor',1,1e6),
 b.cost===undefined?p.cost:val(b.cost,'cost'),b.retail===undefined?p.retail:val(b.retail,'retail'),
 b.wholesale===undefined?p.wholesale:val(b.wholesale,'wholesale'),
 b.reorder===undefined?p.reorder_qty:val(b.reorder,'reorder'),
 b.taxable===undefined?p.taxable:!!b.taxable,b.active===undefined?p.active:!!b.active,req.params.id]);
 await audit(c,req.user,'product.update',{id:req.params.id});return r.rows[0];
 });sendJson(res,{product:maskProduct(out,req.user)});
}));

for(const [plural,tbl,right,fields] of [
 ['customers','customer','credit',['name','phone','address','tin','limit','opening','terms']],
 ['suppliers','supplier','grn',['name','phone','address','opening']]
]){
 app.get(`/api/${plural}`,route(async(req,res)=>{
 needAny(req,tbl==='customer'?['billing','credit','reports']:['grn','reports']);
 const r=await pool.query(`select * from public.${tbl} order by name limit 10000`);
 sendJson(res,{[plural]:r.rows});
 }));
 app.post(`/api/${plural}`,guardWrite,route(async(req,res)=>{
 need(req,right);const b=req.body||{};let r;
 if(tbl==='customer')r=await pool.query(`insert into public.customer(name,phone,address,tin,credit_limit,opening,terms)
 values($1,$2,$3,$4,$5,$6,$7) returning *`,[txt(b.name,'customer name',200),str(b.phone,50),str(b.address,500),
 str(b.tin,80),val(b.limit??0,'credit limit'),val(b.opening??0,'opening',-1e9,1e9),val(b.terms??30,'terms',0,365)]);
 else r=await pool.query('insert into public.supplier(name,phone,address,opening) values($1,$2,$3,$4) returning *',
 [txt(b.name,'supplier name',200),str(b.phone,50),str(b.address,500),val(b.opening??0,'opening',-1e9,1e9)]);
 sendJson(res,{[tbl]:r.rows[0]},201);
 }));
}

app.get('/api/sales',route(async(req,res)=>{
 needAny(req,['billing','credit','reports']);
 const r=await pool.query(`select s.*,c.name as customer_name from public.sale s left join public.customer c on c.id=s.customer_id
 where ($1::boolean=false or s.cashier_id=$2)
 order by s.issued_at desc limit 1000`,[req.user.role==='cashier',req.user.id]);sendJson(res,{sales:r.rows});
}));
app.get('/api/sales/:id',route(async(req,res)=>{
 needAny(req,['billing','credit','reports']);
 checkId(req.params.id);const s=await pool.query('select * from public.sale where id=$1',[req.params.id]);
 if(!s.rowCount)throw bad(404,'Invoice not found');
 if(req.user.role==='cashier'&&s.rows[0].cashier_id!==req.user.id)throw bad(403,'Only your own invoices are visible');
 const l=await pool.query('select * from public.sale_line where sale_id=$1',[req.params.id]);
 if(!hasCost(req.user))l.rows.forEach(x=>delete x.cost);
 const p=await pool.query('select * from public.payment where sale_id=$1 order by at',[req.params.id]);
 sendJson(res,{sale:s.rows[0],lines:l.rows,payments:p.rows});
}));
app.post('/api/sales',guardWrite,route(async(req,res)=>{
 need(req,'billing');const b=req.body||{};
 if(!isId(b.idempotencyKey))throw bad(400,'idempotencyKey UUID required');
 if(!Array.isArray(b.items)||b.items.length<1||b.items.length>250)throw bad(400,'1–250 items required');
 const paid=val(b.paid??0,'amount paid');const billDiscount=val(b.discount??0,'bill discount');
 const customerId=b.customerId?checkId(b.customerId):null;
 const invoice=await transactional(async c=>{
 const prior=await c.query('select * from public.sale where idempotency_key=$1',[b.idempotencyKey]);
 if(prior.rowCount)return prior.rows[0];
 const lineItems=[];let subtotal=0,entireCost=0;
 const ids=[...new Set(b.items.map(x=>checkId(x.productId)))].sort();
 const pRows=await c.query('select * from public.product where id=any($1::uuid[]) order by id for update',[ids]);
 const products=new Map(pRows.rows.map(p=>[p.id,p]));
 const required=new Map();
 for(const l of b.items){
  const p=products.get(l.productId);if(!p||!p.active)throw bad(400,'Product unavailable');
  const qty=round3(positive(l.qty,'quantity'));
  if(qty<=0)throw bad(400,'Quantity too small');
  const unitPrice=round2(val(l.price??p.retail,'unit price'));
  const lineDiscount=round2(val(l.discount??0,'line discount'));
  const gross=round2(qty*unitPrice);
  if(lineDiscount>gross)throw bad(400,'Line discount exceeds price');
  const amount=round2(gross-lineDiscount);subtotal=round2(subtotal+amount);entireCost=round2(entireCost+qty*Number(p.cost));
  if(amount+0.005<round2(qty*Number(p.cost))){
   if(req.user.role!=='admin'||!b.belowCostApprovalReason||str(b.belowCostApprovalReason,500).trim().length<5)
    throw bad(403,'Below-cost sales require admin approval and a reason');
  }
  required.set(p.id,round3((required.get(p.id)||0)+qty));
  lineItems.push({p,qty,unitPrice,lineDiscount,amount});
 }
 const total=round2(subtotal-billDiscount);
 if(total<0)throw bad(400,'Bill discount exceeds subtotal');
 if(total+0.005<entireCost&&(req.user.role!=='admin'||!b.belowCostApprovalReason||str(b.belowCostApprovalReason,500).trim().length<5))
  throw bad(403,'Invoice net amount is below total acquisition cost. Admin approval/reason required');
 if(paid>total+0.005)throw bad(400,'Payment exceeds invoice total');
 const balance=round2(total-paid);
 if(balance>0&&!customerId)throw bad(400,'Customer required for credit invoice');
 if(customerId){const cr=await c.query('select * from public.customer where id=$1 for update',[customerId]);
  if(!cr.rowCount)throw bad(404,'Customer not found');
  const customer=cr.rows[0];
  if(balance>0&&Number(customer.credit_limit)>0){
   const outstanding=await c.query('select coalesce(sum(balance),0) as due from public.sale where customer_id=$1',[customerId]);
   if(Number(outstanding.rows[0].due)+balance+Number(customer.opening)>Number(customer.credit_limit)+0.005)
    throw bad(400,'Customer credit limit exceeded');
  }
 }
 for(const [id,q]of required){if(Number(products.get(id).qty)+1e-8<q)throw bad(409,`Insufficient stock: ${products.get(id).name}`)}
 const no=await number(c,'sale','HW');
 const sr=await c.query(`insert into public.sale(no,customer_id,cashier_id,kind,subtotal,total,discount,tax,paid,balance,status,payment_method,notes,idempotency_key)
 values($1,$2,$3,$4,$5,$6,$7,0,$8,$9,$10,$11,$12,$13) returning *`,
 [no,customerId,req.user.id,b.kind==='wholesale'?'wholesale':'retail',subtotal,total,billDiscount,paid,balance,
 balance===0?'paid':paid===0?'unpaid':'partial',str(b.method||'cash',40),str(b.notes,2000),b.idempotencyKey]);
 const sale=sr.rows[0];
 for(const item of lineItems){
  const {p,qty,unitPrice,lineDiscount,amount}=item;
  await c.query(`insert into public.sale_line(sale_id,product_id,name,sku,qty,price,discount,amount,cost)
   values($1,$2,$3,$4,$5,$6,$7,$8,$9)`,[sale.id,p.id,p.name,p.sku,qty,unitPrice,lineDiscount,amount,p.cost]);
 }
 for(const [id,q] of required){
  await c.query('update public.product set qty=qty-$1,updated_at=now() where id=$2',[q,id]);
  await c.query(`insert into public.stock_move(product_id,delta,kind,reference,created_by)
  values($1,$2,'SALE',$3,$4)`,[id,-q,no,req.user.id]);
 }
 if(paid>0)await c.query('insert into public.payment(sale_id,amount,method,created_by) values($1,$2,$3,$4)',
 [sale.id,paid,str(b.method||'cash',40),req.user.id]);
 await audit(c,req.user,'sale.create',{id:sale.id,no,total,belowCostApprovalReason:b.belowCostApprovalReason||null});
 return sale;
 });sendJson(res,{sale:invoice},201);
}));
app.post('/api/sales/:id/payments',guardWrite,route(async(req,res)=>{
 need(req,'credit');checkId(req.params.id);const amount=round2(positive(req.body?.amount,'payment'));
 const s=await transactional(async c=>{
  const r=await c.query('select * from public.sale where id=$1 for update',[req.params.id]);
  if(!r.rowCount)throw bad(404,'Invoice missing');const row=r.rows[0];
  if(amount>Number(row.balance)+0.005)throw bad(400,'Payment exceeds balance');
  await c.query('insert into public.payment(sale_id,amount,method,created_by,note) values($1,$2,$3,$4,$5)',
  [row.id,amount,str(req.body.method||'cash',40),req.user.id,str(req.body.note,2000)]);
  const p=await c.query(`update public.sale set paid=round(paid+$1,2),balance=round(balance-$1,2),
  status=case when round(balance-$1,2)=0 then 'paid' else 'partial' end where id=$2 returning *`,[amount,row.id]);
  await audit(c,req.user,'payment.create',{saleId:row.id,amount});return p.rows[0];
 });sendJson(res,{sale:s});
}));
app.post('/api/purchases',guardWrite,route(async(req,res)=>{
 need(req,'grn');const b=req.body||{};
 if(!isId(b.idempotencyKey))throw bad(400,'idempotencyKey UUID required');
 const supplierId=checkId(b.supplierId);
 if(!Array.isArray(b.items)||!b.items.length||b.items.length>250)throw bad(400,'Invalid GRN lines');
 const out=await transactional(async c=>{
  const prior=await c.query('select * from public.purchase where idempotency_key=$1',[b.idempotencyKey]);if(prior.rowCount)return prior.rows[0];
  const sup=await c.query('select id from public.supplier where id=$1',[supplierId]);if(!sup.rowCount)throw bad(404,'Supplier missing');
  const ids=[...new Set(b.items.map(x=>checkId(x.productId)))].sort();
  const pr=await c.query('select * from public.product where id=any($1::uuid[]) order by id for update',[ids]);
  const map=new Map(pr.rows.map(x=>[x.id,x]));
  const lines=[];let total=0;const grnIds=new Set();
  for(const l of b.items){const p=map.get(l.productId);if(!p)throw bad(404,'Product missing');
   if(grnIds.has(p.id))throw bad(400,'Duplicate GRN product. Combine quantities into one line.');grnIds.add(p.id);
   const qty=round3(positive(l.qty,'GRN quantity')),free=round3(val(l.freeQty??0,'free quantity')),
    cost=val(l.cost,'GRN cost'),discount=round2(val(l.discount??0,'line discount'));
   const gross=round2(qty*cost);if(discount>gross)throw bad(400,'GRN discount exceeds gross');
   const amount=round2(gross-discount);total=round2(total+amount);
   lines.push({p,qty,free,cost,amount});}
  const billDiscount=round2(val(b.billDiscount??0,'GRN discount'));
  total=round2(total-billDiscount);if(total<0)throw bad(400,'Invalid total GRN discount');
  const paid=round2(val(b.paid??0,'amount paid'));if(paid>total)throw bad(400,'Payment exceeds GRN total');
  const no=await number(c,'grn','GRN');
  const pur=(await c.query(`insert into public.purchase(no,supplier_id,supplier_invoice,total,paid,balance,notes,created_by,idempotency_key)
   values($1,$2,$3,$4,$5,$6,$7,$8,$9) returning *`,[no,supplierId,str(b.supplierInvoice,150),total,paid,
   round2(total-paid),str(b.notes,2000),req.user.id,b.idempotencyKey])).rows[0];
  const beforeDiscount=round2(total+billDiscount);let allocated=0;
  for(const [ix,l] of lines.entries()){const received=round3(l.qty+l.free),oldQty=Number(l.p.qty);
    const newQty=round3(oldQty+received);
    const netLine=ix===lines.length-1?round2(total-allocated):round2(l.amount-(beforeDiscount>0?billDiscount*l.amount/beforeDiscount:0));
    allocated=round2(allocated+netLine);
    const effectiveCost=received>0?netLine/received:0;
    const weightedCost=newQty>0?(oldQty*Number(l.p.cost)+netLine)/newQty:0;
    await c.query('insert into public.purchase_line(purchase_id,product_id,qty,free_qty,cost,total) values($1,$2,$3,$4,$5,$6)',
     [pur.id,l.p.id,l.qty,l.free,Math.round(effectiveCost*10000)/10000,netLine]);
    await c.query('update public.product set qty=$1,cost=$2,updated_at=now() where id=$3',
     [newQty,Math.round(weightedCost*10000)/10000,l.p.id]);
    await c.query(`insert into public.stock_move(product_id,delta,kind,reference,created_by) values($1,$2,'GRN',$3,$4)`,
     [l.p.id,received,no,req.user.id]);
  }
  if(paid>0)await c.query('insert into public.supplier_payment(purchase_id,amount,method) values($1,$2,$3)',
  [pur.id,paid,str(b.method||'cash',40)]);
  await audit(c,req.user,'purchase.create',{id:pur.id,no,total});return pur;
 });sendJson(res,{purchase:out},201);
}));
app.get('/api/purchases',route(async(req,res)=>{
 needAny(req,['grn','reports']);
 const r=await pool.query('select * from public.purchase order by issued_at desc limit 1000');sendJson(res,{purchases:r.rows});
}));
app.post('/api/stock/adjust',guardWrite,route(async(req,res)=>{
 need(req,'stock-adjust');const id=checkId(req.body?.productId),delta=round3(val(req.body?.delta,'delta',-1e10,1e10)),
 reason=txt(req.body?.reason,'stock adjustment reason',500);
 if(delta===0)throw bad(400,'Nonzero delta required');
 const out=await transactional(async c=>{
  const p=await c.query('select * from public.product where id=$1 for update',[id]);if(!p.rowCount)throw bad(404,'Product missing');
  if(Number(p.rows[0].qty)+delta<0)throw bad(409,'Stock cannot go negative');
  const r=await c.query('update public.product set qty=qty+$1,updated_at=now() where id=$2 returning *',[delta,id]);
  await c.query('insert into public.stock_move(product_id,delta,kind,notes,created_by) values($1,$2,$3,$4,$5)',
  [id,delta,'ADJUST',reason,req.user.id]);
  await audit(c,req.user,'stock.adjust',{productId:id,delta,reason});return r.rows[0];
 });sendJson(res,{product:maskProduct(out,req.user)});
}));
app.get('/api/stock/movements',route(async(req,res)=>{
 needAny(req,['stock-adjust','grn','reports']);
 const r=await pool.query('select * from public.stock_move order by at desc limit 1000');sendJson(res,{movements:r.rows});
}));
app.post('/api/returns',guardWrite,route(async(req,res)=>{
 need(req,'credit');const b=req.body||{};
 if(!isId(b.idempotencyKey))throw bad(400,'idempotencyKey UUID required');
 const saleLineId=checkId(b.saleLineId),qty=round3(positive(b.qty,'return quantity'));
 const result=await transactional(async c=>{
 const prior=await c.query('select * from public.sales_return where idempotency_key=$1',[b.idempotencyKey]);if(prior.rowCount)return prior.rows[0];
 const row=await c.query('select l.*,s.id as original_sale_id from public.sale_line l join public.sale s on s.id=l.sale_id where l.id=$1 for update of l',[saleLineId]);
 if(!row.rowCount)throw bad(404,'Sale line missing');const l=row.rows[0];
 const returned=await c.query('select coalesce(sum(qty),0) as qty from public.sales_return where sale_line_id=$1',[saleLineId]);
 if(Number(returned.rows[0].qty)+qty>Number(l.qty)+1e-9)throw bad(409,'Return exceeds sold quantity');
 const refund=round2(qty*Number(l.amount)/Number(l.qty));
 const inserted=(await c.query(`insert into public.sales_return(sale_id,sale_line_id,qty,refund,created_by,idempotency_key)
 values($1,$2,$3,$4,$5,$6) returning *`,[l.original_sale_id,l.id,qty,refund,req.user.id,b.idempotencyKey])).rows[0];
 await c.query('update public.product set qty=qty+$1,updated_at=now() where id=$2',[qty,l.product_id]);
 await c.query(`insert into public.stock_move(product_id,delta,kind,reference,created_by)
 values($1,$2,'RETURN',$3,$4)`,[l.product_id,qty,l.original_sale_id,req.user.id]);
 await audit(c,req.user,'return.create',{saleLineId,qty,refund});return inserted;
 });sendJson(res,{return:result},201);
}));
app.get('/api/expenses',route(async(req,res)=>{
 needAny(req,['credit','reports']);
 const r=await pool.query('select * from public.expense order by at desc limit 1000');sendJson(res,{expenses:r.rows});
}));
app.post('/api/expenses',guardWrite,route(async(req,res)=>{
 need(req,'credit');const b=req.body||{};
 const r=await pool.query(`insert into public.expense(category,amount,method,note,created_by)
 values($1,$2,$3,$4,$5) returning *`,[txt(b.category,'category',150),val(b.amount,'amount'),str(b.method||'cash',40),str(b.note,2000),req.user.id]);
 sendJson(res,{expense:r.rows[0]},201);
}));
app.get('/api/documents',route(async(req,res)=>{
 needAny(req,['billing','reports']);
 const r=await pool.query('select * from public.document order by issued_at desc limit 1000');sendJson(res,{documents:r.rows});
}));
app.post('/api/documents',guardWrite,route(async(req,res)=>{
 need(req,'billing');const b=req.body||{};
 if(!['quotation','proforma','custom'].includes(b.kind))throw bad(400,'Invalid document kind');
 if(!Array.isArray(b.items)||b.items.length>200)throw bad(400,'Invalid document lines');
 const r=await transactional(async c=>{
 const no=await number(c,'document',b.kind==='quotation'?'QT':b.kind==='proforma'?'PI':'CI');
 const out=await c.query(`insert into public.document(no,kind,title,customer_id,items,total,notes,created_by)
 values($1,$2,$3,$4,$5,$6,$7,$8) returning *`,[no,b.kind,txt(b.title||b.kind,'title',120),b.customerId?checkId(b.customerId):null,
 JSON.stringify(b.items),val(b.total,'total'),str(b.notes,2000),req.user.id]);
 await audit(c,req.user,'document.create',{no});return out.rows[0];});sendJson(res,{document:r},201);
}));
app.get('/api/draft',route(async(req,res)=>{
 const r=await pool.query('select draft,updated_at from public.account_draft where account_id=$1',[req.user.id]);
 sendJson(res,{draft:r.rows[0]?.draft??{},updatedAt:r.rows[0]?.updated_at??null});
}));
app.put('/api/draft',guardWrite,route(async(req,res)=>{
 const draft=req.body?.draft;if(!draft||typeof draft!=='object'||Array.isArray(draft))throw bad(400,'Invalid draft');
 await pool.query(`insert into public.account_draft(account_id,draft) values($1,$2)
 on conflict(account_id) do update set draft=$2,updated_at=now()`,[req.user.id,JSON.stringify(draft)]);
 sendJson(res,{ok:true});
}));
app.get('/api/settings',route(async(req,res)=>{
 const r=await pool.query('select data from public.app_settings where id=1');sendJson(res,{settings:r.rows[0].data});
}));
app.put('/api/settings',guardWrite,route(async(req,res)=>{
 if(req.user.role!=='admin')throw bad(403,'Admin only');
 const data=req.body?.settings;
 if(!data||typeof data!=='object'||Array.isArray(data))throw bad(400,'Invalid settings');
 await pool.query('update public.app_settings set data=$1,updated_at=now() where id=1',[JSON.stringify(data)]);
 sendJson(res,{ok:true});
}));
app.get('/api/dashboard',route(async(req,res)=>{
 needAny(req,['reports']);
 const [a,b,c,d]=await Promise.all([
  pool.query(`select coalesce(sum(total),0) as revenue,count(*) as invoices from public.sale where (issued_at at time zone 'Asia/Colombo')::date=(now() at time zone 'Asia/Colombo')::date`),
  pool.query('select coalesce(sum(balance),0) as due from public.sale'),
  pool.query('select count(*) as low_stock from public.product where active and qty<=reorder_qty'),
  hasCost(req.user)?pool.query('select coalesce(sum(cost*qty),0) as valuation from public.product'):
    Promise.resolve({rows:[{valuation:null}]})]);
 sendJson(res,{revenue:a.rows[0].revenue,invoices:a.rows[0].invoices,outstanding:b.rows[0].due,
 lowStock:c.rows[0].low_stock,stockValuation:d.rows[0].valuation});
}));
app.get('/api/changes',route(async(req,res)=>{
 // Polling endpoint for low-cost cross-device change detection.
 const r=await pool.query(`select greatest(
 coalesce((select max(issued_at) from public.sale),'epoch'::timestamptz),
 coalesce((select max(updated_at) from public.product),'epoch'::timestamptz),
 coalesce((select max(issued_at) from public.purchase),'epoch'::timestamptz),
 coalesce((select max(at) from public.payment),'epoch'::timestamptz),
 coalesce((select max(at) from public.stock_move),'epoch'::timestamptz)) as changed_at`);
 sendJson(res,{changedAt:r.rows[0].changed_at});
}));
app.use('/api',(req,res)=>res.status(404).json({error:'API route not found'}));
const folder=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../public');
app.use(express.static(folder,{setHeaders:r=>r.setHeader('Cache-Control','no-store')}));
app.get('*',(req,res)=>res.sendFile(path.join(folder,'index.html')));
app.use((error,req,res,next)=>{
 console.error('Request failed',error.code||'',error.message);
 if(res.headersSent)return next(error);
 const status=error.status||(['23505','23503','23514','22P02'].includes(error.code)?409:500);
 const message=status===500?'Server error. Check server logs.':
  error.code==='23505'?'A record with this value already exists':error.message;
 res.status(status).json({error:message});
});
const port=Number(process.env.PORT)||3000;
app.listen(port,'0.0.0.0',()=>console.log(`Nexa API listening on ${port}`));
