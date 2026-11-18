import { ApiError, rewardView, validId } from './common.mjs';
import { normalizePhone } from './sms.mjs';

const encoder = new TextEncoder();
const domain = 'defi-boreal/customer-phone/aes-gcm/v1';
const keyCache = new WeakMap();

function encode(bytes) {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll('+', '-').replaceAll('/', '_').replaceAll('=', '');
}
function decode(value) {
  if (typeof value !== 'string' || !/^[A-Za-z0-9_-]+$/.test(value)) throw Error('invalid_encoding');
  return Uint8Array.from(atob(value.replaceAll('-', '+').replaceAll('_', '/') + '='.repeat((4-value.length%4)%4)), c=>c.charCodeAt(0));
}
async function encryptionKey(env) {
  const secret = env.REWARDS_HMAC_SECRET;
  if (typeof secret !== 'string' || encoder.encode(secret).length < 32) throw new ApiError(503, 'customer_privacy_unavailable', 'La protection des renseignements clients est indisponible.');
  // The existing high-entropy server secret is never sent to the browser. A
  // separate domain derives this key independently of HMAC lookup purposes.
  const previous=keyCache.get(env);
  if(previous?.secret===secret)return previous.promise;
  const promise=(async()=>{const raw=await crypto.subtle.digest('SHA-256',encoder.encode(domain+'\0'+secret));return crypto.subtle.importKey('raw',raw,{name:'AES-GCM'},false,['encrypt','decrypt']);})();
  keyCache.set(env,{secret,promise});
  try{return await promise;}catch(error){if(keyCache.get(env)?.promise===promise)keyCache.delete(env);throw error;}
}
function additionalData(rewardId) {
  if (!validId(rewardId)) throw new TypeError('A valid reward ID is required for customer data');
  return encoder.encode(domain+'\0'+rewardId);
}

export function normalizeNameSearch(value) {
  if (typeof value !== 'string') throw new TypeError('Name must be a string');
  return value.normalize('NFKD').replace(/\p{M}/gu,'').toLocaleLowerCase('fr-CA').replaceAll('œ','oe').replaceAll('æ','ae').replace(/\s+/gu,' ').trim();
}

export async function encryptCustomerPhone(env, phone, rewardId) {
  const normalized = normalizePhone(phone), iv = crypto.getRandomValues(new Uint8Array(12));
  const encrypted = await crypto.subtle.encrypt({name:'AES-GCM',iv,additionalData:additionalData(rewardId)}, await encryptionKey(env), encoder.encode(normalized));
  return 'v1.'+encode(iv)+'.'+encode(new Uint8Array(encrypted));
}

export async function decryptCustomerPhone(env, ciphertext, rewardId) {
  // Older rewards only retained a phone HMAC and cannot be reconstructed.
  if (ciphertext == null) return null;
  try {
    if (typeof ciphertext !== 'string' || ciphertext.length > 256) throw Error('invalid_ciphertext');
    const parts = ciphertext.split('.');
    if (parts.length !== 3 || parts[0] !== 'v1') throw Error('unsupported_format');
    const iv = decode(parts[1]), data = decode(parts[2]);
    if (iv.length !== 12 || data.length < 16) throw Error('invalid_ciphertext');
    const decrypted = await crypto.subtle.decrypt({name:'AES-GCM',iv,additionalData:additionalData(rewardId)}, await encryptionKey(env),data);
    return normalizePhone(new TextDecoder('utf-8',{fatal:true}).decode(decrypted));
  } catch {
    throw new ApiError(503,'customer_privacy_unavailable','Les coordonnées de ce client ne peuvent pas être consultées pour le moment.');
  }
}

export async function customerColumns(env,{phone,firstName,lastName,rewardId}) {
  const normalized=normalizePhone(phone);
  return {phoneCiphertext:await encryptCustomerPhone(env,normalized,rewardId),phoneLast4:normalized.slice(-4),nameSearch:normalizeNameSearch([firstName,lastName].filter(Boolean).join(' '))};
}

// Only authenticated admin handlers call this projection. Public receipts keep
// using publicRewardView, which never includes encrypted or plaintext phones.
export async function adminCustomerView(env,row,now=Date.now()) {
  if (!row) return null;
  return {...rewardView(row,now),fullName:[row.first_name,row.last_name].filter(Boolean).join(' '),phone:await decryptCustomerPhone(env,row.phone_ciphertext,row.id),phoneLast4:row.phone_last4??null,phoneVerified:row.phone_verified===1};
}
