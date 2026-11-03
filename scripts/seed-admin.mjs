import 'dotenv/config';
import pg from 'pg';
import {hashPassword} from '../src/security.mjs';
if(!process.env.DATABASE_URL)throw Error('DATABASE_URL missing');
const username=process.env.INITIAL_ADMIN_USERNAME||'AHW123@';
const password=process.env.INITIAL_ADMIN_PASSWORD;
if(!password)throw Error('INITIAL_ADMIN_PASSWORD missing. Set it only for this seed command.');
const pool=new pg.Pool({connectionString:process.env.DATABASE_URL,ssl:process.env.NODE_ENV==='production'?{rejectUnauthorized:true}:undefined,max:2});
try{
 const existing=await pool.query('select id from public.account limit 1');
 if(existing.rowCount)throw Error('Accounts already exist. To prevent takeover, initial seeding is disabled.');
 const hash=await hashPassword(password);
 const r=await pool.query(`insert into public.account(username,display_name,password_hash,role,permissions,screens,show_cost,active,must_change_password)
 values($1,'Administrator',$2,'admin',array['all'],array['dashboard','pos','sales','quotes','proformas','products','stock','inventory','discounts','purchases','customers','suppliers','expenses','returns','barcode','printmanager','reports','bulk','accounts','settings'],true,true,true) returning id,username`,[username,hash]);
 console.log('Created initial admin account:',r.rows[0].username,'id:',r.rows[0].id);
 console.log('Password hashed. A password change will be required on first login.');
}finally{await pool.end()}
