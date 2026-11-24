import {test} from 'node:test';
import assert from 'node:assert/strict';
import {Readable} from 'node:stream';
import {createService} from '../service.mjs';
import {appFile,appUploadFiles,cleanStatus} from '../apps.mjs';
import {HttpError} from '../policy.mjs';

function fixture({complete=true,authenticated=true}={}){
  const calls=[];
  const identity={sub:'member-B',name:'Scientist',email:'s@example.org',email_verified:true,admin:false};
  const store={getProfile:async()=>complete?{email:identity.email,institution:'Independent',position:'PI'}:null,
    reserveJob:async(...args)=>calls.push(['reserve',...args]),recordUsage:async(...args)=>calls.push(['usage',...args])};
  const objects={
    codeExists:async(...args)=>{calls.push(['exists',...args]);return false;},
    presignUpload:async(...args)=>{calls.push(['upload',...args]);return {file_name:args[1].name};},
    presignRead:async(...args)=>{calls.push(['sign-read',...args]);return 'https://signed.invalid/file';},
    list:async(prefix,config)=>{calls.push(['list',prefix,config]);return ['input.fastq','form-data.txt','run.log','output/index.html','output/evidence/a.png','output/command.txt','basil_plots/a.png','basil_output/a/data.csv','logs/runner.log','FeGenie-heatmap-data.csv','fegenie-report.html'].map(p=>({key:prefix+'/'+p,size:2}));},
    get:async(...args)=>{calls.push(['get',...args]);return {body:Readable.from(['SCIENCE']),text:async()=>JSON.stringify({state:'failed',error:'/home/server/secret',command:'secret',steps:{basil:{state:'failed',error:'secret'}}})};}
  };
  const apps={taxonsleuth:{searchFunction:'search'},...Object.fromEntries(['fegenie','breseq','basil'].map(a=>[a,{inputBucket:a+'-input',resultsBucket:a+'-results'}]))};
  const service=createService({authenticate:async()=>{if(!authenticated)throw new HttpError(401,'sign_in_required','Sign in.');return identity;},store,objects,apps,origins:['https://app.example'],search:async(config,body)=>{calls.push(['search',config,body]);return {status:200,type:'text/tab-separated-values',body:'organism\nBacterium'};}});
  return {calls,objects,request:(path,method='GET',body)=>service({rawPath:path,requestContext:{http:{method}},headers:{origin:'https://app.example'},body:JSON.stringify(body)})};
}
test('all four apps require verified authentication and complete profiles before any data service call',async()=>{
  for(const [opts,status] of [[{authenticated:false},401],[{complete:false},403]]){
    const f=fixture(opts);
    for(const app of ['fegenie','breseq','basil'])for(const [tail,method]of [['results/OtherMember','GET'],['artifact/OtherMember/status.json','GET'],['upload','POST']])assert.equal((await f.request(`/apps/${app}/${tail}`,method,{})).status,status);
    assert.equal((await f.request('/apps/taxonsleuth/search','POST',{query:'Bacterium'})).status,status);
    assert.deepEqual(f.calls,[]);
  }
});
test('members can read another code; result listings sign only scientific files from the correct app/prefix',async()=>{
  for(const app of ['fegenie','breseq','basil']){
    const f=fixture(),response=await f.request(`/apps/${app}/results/OtherMember`);
    assert.equal(response.status,200);const files=JSON.parse(response.body).files;
    const prefix=app==='fegenie'?'fegenie-OtherMember':'OtherMember';
    assert(files.length);assert(files.every(x=>x.key.startsWith(prefix+'/')&&appFile(app,x.key.slice(prefix.length+1))));
    assert(files.every(x=>x.key.endsWith('.html')?!x.url:!!x.url));
    assert(f.calls.find(x=>x[0]==='usage')[2].app===app);
    assert.equal(f.calls.find(x=>x[0]==='list')[2].resultsBucket,app+'-results');
  }
});
test('search proxy preserves TSV exports and records TaxonSleuth usage',async()=>{
  const f=fixture(),r=await f.request('/apps/taxonsleuth/search','POST',{operation:'schema'});
  assert.equal(r.status,200);assert.equal(r.headers['Content-Type'],'text/tab-separated-values');
  assert.equal(f.calls.find(x=>x[0]==='usage')[2].app,'taxonsleuth');
});
test('diagnostics, raw uploads, archives and traversal are blocked before S3 gets/signing',async()=>{
  for(const app of ['fegenie','breseq','basil']){
    const f=fixture();
    for(const path of ['run.log','input.fastq','logs/runner.log','output/command.txt','all.tar.gz','output/../run.log','output%2F..%2Frun.log','output/%2e%2e/run.log'])assert.equal((await f.request(`/apps/${app}/artifact/OtherMember/${path}`)).status,404,app+':'+path);
    assert.deepEqual(f.calls,[]);
    const r=await f.request(`/apps/${app}/artifact/OtherMember/status.json`);
    assert.equal(r.status,200);assert(!r.body.includes('/home'));assert(!r.body.includes('secret'));assert.equal(JSON.parse(r.body).state,'failed');
  }
});
test('uploads bind app bucket/prefix, separate cross-app codes and reject overwritten or malformed jobs',async()=>{
  for(const app of ['fegenie','breseq','basil']){
    const f=fixture(),manifest=app==='fegenie'?'manifest-NewCode.txt':app==='basil'?'manifest.txt':'form-data.txt',name=app==='basil'?'data.csv':'genome.fna';
    const body={slug:'NewCode',files:[{name,size:100,content_type:'text/plain'},{name:manifest,size:20}]};
    assert.equal((await f.request(`/apps/${app}/upload`,'POST',body)).status,200);
    assert.equal(f.calls.find(x=>x[0]==='reserve')[1],app+':NewCode');
    const upload=f.calls.find(x=>x[0]==='upload');assert.equal(upload[1],app==='fegenie'?'fegenie-NewCode':'NewCode');assert.equal(upload[3].inputBucket,app+'-input');
    f.objects.codeExists=async()=>true;assert.equal((await f.request(`/apps/${app}/upload`,'POST',body)).status,409);
    for(const files of [[{name:'../escape',size:1}],[{name:manifest,size:-1}],[{name:manifest,size:1024**3+1}],[{name:manifest,size:1},{name:manifest,size:1}]])assert.throws(()=>appUploadFiles(app,{slug:'NewCode',files}));
  }
});
test('safe output patterns do not admit adjacent job inputs or worker metadata',()=>{
  assert(appFile('breseq','sample/output/evidence/test.svg'));
  assert(appFile('basil','basil_output/sample/results.csv'));
  for(const p of ['../other/output/index.html','output//index.html','sample/output/../run.log','output/commands.txt','status.json'])assert(!appFile('breseq',p));
  assert(!JSON.stringify(cleanStatus({state:'failed',error:'sensitive',command:'secret'})).includes('secret'));
});
