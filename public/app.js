'use strict';
// Cloud foundation UI. All business records come from the server; no localStorage,
// sessionStorage, IndexedDB, service worker or offline business cache is used.
const root=document.querySelector('#root');
const data={user:null,page:'dashboard',products:[],customers:[],suppliers:[],sales:[],purchases:[],expenses:[],accounts:[],
 items:[],grnItems:[],saleSubmissionKey:null,grnSubmissionKey:null,ready:false,working:false,modal:null};
const esc=s=>String(s??'').replace(/[&<>"']/g,ch=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]));
const money=n=>'Rs. '+Number(n||0).toLocaleString('en-LK',{minimumFractionDigits:2,maximumFractionDigits:2});
const n=x=>Number(x||0);const round=x=>Math.round((x+Number.EPSILON)*100)/100;
const fields=f=>Object.fromEntries(new FormData(f));
let toastTimer=null;
function toast(text,error=false){document.querySelector('#toast')?.remove();let x=document.createElement('div');x.id='toast';x.className='toast';x.textContent=(error?'Error: ':'')+text;document.body.append(x);clearTimeout(toastTimer);toastTimer=setTimeout(()=>x.remove(),6000)}
async function api(path,options={}){
 const r=await fetch('/api'+path,{credentials:'same-origin',cache:'no-store',...options,headers:{'Content-Type':'application/json','X-Nexa-Request':'1',...(options.headers||{})}});
 let payload={};try{payload=await r.json()}catch{}if(!r.ok)throw Error(payload.error||`HTTP ${r.status}`);return payload;
}
function can(permission){return data.user?.role==='admin'||data.user?.permissions?.includes('all')||data.user?.permissions?.includes(permission)}
function layout(page){
 const allNav=[['dashboard','◈ Overview'],['billing','▣ New Invoice'],['sales','▤ Sales & Invoices'],['products','◫ Products & Stock'],
 ['purchases','⇣ Goods Received'],['customers','♙ Customers'],['suppliers','▥ Suppliers'],['expenses','◉ Expenses'],['accounts','♧ Accounts']];
 const rights={dashboard:'reports',billing:'billing',sales:'billing',products:'billing',purchases:'grn',customers:'billing',suppliers:'grn',expenses:'credit',accounts:'all'};
 const nav=allNav.filter(([key])=>key==='accounts'?data.user.role==='admin':
   key==='products'?['billing','products-edit','grn','stock-adjust','reports'].some(can):
   key==='sales'||key==='customers'?['billing','credit','reports'].some(can):
   key==='expenses'?['credit','reports'].some(can):
   key==='dashboard'?can('reports'):
   can(rights[key]));
 return `<div class="shell"><aside class="sidebar"><div class="logo"><div class="logo-mark">N</div><div><strong>nexa billsuite</strong><small>CLOUD FOUNDATION</small></div></div>
 <div class="nav-caption">WORKSPACE</div>${nav.map(([key,text])=>`<button class="nav ${data.page===key?'active':''}" data-page="${key}">${text}</button>`).join('')}
 <div class="foot"><b>● Live PostgreSQL</b><div>Data is stored in Supabase, not browser storage. Other devices can refresh these records.</div></div></aside>
 <div class="main"><header class="top"><div><b>${esc(data.user.name)}</b><small>${esc(data.user.username)} · ${esc(data.user.role)}</small></div>
 <div class="row"><span class="pill">Cloud connected</span><button class="btn outline small" data-action="refresh">Refresh</button><button class="btn outline small" data-action="logout">Logout</button></div></header>
 <div class="work" id="workspace">${page}</div></div></div>`;
}
function loginPage(error=''){
 root.innerHTML=`<div class="login"><div class="intro"><div class="eyebrow">Retail intelligence · Secure cloud</div><h1>nexa <span>bill</span>suite.</h1><p>Billing, inventory, accounts and payments — managed by PostgreSQL in Supabase.</p></div>
 <form id="login" class="login-card"><div class="eyebrow">WELCOME BACK</div><h2>Sign in</h2><p>Access your connected workspace.</p>${error?`<div class="alert">${esc(error)}</div>`:''}
 <label>Username</label><input name="username" required autocomplete="username" placeholder="Username" />
 <label>Password</label><input name="password" type="password" required autocomplete="current-password" placeholder="Password" />
 <div class="actions"><button class="btn" type="submit">Sign in securely</button></div><div class="notice mini">Passwords are verified on the server. No credentials are embedded in this page.</div></form></div>`;
}
function passwordPage(error=''){
 root.innerHTML=`<div class="login"><div class="intro"><h1>Secure your <span>account.</span></h1><p>Change the initial password before accessing business data.</p></div>
 <form class="login-card" id="password"><h2>Change password</h2><p>At least 12 characters. Use a unique password.</p>${error?`<div class="alert">${esc(error)}</div>`:''}
 <label>Current password</label><input type="password" name="oldPassword" required autocomplete="current-password"/>
 <label>New password</label><input type="password" name="newPassword" required minlength="12" autocomplete="new-password"/>
 <div class="actions"><button class="btn" type="submit">Change password</button></div></form></div>`;
}
function grid(rows,headings){return `<div class="tablewrap"><table class="tbl"><thead><tr>${headings.map(h=>`<th>${esc(h)}</th>`).join('')}</tr></thead><tbody>${rows||`<tr><td colspan="${headings.length}" class="empty">No records yet</td></tr>`}</tbody></table></div>`}
function dashboard(){return `<div class="hero"><h2>Welcome to Nexa Cloud</h2><p>Online database foundation — every saved record is confirmed by the backend before success is displayed.</p></div>
 <div id="metrics" class="cards"><div class="card">Loading current figures…</div></div><div class="card"><h3>Cloud foundation status</h3>
 <div class="notice">The original 400 KB HTML is retained separately as a reference. This is a secure cloud starter UI, not yet a complete conversion of its barcode studio, advanced reports, costing lots and printing layouts.</div>
 <div class="row"><button data-page="billing" class="btn">New invoice</button><button class="btn outline" data-page="products">Manage products</button></div></div>`}
function products(){return `<h1>Products & Stock</h1><div class="card"><div class="row between"><h2>Product catalogue</h2><button class="btn" data-action="new-product">＋ Add product</button></div>
 <input class="filter" id="product-search" placeholder="Search SKU, barcode or name" />
 <div id="product-table">${productTable()}</div></div>`}
function productTable(filter=''){const rows=data.products.filter(x=>(x.name+' '+x.sku+' '+(x.barcode||'')).toLowerCase().includes(filter.toLowerCase()));
 return grid(rows.map(p=>`<tr><td><b>${esc(p.name)}</b><div class="dim mini">${esc(p.sku)}</div></td><td>${esc(p.barcode)}</td><td>${esc(p.category)}</td>
 <td class="numeric">${Number(p.qty).toLocaleString()}</td><td class="numeric">${money(p.retail)}</td><td class="numeric">${p.cost!==undefined?money(p.cost):'Restricted'}</td>
 <td>${can('stock-adjust')?`<button class="btn small outline" data-adjust="${p.id}">Adjust</button>`:''}</td></tr>`).join(''),['Product','Barcode','Category','Stock','Retail','Cost','']);}
function customers(){return `<h1>Customers & Credit</h1><div class="card"><div class="row between"><h2>Customers</h2>${can('credit')?'<button data-action="new-customer" class="btn">＋ Add customer</button>':''}</div>
 ${grid(data.customers.map(c=>`<tr><td><b>${esc(c.name)}</b></td><td>${esc(c.phone)}</td><td>${esc(c.address)}</td><td>${money(c.credit_limit)}</td></tr>`).join(''),['Customer','Phone','Address','Credit limit'])}</div>`}
function suppliers(){return `<h1>Suppliers</h1><div class="card"><div class="row between"><h2>Supplier list</h2>${can('grn')?'<button class="btn" data-action="new-supplier">＋ Add supplier</button>':''}</div>
 ${grid(data.suppliers.map(s=>`<tr><td><b>${esc(s.name)}</b></td><td>${esc(s.phone)}</td><td>${esc(s.address)}</td></tr>`).join(''),['Supplier','Phone','Address'])}</div>`}
function sales(){return `<h1>Sales & Invoices</h1><div class="card"><div class="row between"><h2>Invoice register</h2><button class="btn" data-page="billing">＋ New invoice</button></div>
 ${grid(data.sales.map(s=>`<tr><td><button class="btn outline small" data-invoice="${s.id}">${esc(s.no)}</button></td><td>${esc(s.customer_name||'Walk-in')}</td>
 <td>${new Date(s.issued_at).toLocaleString('en-LK')}</td><td class="numeric">${money(s.total)}</td><td class="numeric">${money(s.balance)}</td><td><span class="pill ${esc(s.status)}">${esc(s.status)}</span></td></tr>`).join(''),['Invoice','Customer','Date','Total','Balance','Status'])}</div>`}
function billing(){const gross=round(data.items.reduce((a,l)=>a+l.qty*l.price-l.discount,0));return `<h1>New Invoice</h1><div class="notice">Backend validates stock, price rules, payments and invoice numbering inside a PostgreSQL transaction. Save requires server confirmation.</div>
 <div class="split"><div><div class="card"><h2>Add items</h2><div class="inline-form"><div><label>Search product</label><select id="sale-product">${data.products.filter(p=>p.active!==false).map(p=>`<option value="${p.id}">${esc(p.sku)} · ${esc(p.name)} (${p.qty} in stock)</option>`).join('')}</select></div>
 <div><label>Qty</label><input id="sale-qty" type="number" min="0.001" step="0.001" value="1"></div><button data-action="add-item" class="btn">Add</button></div></div>
 <div class="card"><h2>Invoice items</h2>${grid(data.items.map((l,i)=>`<tr><td>${esc(l.name)}</td><td>${l.qty}</td><td class="numeric">${money(l.price)}</td><td class="numeric">${money(l.discount)}</td><td class="numeric">${money(l.qty*l.price-l.discount)}</td><td><button class="btn outline small" data-remove-item="${i}">Remove</button></td></tr>`).join(''),['Product','Qty','Price','Discount','Total',''])}</div></div>
 <div class="card"><h2>Checkout</h2><form id="save-sale"><label>Customer</label><select name="customerId"><option value="">Walk-in / cash sale</option>${data.customers.map(c=>`<option value="${c.id}">${esc(c.name)}</option>`).join('')}</select>
 <label>Bill discount</label><input type="number" min="0" step="0.01" name="discount" value="0"/>
 <label>Amount paid</label><input type="number" min="0" step="0.01" name="paid" value="${gross}"/>
 <label>Method</label><select name="method"><option value="cash">Cash</option><option value="card">Card</option><option value="bank">Bank</option><option value="credit">Credit</option></select>
 <label>Notes</label><input name="notes" placeholder="Optional notes"/><div class="row between" style="margin-top:19px"><b>Gross amount</b><span class="total">${money(gross)}</span></div>
 <div class="actions"><button class="btn" type="submit" ${!data.items.length?'disabled':''}>Save invoice</button></div></form></div></div>`;}
function purchases(){return `<h1>Goods Received Note</h1><div class="split"><div><div class="card"><h2>Add received goods</h2><div class="inline-form"><div><label>Product</label><select id="grn-product">${data.products.map(p=>`<option value="${p.id}">${esc(p.sku)} · ${esc(p.name)}</option>`).join('')}</select></div>
 <div><label>Paid qty</label><input type="number" id="grn-qty" value="1" min=".001" step=".001"/></div><div><label>Unit cost</label><input type="number" id="grn-cost" value="0" min="0" step=".01" /></div>
 <button class="btn" data-action="add-grn">Add</button></div></div><div class="card"><h2>GRN items</h2>${grid(data.grnItems.map((l,i)=>`<tr><td>${esc(l.name)}</td><td>${l.qty}</td><td>${money(l.cost)}</td><td>${money(l.qty*l.cost)}</td><td><button class="btn outline small" data-remove-grn="${i}">Remove</button></td></tr>`).join(''),['Product','Qty','Cost','Total',''])}</div></div>
 <div class="card"><h2>GRN details</h2><form id="save-purchase"><label>Supplier</label><select name="supplierId" required><option value="">Choose supplier</option>${data.suppliers.map(s=>`<option value="${s.id}">${esc(s.name)}</option>`).join('')}</select>
 <label>Supplier invoice</label><input name="supplierInvoice"/><label>Paid amount</label><input type="number" step=".01" min="0" name="paid" value="0" />
 <label>Notes</label><input name="notes"/><p class="total">${money(data.grnItems.reduce((a,l)=>a+l.qty*l.cost,0))}</p>
 <div class="actions"><button class="btn" type="submit" ${!data.grnItems.length?'disabled':''}>Post GRN</button></div></form></div></div><div class="card"><h2>Recent GRNs</h2>
 ${grid(data.purchases.map(x=>`<tr><td>${esc(x.no)}</td><td>${new Date(x.issued_at).toLocaleString('en-LK')}</td><td>${money(x.total)}</td><td>${money(x.balance)}</td></tr>`).join(''),['GRN','Date','Total','Balance'])}</div>`;}
function expenses(){return `<h1>Expenses</h1><div class="card"><div class="row between"><h2>Expenses</h2>${can('credit')?'<button data-action="new-expense" class="btn">＋ Add expense</button>':''}</div>
 ${grid(data.expenses.map(x=>`<tr><td>${esc(x.category)}</td><td>${new Date(x.at).toLocaleString('en-LK')}</td><td>${esc(x.method)}</td><td>${money(x.amount)}</td></tr>`).join(''),['Category','Date','Method','Amount'])}</div>`}
function accounts(){return `<h1>Staff Accounts</h1>${data.user.role==='admin'?`<div class="card"><div class="row between"><h2>Access control</h2><button data-action="new-account" class="btn">＋ New account</button></div>
 ${grid(data.accounts.map(x=>`<tr><td>${esc(x.username)}</td><td>${esc(x.name)}</td><td>${esc(x.role)}</td><td>${x.active?'Enabled':'Disabled'}</td><td>${x.mustChangePassword?'Required':'No'}</td></tr>`).join(''),['Username','Name','Role','Status','Change password'])}</div>`:
 '<div class="notice">Only administrators can manage accounts.</div>'}`}
function render(){if(!data.user)return loginPage();if(data.user.mustChangePassword)return passwordPage();
 const pages={dashboard,billing,sales,products,purchases,customers,suppliers,expenses,accounts};root.innerHTML=layout((pages[data.page]||dashboard)());}
async function reload(){if(!data.user||data.user.mustChangePassword)return;
 const calls=[['products','/products',['billing','products-edit','grn','stock-adjust','barcode','reports']],
 ['customers','/customers',['billing','credit','reports']],['suppliers','/suppliers',['grn','reports']],
 ['sales','/sales',['billing','credit','reports']],['purchases','/purchases',['grn','reports']],
 ['expenses','/expenses',['credit','reports']]].filter(([,path,rights])=>rights.some(can));
 await Promise.all(calls.map(async([key,path])=>{const x=await api(path);data[key]=x[key]||[]}));
 if(data.user.role==='admin'){const a=await api('/accounts');data.accounts=a.accounts||[]}
 if(!can('reports')&&data.page==='dashboard')data.page=can('billing')?'billing':can('grn')?'purchases':'products';
 render();if(data.page==='dashboard')await metrics();}
async function metrics(){const m=await api('/dashboard');const target=document.querySelector('#metrics');if(!target)return;
 target.innerHTML=[['Today’s revenue',money(m.revenue)],['Invoices today',m.invoices],['Customer outstanding',money(m.outstanding)],['Low stock alerts',m.lowStock]].map(([label,num])=>`<div class="card metric"><small>${esc(label)}</small><strong>${esc(num)}</strong></div>`).join('');}
async function boot(){try{const r=await api('/me');data.user=r.user;if(data.user.mustChangePassword)return render();await reload()}catch(e){data.user=null;loginPage()}}
function overlay(title,form,submitText='Save'){data.modal=title;document.body.insertAdjacentHTML('beforeend',`<div class="modal-back" id="overlay"><div class="modal"><div class="row between"><h2>${esc(title)}</h2><button class="btn outline small" type="button" data-action="close-modal">✕</button></div>
 <form id="modal-form">${form}<div class="actions"><button class="btn outline" type="button" data-action="close-modal">Cancel</button><button class="btn" type="submit">${esc(submitText)}</button></div></form></div></div>`)}
const label=(text,name,type='text',attributes='')=>`<label>${esc(text)}</label><input name="${name}" type="${type}" ${attributes}>`;
function openAction(action){
 if(action==='new-product')overlay('Create product',`${label('SKU *','sku','text','required maxlength="80"')}${label('Barcode','barcode')}${label('Product name *','name','text','required')}
 <div class="grid"> <div>${label('Category','category','text','value="General"')}</div><div>${label('Unit','unit','text','value="PCS"')}</div>
 <div>${label('Cost','cost','number','min="0" step=".01" value="0"')}</div><div>${label('Retail price','retail','number','min="0" step=".01" value="0"')}</div>
 <div>${label('Wholesale price','wholesale','number','min="0" step=".01" value="0"')}</div><div>${label('Opening stock','qty','number','min="0" step=".001" value="0"')}</div></div>`);
 else if(action==='new-customer')overlay('New customer',`${label('Customer name *','name','text','required')}${label('Phone','phone')}${label('Address','address')}${label('Credit limit','limit','number','value="0" min="0"')}`);
 else if(action==='new-supplier')overlay('New supplier',`${label('Supplier name *','name','text','required')}${label('Phone','phone')}${label('Address','address')}`);
 else if(action==='new-expense')overlay('New expense',`${label('Category *','category','text','required')}${label('Amount *','amount','number','min="0" step=".01" required')}${label('Notes','note')}`);
 else if(action==='new-account')overlay('Create staff account',`${label('Username *','username','text','required')}${label('Display name *','name','text','required')}${label('Initial password (12+ chars) *','password','password','required minlength="12"')}
 <label>Role</label><select name="role"><option value="cashier">Cashier</option><option value="staff">Staff</option><option value="admin">Administrator</option></select>
 <label>Permission preset</label><select name="preset"><option value="cashier">Billing + Print</option><option value="store">Stock + GRN</option><option value="manager">All business operations</option></select>`);
}
async function saveModal(f){let x=fields(f),endpoint,body=x;if(data.modal==='Create product'){endpoint='/products';}
 else if(data.modal==='New customer'){endpoint='/customers';}
 else if(data.modal==='New supplier'){endpoint='/suppliers';}
 else if(data.modal==='New expense'){endpoint='/expenses';}
 else if(data.modal==='Create staff account'){
 endpoint='/accounts';const preset=x.preset;
 body={...x,permissions:preset==='cashier'?['billing','print']:preset==='store'?['grn','stock-adjust','products-edit']:['billing','print','grn','stock-adjust','products-edit','credit','reports','bulk','barcode'],
 screens:preset==='cashier'?['pos','sales']:preset==='store'?['dashboard','products','purchases']:['dashboard','pos','sales','products','purchases','customers','suppliers','expenses','reports']};
 }
 else if(data.modal==='Adjust stock'){
 endpoint='/stock/adjust';body={productId:data.adjustProduct,delta:Number(x.delta),reason:x.reason};}
 else if(data.modal==='Payment'){
 endpoint=`/sales/${data.paymentSale}/payments`;body={amount:Number(x.amount),method:x.method};}
 else throw Error('Unknown operation');
 await api(endpoint,{method:'POST',body:JSON.stringify(body)});document.querySelector('#overlay')?.remove();data.modal=null;
 toast('Saved successfully to Supabase');await reload();}
async function showInvoice(id){const d=await api('/sales/'+id);data.paymentSale=id;const sale=d.sale;
 let content=`<div><b>${esc(sale.no)}</b> · ${money(sale.total)} · Outstanding ${money(sale.balance)}</div>
 ${grid(d.lines.map(l=>`<tr><td>${esc(l.name)}</td><td>${l.qty}</td><td>${money(l.price)}</td><td>${money(l.amount)}</td></tr>`).join(''),['Item','Qty','Unit','Amount'])}`;
 if(n(sale.balance)>0&&can('credit')){overlay('Payment',content+`${label('Payment amount','amount','number',`value="${sale.balance}" min="0.01" max="${sale.balance}" step="0.01"`)}
 <label>Method</label><select name="method"><option value="cash">Cash</option><option value="card">Card</option><option value="bank">Bank</option></select>`,'Record payment');}
 else{document.body.insertAdjacentHTML('beforeend',`<div id="overlay" class="modal-back"><div class="modal"><div class="row between"><h2>Invoice</h2><button class="btn outline" data-action="close-modal">Close</button></div>${content}</div></div>`)}
}
document.addEventListener('click',async ev=>{
 const target=ev.target.closest('button,[data-page]');if(!target||data.working)return;
 try{const page=target.dataset.page,action=target.dataset.action;if(page){data.page=page;render();if(page==='dashboard')await metrics();return}
 if(action==='logout'){data.working=true;try{await api('/logout',{method:'POST'});data.user=null;data.items=[];data.grnItems=[];loginPage()}finally{data.working=false}return}
 if(action==='refresh'){await reload();toast('Refreshed from Supabase');return}
 if(action==='close-modal'){document.querySelector('#overlay')?.remove();data.modal=null;return}
 if(['new-product','new-customer','new-supplier','new-expense','new-account'].includes(action)){openAction(action);return}
 if(action==='add-item'){let id=document.querySelector('#sale-product')?.value,p=data.products.find(x=>x.id===id);
 let qty=n(document.querySelector('#sale-qty')?.value);if(!p||qty<=0)throw Error('Select an item and valid quantity');
 data.saleSubmissionKey=null;data.items.push({productId:id,name:p.name,qty,price:n(p.retail),discount:0});render();return}
 if(action==='add-grn'){let id=document.querySelector('#grn-product')?.value,p=data.products.find(x=>x.id===id),
 qty=n(document.querySelector('#grn-qty')?.value),cost=n(document.querySelector('#grn-cost')?.value);
 if(!p||qty<=0||cost<0)throw Error('Invalid GRN line');data.grnSubmissionKey=null;data.grnItems.push({productId:id,name:p.name,qty,cost});render();return}
 if(target.dataset.removeItem!==undefined){data.items.splice(Number(target.dataset.removeItem),1);data.saleSubmissionKey=null;render();return}
 if(target.dataset.removeGrn!==undefined){data.grnItems.splice(Number(target.dataset.removeGrn),1);data.grnSubmissionKey=null;render();return}
 if(target.dataset.invoice){await showInvoice(target.dataset.invoice);return}
 if(target.dataset.adjust){data.adjustProduct=target.dataset.adjust;overlay('Adjust stock',label('Quantity change (+/-)','delta','number','step=".001" required')+label('Reason *','reason','text','required minlength="3"'));return}
 }catch(e){toast(e.message,true)}
});
root.addEventListener('input',ev=>{if(ev.target.id==='product-search'){const t=document.querySelector('#product-table');if(t)t.innerHTML=productTable(ev.target.value)}});
document.addEventListener('submit',async ev=>{
 ev.preventDefault();if(data.working)return;const f=ev.target;data.working=true;
 f.querySelector('button[type=submit]')?.setAttribute('disabled','');
 try{if(f.id==='login'){const result=await api('/login',{method:'POST',body:JSON.stringify(fields(f))});data.user=result.user;
 if(data.user.mustChangePassword)passwordPage();else await reload();return;}
 if(f.id==='password'){const r=await api('/change-password',{method:'POST',body:JSON.stringify(fields(f))});data.user.mustChangePassword=false;
 await reload();toast('Password changed');return;}
 if(f.id==='modal-form'){await saveModal(f);return;}
 if(f.id==='save-sale'){
  if(!data.items.length)throw Error('No items');const b=fields(f);
  const total=round(data.items.reduce((s,l)=>s+l.qty*l.price-l.discount,0)-n(b.discount));
  const paid=n(b.paid);if(paid>total)throw Error('Payment exceeds total');
  const result=await api('/sales',{method:'POST',body:JSON.stringify({idempotencyKey:(data.saleSubmissionKey??=crypto.randomUUID()),items:data.items.map(l=>({productId:l.productId,qty:l.qty,price:l.price,discount:l.discount})),
   customerId:b.customerId||null,discount:n(b.discount),paid,method:b.method,notes:b.notes})});
  data.items=[];data.saleSubmissionKey=null;await reload();toast('Invoice '+result.sale.no+' saved to Supabase');return;}
 if(f.id==='save-purchase'){
  if(!data.grnItems.length)throw Error('No GRN lines');const b=fields(f);
  const result=await api('/purchases',{method:'POST',body:JSON.stringify({idempotencyKey:(data.grnSubmissionKey??=crypto.randomUUID()),items:data.grnItems,
   supplierId:b.supplierId,paid:n(b.paid),supplierInvoice:b.supplierInvoice,notes:b.notes})});
  data.grnItems=[];data.grnSubmissionKey=null;await reload();toast('GRN '+result.purchase.no+' posted to Supabase');return;}
 }catch(e){toast(e.message,true);f.querySelector('button[type=submit]')?.removeAttribute('disabled')}
 finally{data.working=false}
});
// Poll all currently-visible records; backend remains authoritative.
// Do not interrupt an unsaved sale, GRN, open dialog or actively edited field.
setInterval(async()=>{if(!data.user||data.user.mustChangePassword||data.working||data.items.length||data.grnItems.length||data.modal)return;
 if(document.activeElement?.matches('input,textarea,select'))return;
 try{await reload()}catch{}},10000);
boot();
