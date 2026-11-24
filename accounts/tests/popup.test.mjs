import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {createService} from '../service.mjs';

const id='a'.repeat(64),read='b'.repeat(64),write='c'.repeat(64),state='d'.repeat(32);
const hash=value=>createHash('sha256').update(value).digest('hex');
function fixture(){
  const rows=new Map(),at=Math.floor(Date.now()/1000);let authCalls=0;
  const conflict=()=>{const e=new Error('condition');e.name='ConditionalCheckFailedException';throw e;};
  const store={
    async createPopup(item){if(rows.has(item.popup_id))conflict();rows.set(item.popup_id,structuredClone(item));},
    async getPopup(id){return structuredClone(rows.get(id));},
    async finishPopup(id,origin,key,state,response,now){const row=rows.get(id);if(!row||row.origin!==origin||row.write_hash!==key||row.state!==state||row.expires_at<=now||row.response)conflict();row.response=response;},
    async takePopup(id,origin,key,now){const row=rows.get(id);if(!row||row.origin!==origin||row.read_hash!==key||row.expires_at<=now||!row.response)conflict();rows.delete(id);return structuredClone(row);},
    async deletePopup(id,origin,key,now){const row=rows.get(id);if(!row||row.origin!==origin||row.read_hash!==key||row.expires_at<=now)conflict();rows.delete(id);}
  };
  const service=createService({authenticate:async()=>{authCalls++;throw Object.assign(new Error('auth'),{name:'NotFound'});},store,objects:{},origins:['https://app.example','https://other.example']});
  const request=(action,body,origin='https://app.example',method='POST')=>service({rawPath:'/oauth/popup/'+action,requestContext:{http:{method}},headers:{origin},body:JSON.stringify(body)});
  const start=()=>request('start',{id,state,read_hash:hash(read),write_hash:hash(write)});
  const finish=()=>request('finish',{id,state,secret:write,code:'one-use-code'});
  return {rows,request,start,finish,authCalls:()=>authCalls,at};
}
test('anonymous popup exchange is short lived and one use; it stores no tokens or verifier',async()=>{
  const f=fixture();assert.equal((await f.start()).status,201);
  const saved=f.rows.get(id);assert.equal(saved.expires_at,f.at+600);assert.equal(saved.secret,undefined);assert.equal(saved.code_verifier,undefined);assert.equal(saved.access_token,undefined);assert.equal(saved.read_hash,hash(read));
  assert.deepEqual(JSON.parse((await f.request('read',{id,secret:read})).body),{ready:false});
  assert.equal((await f.finish()).status,200);
  assert.deepEqual(JSON.parse((await f.request('read',{id,secret:read})).body),{ready:true,state,code:'one-use-code'});
  assert.equal((await f.request('read',{id,secret:read})).status,410);assert.equal(f.authCalls(),0);assert.equal(f.rows.size,0);
});
test('reader and writer capabilities cannot substitute for each other or cross app origins',async()=>{
  const f=fixture();await f.start();
  assert.equal((await f.request('read',{id,secret:write})).status,403);
  assert.equal((await f.request('finish',{id,state,secret:read,code:'wrong'})).status,403);
  assert.equal((await f.request('read',{id,secret:read},'https://other.example')).status,403);
  assert.equal((await f.request('finish',{id,state,secret:write,code:'wrong'},'https://other.example')).status,403);
  assert.equal((await f.request('start',{id,state,read_hash:hash(read),write_hash:hash(write)},'https://evil.example')).status,403);
  assert.equal((await f.request('start',{id,state,read_hash:hash(read),write_hash:hash(write)},'')).status,403);
});
test('a forged state, token payload, malformed code or malformed error is rejected',async()=>{
  const f=fixture();await f.start();
  for(const payload of [{state:'e'.repeat(32),code:'wrong'},{state,code:'x',access_token:'secret'},{state,code:'x',code_verifier:'secret'},{state,code:'line\nbreak'},{state,code:'x'.repeat(4097)},{state,code:'x',error:'login_required'},{state,error:'bad error!'}, {state}]){
    assert.equal((await f.request('finish',{id,secret:write,...payload})).status,400);
  }
  assert.equal(f.rows.get(id).response,undefined);
});
test('responses cannot overwrite completed transactions or resurrect expired transactions',async()=>{
  const f=fixture();await f.start();assert.equal((await f.start()).status,409);await f.finish();
  assert.equal((await f.request('finish',{id,state,secret:write,code:'overwrite'})).status,409);
  assert.equal(f.rows.get(id).response.code,'one-use-code');
  f.rows.get(id).expires_at=f.at;
  assert.equal((await f.request('read',{id,secret:read})).status,410);assert.equal((await f.finish()).status,410);
});
test('simultaneous readers get at most one authorization response',async()=>{
  const f=fixture();await f.start();await f.finish();
  const responses=await Promise.all([f.request('read',{id,secret:read}),f.request('read',{id,secret:read})]);
  assert.equal(responses.filter(r=>r.status===200).length,1);
  assert.equal(responses.filter(r=>[409,410].includes(r.status)).length,1);
});
test('cancellation is capability checked and deletes the pending response',async()=>{
  const f=fixture();await f.start();
  assert.equal((await f.request('cancel',{id,secret:write})).status,403);assert.equal((await f.request('cancel',{id,secret:read})).status,204);
  assert.equal((await f.finish()).status,410);assert.equal(f.rows.size,0);
});
test('OAuth errors return through the relay; CORS is exact and requests cannot use GET or URL secrets',async()=>{
  const f=fixture();await f.start();
  assert.equal((await f.request('finish',{id,state,secret:write,error:'access_denied'})).status,200);
  const result=await f.request('read',{id,secret:read});assert.equal(JSON.parse(result.body).error,'access_denied');assert.equal(result.headers['Cache-Control'],'no-store');assert.equal(result.headers['Access-Control-Allow-Origin'],'https://app.example');
  assert.equal((await f.request('read',{id,secret:read},'https://app.example','GET')).status,403);
  assert.equal((await f.request('read',{id,secret:read},'https://app.example.evil.test')).status,403);
});
