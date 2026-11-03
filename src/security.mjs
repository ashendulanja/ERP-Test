import {randomBytes,createHash,scrypt as callbackScrypt,timingSafeEqual} from 'node:crypto';
import {promisify} from 'node:util';
const scrypt=promisify(callbackScrypt);
export const hashToken = token=>createHash('sha256').update(token).digest('hex');
export const newToken = ()=>randomBytes(32).toString('base64url');
export async function hashPassword(password){
 if(typeof password!=='string'||password.length<6||password.length>256)throw Error('Password must be 6–256 characters');
 const salt=randomBytes(16).toString('hex');
 const hash=(await scrypt(password,salt,64,{N:16384,r:8,p:1})).toString('hex');
 return `scrypt$16384$${salt}$${hash}`;
}
export async function verifyPassword(password,record){
 if(typeof password!=='string'||typeof record!=='string')return false;
 const [alg,nText,salt,expectedHex]=record.split('$');
 if(alg!=='scrypt'||nText!=='16384'||!salt||!expectedHex||expectedHex.length!==128)return false;
 const expected=Buffer.from(expectedHex,'hex');
 const actual=await scrypt(password,salt,64,{N:16384,r:8,p:1});
 return actual.length===expected.length&&timingSafeEqual(expected,actual);
}
export const publicAccount = a=>({id:a.id,username:a.username,name:a.display_name,role:a.role,
 permissions:a.permissions||[],screens:a.screens||[],showCost:a.show_cost,
 active:a.active,mustChangePassword:a.must_change_password});
