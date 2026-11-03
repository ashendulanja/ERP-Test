import test from 'node:test';import assert from 'node:assert/strict';
import {hashPassword,verifyPassword,newToken,hashToken,publicAccount} from '../src/security.mjs';
test('password hashes are salted and verified safely',async()=>{
 const a=await hashPassword('AHW123'),b=await hashPassword('AHW123');
 assert.notEqual(a,b);assert.equal(await verifyPassword('AHW123',a),true);
 assert.equal(await verifyPassword('WRONG',a),false);
 assert.equal(await verifyPassword('AHW123','malformed'),false);
});
test('tokens random and hashed before storage',()=>{
 const a=newToken(),b=newToken();assert.notEqual(a,b);assert.notEqual(hashToken(a),a);
});
test('public account excludes password hash',()=>{
 const a=publicAccount({id:'1',username:'x',display_name:'X',role:'staff',password_hash:'hidden',active:true});
 assert.equal(Object.prototype.hasOwnProperty.call(a,'password_hash'),false);
});
