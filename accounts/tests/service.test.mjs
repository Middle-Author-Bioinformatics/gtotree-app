import {test} from 'node:test';
import assert from 'node:assert/strict';
import {Readable} from 'node:stream';
import {createService} from '../service.mjs';
import {HttpError} from '../policy.mjs';

function fixture({incomplete=false,admin=false}={}){
  const calls=[],profiles=new Map();let identity={sub:'member-B',name:'Scientist',email:'scientist@example.org',email_verified:true,admin};
  if(!incomplete)profiles.set(identity.sub,{email:identity.email,institution:'Independent',position:'Bioinformatician',favorite_software:'',research_area:''});
  const store={async getProfile(sub){return profiles.get(sub);},async saveProfile(who,fields){profiles.set(who.sub,{...who,...fields});return profiles.get(who.sub);},async reserveJob(...args){calls.push(['reserve',...args]);},async recordUsage(...args){calls.push(['usage',...args]);},async listProfiles(){return {users:[...profiles.values()],cursor:null};}};
  const objects={async codeExists(){return false;},async presignUpload(code,file){calls.push(['presign',code,file]);return {file_name:file.name,url:'https://signed.example/upload'};},async list(code){calls.push(['list',code]);return ['gtotree-report.html','output/GToTree_output.tre','run.log','status.json','raw-results.tar.gz'].map(path=>({key:code+'/'+path,size:100}));},async get(code,path){calls.push(['get',code,path]);return {body:Readable.from(['SCIENCE']),text:async()=>JSON.stringify({state:'complete',has_report:true,error:'/private/secret',command:'secret'})};}};
  const authenticate=async headers=>{if(headers.authorization!=='Bearer valid')throw new HttpError(401,'sign_in_required','Sign in.');return identity;};
  const service=createService({authenticate,store,objects,origins:['https://app.example']});
  const request=(path,method='GET',body,headers={authorization:'Bearer valid',origin:'https://app.example'})=>service({rawPath:path,requestContext:{http:{method}},headers,body:JSON.stringify(body)});
  return {request,calls,store,objects,profiles,identity};
}
test('unauthenticated requests cannot list/read/upload or alter profiles',async()=>{
  const f=fixture();for(const[path,method]of [['/profile','GET'],['/profile','PUT'],['/results/Example123','GET'],['/artifact/Example123/gtotree-report.html','GET'],['/upload','POST']]){
    assert.equal((await f.request(path,method,{},{})).status,401);
  }assert.deepEqual(f.calls,[]);
});
test('profile completion is enforced by server for every result/upload route',async()=>{
  const f=fixture({incomplete:true});
  for(const path of ['/results/Example123','/artifact/Example123/GToTree_output.tre','/upload'])assert.equal((await f.request(path,path==='/upload'?'POST':'GET',{})).status,403);
  assert.deepEqual(f.calls,[]);
  assert.equal(JSON.parse((await f.request('/profile')).body).complete,false);
  for(const fields of [{institution:'',position:'PI'},{institution:'Lab',position:'invented'},{institution:'Lab',position:'PI',favorite_software:'bad\nvalue'}])assert.equal((await f.request('/profile','PUT',fields)).status,400);
  const result=await f.request('/profile','PUT',{institution:'Independent',position:'Student',email:'attacker@evil.example',user_id:'another-user',admin:true});
  assert.equal(result.status,200);assert.equal(f.profiles.get('member-B').email,'scientist@example.org');
  assert.equal(f.profiles.has('another-user'),false);
  assert.equal(f.profiles.get('member-B').favorite_software,'');
  assert.equal((await f.request('/results/Example123')).status,200);
});
test('every completed member can view another result code, but not diagnostics',async()=>{
  const f=fixture();const response=await f.request('/results/OwnedByMemberA');
  assert.equal(response.status,200);assert.deepEqual(JSON.parse(response.body).files.map(f=>f.key),['OwnedByMemberA/gtotree-report.html','OwnedByMemberA/output/GToTree_output.tre']);
  assert.equal((await f.request('/artifact/OwnedByMemberA/output/GToTree_output.tre')).status,200);
  for(const path of ['run.log','result.json','raw-results.tar.gz','output/../run.log','output%2F..%2Frun.log','%2fhome%2fprivate','output/GToTree_output.tre%2F..'])assert.equal((await f.request('/artifact/OwnedByMemberA/'+path)).status,404,path);
  const status=JSON.parse((await f.request('/artifact/OwnedByMemberA/status.json')).body);
  assert.equal(status.state,'complete');assert.equal(status.error,undefined);assert.equal(status.command,undefined);
});
test('admin identity is verified server-side; ordinary users cannot export profiles',async()=>{
  assert.equal((await fixture().request('/admin/users')).status,403);
  const result=await fixture({admin:true}).request('/admin/users');assert.equal(result.status,200);assert.equal(JSON.parse(result.body).users.length,1);
});
test('upload validation happens before reservation/presigning; existing codes cannot be overwritten',async()=>{
  const f=fixture();const good={slug:'NewExample',files:[{name:'mine.fna',size:50},{name:'form-data.txt',size:30}]};
  for(const bad of [{...good,slug:'../bad'},{...good,files:[{name:'../mine.fna',size:20}]},{...good,files:[{name:'form-data.txt',size:101*1024*1024}]},{...good,files:[{name:'form-data.txt',size:-1}]},{...good,files:[{name:'form-data.txt',size:2},{name:'form-data.txt',size:2}]}])assert.equal((await f.request('/upload','POST',bad)).status,400);
  assert.deepEqual(f.calls,[]);
  f.objects.codeExists=async()=>true;assert.equal((await f.request('/upload','POST',good)).status,409);assert.deepEqual(f.calls,[]);
  f.objects.codeExists=async()=>false;assert.equal((await f.request('/upload','POST',good)).status,200);
  assert.deepEqual(f.calls.find(call=>call[0]==='reserve').slice(1,3),['NewExample','member-B']);
});
test('origin allow-list, literal result prefixes and generic failures protect private data',async()=>{
  const f=fixture();assert.equal((await f.request('/profile','GET',undefined,{authorization:'Bearer valid',origin:'https://app.example.evil.test'})).status,403);
  assert.equal((await f.request('/results/..')).status,400);
  f.objects.list=async()=>{throw new Error('/private/credentials');};
  const response=await f.request('/results/Example123');assert.equal(response.status,500);assert(!response.body.includes('private'));
});
