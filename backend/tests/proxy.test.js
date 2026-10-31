import test from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { clientAddress } from '../src/peer.js';
import { loadConfig } from '../src/config.js';
import { fixture, origin } from './helpers.js';
import { api, setup } from './auth-helpers.js';
import { io } from 'socket.io-client';
import { once } from 'node:events';

const key=randomBytes(32).toString('hex');
const env={TRUST_PROXY_LOOPBACK:'true',TRUSTED_PROXY_TOKEN:key};
const headers=ip=>({'x-forwarded-for':ip,'x-forwarded-proto':'https','x-naufragio-proxy-token':key});
const req=(peer,h)=>({socket:{remoteAddress:peer},headers:h,rawHeaders:Object.entries(h).flat()});

test('trusted proxy is explicit, secret-bound, loopback-only and rejects ambiguous client IPs',()=>{
  const cfg=loadConfig(env);
  assert.equal(clientAddress(req('::ffff:127.0.0.1',headers('203.0.113.8')),cfg),'203.0.113.8');
  assert.equal(clientAddress(req('127.0.0.1',headers('2001:db8:0:0::1')),cfg),'2001:db8::1');
  assert.equal(clientAddress(req('198.51.100.1',headers('203.0.113.8')),loadConfig({})),'198.51.100.1');
  for(const [peer,h]of [['198.51.100.1',headers('203.0.113.8')],['127.0.0.1',{}],['127.0.0.1',{...headers('203.0.113.8'),'x-naufragio-proxy-token':'0'.repeat(64)}],
    ...['127.0.0.1, 203.0.113.8','unknown','203.0.113.8:1',' 203.0.113.8','203.0.113.8 '].map(ip=>['127.0.0.1',headers(ip)])])assert.throws(()=>clientAddress(req(peer,h),cfg),/PROXY_DENIED/);
  const duplicate=req('127.0.0.1',headers('203.0.113.8'));duplicate.rawHeaders.push('X-Forwarded-For','203.0.113.9');
  assert.throws(()=>clientAddress(duplicate,cfg),/PROXY_DENIED/);
  for(const x of [{TRUST_PROXY_LOOPBACK:'yes'}, {TRUST_PROXY_LOOPBACK:'true'}, {...env,HOST:'0.0.0.0'}, {...env,TRUSTED_PROXY_TOKEN:'demo'}])assert.throws(()=>loadConfig(x));
});
test('HTTP proxy budgets distinguish clients and reject forged proxy identity',async t=>{
  const f=await fixture(t,{...env,HTTP_RATE_LIMIT:'1'});
  assert.equal((await api(f.url,'/health',{headers:headers('203.0.113.1')})).status,200);
  assert.equal((await api(f.url,'/health',{headers:{...headers('203.0.113.1'),'x-real-ip':'203.0.113.9',forwarded:'for=203.0.113.9'}})).status,429);
  assert.equal((await api(f.url,'/health',{headers:headers('203.0.113.2')})).status,200);
  assert.equal((await api(f.url,'/health',{headers:{'x-forwarded-for':'203.0.113.3'}})).status,403);
});
test('account authentication limit survives source IP rotation at the trusted proxy',async t=>{
  const f=await setup(t,{...env,AUTH_RATE_LIMIT:'2'});
  for(let i=1;i<=2;i++)assert.equal((await api(f.url,'/auth/login',{method:'POST',headers:headers('203.0.113.'+i),body:{username:'missing-account',password:'not-a-valid-secret'}})).status,401);
  assert.equal((await api(f.url,'/auth/login',{method:'POST',headers:headers('203.0.113.3'),body:{username:'missing-account',password:'not-a-valid-secret'}})).status,429);
});
test('Engine.IO polling and WebSocket enforce the same authenticated proxy boundary',async t=>{
  const f=await fixture(t,{...env,ENABLE_DIAGNOSTICS:'true'});
  for(const transport of ['websocket','polling']){
    const s=io(f.url+'/diagnostics',{autoConnect:false,reconnection:false,transports:[transport],extraHeaders:{...headers('203.0.113.8'),Origin:origin}});t.after(()=>s.disconnect());
    const ready=once(s,'connect',{signal:AbortSignal.timeout(4000)});s.connect();await ready;s.disconnect();
    const bad=io(f.url+'/diagnostics',{autoConnect:false,reconnection:false,transports:[transport],extraHeaders:{Origin:origin,'X-Forwarded-For':'203.0.113.8'}});t.after(()=>bad.disconnect());
    const failed=once(bad,'connect_error',{signal:AbortSignal.timeout(4000)});bad.connect();await failed;assert.equal(bad.connected,false);bad.disconnect();
  }
});
