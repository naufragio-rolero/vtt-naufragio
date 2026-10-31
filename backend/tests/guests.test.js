import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { roomFixture } from './room-helpers.js';
import { api } from './auth-helpers.js';
import { rawSocket,connect } from './token-helpers.js';

test('QR approval/rejection, single claim, normal membership and no elevation or cross-room access',async t=>{
  const f=await roomFixture(t),g=f.app.guests,id=f.created.room.id;
  const qr=g.open(f.director.token,id,{}).admission;
  const a=g.request({admissionToken:qr.token,displayName:'Ana'}),b=g.request({admissionToken:qr.token,displayName:'Bruno'});
  assert.throws(()=>g.claim({requestToken:a.requestToken}),/ADMISSION_NOT_APPROVED/);
  assert.throws(()=>g.list(f.member.token,id),/ROOM_ACCESS_DENIED|FORBIDDEN/);
  const list=g.list(f.director.token,id);assert.equal(list.requests.length,2);
  g.decide(f.director.token,id,list.requests[0].id,{approve:true});g.decide(f.director.token,id,list.requests[1].id,{approve:false});
  const guest=g.claim({requestToken:a.requestToken});assert.equal(guest.user.username,'Ana');assert.equal(guest.user.role,'user');assert.equal(guest.user.guest,true);
  assert.deepEqual(guest.selected.permissions,{diceAllowed:false,moveAssignedTokens:false});
  assert.throws(()=>g.claim({requestToken:a.requestToken}),/ADMISSION_NOT_APPROVED/);
  assert.equal(g.status({requestToken:b.requestToken}).state,'rejected');assert.throws(()=>g.claim({requestToken:b.requestToken}),/ADMISSION_NOT_APPROVED/);
  assert.throws(()=>f.auth.updateUser(f.token,guest.user.id,{role:'director'}),/FORBIDDEN/);
  assert.throws(()=>f.rooms.create(guest.token,{name:'Escalation'}),/FORBIDDEN/);
  const other=f.rooms.create(f.director.token,{name:'Private other room'});
  assert.throws(()=>f.rooms.access(guest.token,other.room.id),/ROOM_ACCESS_DENIED/);
  assert.throws(()=>f.rooms.join(guest.token,{code:other.admissionCode.code}),/FORBIDDEN/);
  assert.throws(()=>f.rooms.invite(f.director.token,other.room.id,{userId:guest.user.id}),/FORBIDDEN/);
  assert.throws(()=>g.open(guest.token,id,{}),/FORBIDDEN/);
  const passwordChange=await api(f.url,'/auth/password',{method:'POST',token:guest.token,body:{currentPassword:'arbitrary',newPassword:'arbitrary'}});assert.equal(passwordChange.status,403);
  const row=f.app.store.db.prepare('SELECT username FROM users WHERE id=?').get(guest.user.id);
  await assert.rejects(f.auth.login({username:row.username,password:'arbitrary'}),/INVALID_CREDENTIALS/);
  for(const table of ['room_admissions','guest_requests']){
    const text=JSON.stringify(f.app.store.db.prepare('SELECT * FROM '+table).all());
    for(const secret of [qr.token,a.requestToken,guest.token])assert.equal(text.includes(secret),false);
  }
});
test('QR expiry, pause/reopen, rotation and revocation do not admit pending requests',async t=>{
  let now=Date.now();const f=await roomFixture(t,{}, {clock:()=>now}),g=f.app.guests,id=f.created.room.id;
  const qr=g.open(f.director.token,id,{expiresInSeconds:60}).admission;
  const request=g.request({admissionToken:qr.token,displayName:'Pending'});
  g.configure(f.director.token,id,{open:false});assert.throws(()=>g.status({requestToken:request.requestToken}),/ADMISSION_EXPIRED/);
  g.configure(f.director.token,id,{open:true});assert.equal(g.status({requestToken:request.requestToken}).state,'rejected');
  const next=g.request({admissionToken:qr.token,displayName:'Expiry'});now+=60001;
  assert.throws(()=>g.claim({requestToken:next.requestToken}),/ADMISSION_EXPIRED/);
  assert.throws(()=>g.request({admissionToken:qr.token,displayName:'No'}),/ADMISSION_EXPIRED/);
  const second=g.open(f.director.token,id,{}).admission;
  g.open(f.director.token,id,{});assert.throws(()=>g.request({admissionToken:second.token,displayName:'Old'}),/ADMISSION_EXPIRED/);
  const third=g.open(f.director.token,id,{}).admission;g.configure(f.director.token,id,{open:false,revoke:true});
  assert.throws(()=>g.request({admissionToken:third.token,displayName:'Revoked'}),/ADMISSION_EXPIRED/);
});
test('temporary member disconnects immediately on expulsion, cannot reuse session, and expiry cleans identities',async t=>{
  let now=Date.now();const f=await roomFixture(t,{GUEST_SESSION_TTL_SECONDS:'60'}, {clock:()=>now}),g=f.app.guests,id=f.created.room.id;
  function admit(name){const qr=g.open(f.director.token,id,{}).admission;const r=g.request({admissionToken:qr.token,displayName:name});const q=g.list(f.director.token,id).requests.find(x=>x.displayName===name);g.decide(f.director.token,id,q.id,{approve:true});return g.claim({requestToken:r.requestToken});}
  const guest=admit('Expelled'),socket=await connect(rawSocket(t,f,guest));
  const disconnected=once(socket,'disconnect',{signal:AbortSignal.timeout(3000)});f.rooms.revokeMember(f.director.token,id,guest.user.id);await disconnected;
  assert.throws(()=>f.auth.session(guest.token),/UNAUTHENTICATED/);
  g.cleanup();assert.equal(f.app.store.db.prepare('SELECT * FROM users WHERE id=?').get(guest.user.id),undefined);
  const next=admit('Expired');now+=60001;assert.throws(()=>f.auth.session(next.token),/UNAUTHENTICATED/);g.cleanup();
  assert.equal(f.app.store.db.prepare('SELECT count(*) AS n FROM guest_accounts').get().n,0);
});
test('guest inputs, capacities and HTTP request attempts are bounded',async t=>{
  const f=await roomFixture(t,{GUEST_LIMIT:'1',GUEST_REQUEST_RATE_LIMIT:'2'}),g=f.app.guests,id=f.created.room.id,qr=g.open(f.director.token,id,{}).admission;
  for(const input of [{admissionToken:qr.token,displayName:'',role:'director'},{admissionToken:qr.token,displayName:'x'.repeat(41)},{admissionToken:qr.token,displayName:'\u202eBad'}])assert.throws(()=>g.request(input),/INVALID_INPUT/);
  const body={admissionToken:qr.token,displayName:'Visitor'};
  assert.equal((await api(f.url,'/guest-requests',{method:'POST',body})).status,201);
  assert.equal((await api(f.url,'/guest-requests',{method:'POST',body})).status,429);
  assert.equal((await api(f.url,'/guest-requests',{method:'POST',body,headers:{'X-Forwarded-For':'203.0.113.44'}})).status,429);
  assert.throws(()=>g.status({requestToken:qr.token}),/ADMISSION_EXPIRED/);
});

test('account socket capacity cannot be exhausted by reusing a guest session in many tabs',async t=>{
  const f=await roomFixture(t,{ACCOUNT_CONNECTION_LIMIT:'1'}),g=f.app.guests,id=f.created.room.id;
  const qr=g.open(f.director.token,id,{}).admission,r=g.request({admissionToken:qr.token,displayName:'Bounded'});
  g.decide(f.director.token,id,g.list(f.director.token,id).requests[0].id,{approve:true});
  const guest=g.claim({requestToken:r.requestToken});await connect(rawSocket(t,f,guest));
  const extra=rawSocket(t,f,guest);const rejected=once(extra,'connect_error',{signal:AbortSignal.timeout(3000)});extra.connect();
  assert.equal((await rejected)[0].message,'ACCOUNT_CONNECTION_LIMIT');assert.equal(extra.connected,false);
});
