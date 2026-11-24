import {HttpError,CODE} from './policy.mjs';

export const APP_IDS=['taxonsleuth','fegenie','breseq','basil'];
export function resultPrefix(app,code){return (app==='fegenie'?'fegenie-':'')+code;}
export function safePath(path){return typeof path==='string'&&path.length<1024&&!/[\\\x00-\x1f\x7f]/.test(path)&&path.split('/').every(part=>part&&part!=='.'&&part!=='..');}
export function appFile(app,path){
  if(!safePath(path)||path.split('/').some(p=>/(^|[._-])(logs?|commands?|stderr|stdout|manifest|credentials?)([._-]|$)/i.test(p)))return false;
  if(app==='fegenie')return ['FeGenie-heatmap-data.csv','FeGenie-geneSummary.csv','fegenie-report.html'].includes(path);
  if(app==='basil')return /^(basil_plots|basil_output)\//.test(path)&&/\.(csv|tsv|txt|png|jpe?g|webp|gif|pdf)$/i.test(path);
  if(app==='breseq'){
    if(/^(?:[A-Za-z0-9_.-]+\/)?mutation_predictions\.json$/.test(path))return true;
    // Only final scientific output directories. FASTQ uploads can share this bucket.
    return /^(?:[A-Za-z0-9_.-]+\/)?output\//.test(path)&&/\.(html|css|js|png|jpe?g|gif|svg|ico|gd|csv|tsv|txt|fasta|fa|fna|bam|bai)$/i.test(path);
  }
  return false;
}
export function appUploadFiles(app,body){
  if(!CODE.test(body.slug??'')||!Array.isArray(body.files)||!body.files.length||body.files.length>200)throw new HttpError(400,'invalid_upload','Invalid submission.');
  const seen=new Set();let bytes=0;
  const files=body.files.map(file=>{
    if(!file||typeof file.name!=='string'||!/^[A-Za-z0-9._-]{1,180}$/.test(file.name)||file.name.includes('..')||seen.has(file.name)||!Number.isSafeInteger(file.size)||file.size<0||file.size>1024**3)throw new HttpError(400,'invalid_upload','Invalid file name or size (maximum 1 GB per file).');
    seen.add(file.name);bytes+=file.size;
    if(bytes>5*1024**3)throw new HttpError(400,'invalid_upload','Maximum submission size is 5 GB.');
    return {name:file.name,size:file.size,content_type:typeof file.content_type==='string'&&/^[A-Za-z0-9.+-]+\/[A-Za-z0-9.+-]+$/.test(file.content_type)?file.content_type:'application/octet-stream'};
  });
  const manifest=app==='fegenie'?`manifest-${body.slug}.txt`:app==='basil'?'manifest.txt':'form-data.txt';
  if(!seen.has(manifest))throw new HttpError(400,'invalid_upload','Submission manifest is missing.');
  const allowed=app==='fegenie'?/\.(fa|fasta|fna|gbk|gbff|gb|gbf)$/i:app==='basil'?/\.csv$/i:/\.(fastq|fq)(\.gz)?$|\.(gb|gbk|gbff|genbank|gff3?|fa|fasta|fna|fas)(\.gz)?$/i;
  if(files.some(f=>f.name!==manifest&&!allowed.test(f.name)))throw new HttpError(400,'invalid_upload','Unsupported input file.');
  return files;
}
export function cleanStatus(data){
  const out={};
  for(const key of ['state','status','run_name','started_at','finished_at','current_step'])if(typeof data[key]==='string'&&!data[key].includes('/'))out[key]=data[key].slice(0,300);
  if(data.state==='failed')out.error='The analysis failed. Contact MAB with the result code.';
  if(data.steps&&typeof data.steps==='object')out.steps=Object.fromEntries(Object.entries(data.steps).filter(([key])=>/^[A-Za-z0-9_-]+$/.test(key)).map(([key,value])=>[key,cleanStatus(value??{})]));
  return out;
}
export function createAppRoutes({apps,objects,store,search,now=()=>new Date().toISOString()}){
  return async({path,method,bodyOf,identity,audit,json,cors})=>{
    const match=path.match(/^\/apps\/(taxonsleuth|fegenie|breseq|basil)\/(search|upload|results|artifact)(?:\/([^/]+))?(?:\/(.+))?$/);
    if(!match)return null;
    const [,app,action,code,encoded]=match,config=apps[app];
    if(!config)throw new HttpError(503,'app_unavailable','This app is not configured yet.');
    if(app==='taxonsleuth'&&action==='search'&&method==='POST'&&!code){
      const result=await search(config,bodyOf());
      await audit('search','',app);
      return {status:result.status,headers:{...cors,'Content-Type':result.type,'Cache-Control':'no-store'},body:result.body};
    }
    if(app==='taxonsleuth')throw new HttpError(404,'not_found','Not found.');
    if(action==='upload'&&method==='POST'&&!code){
      const body=bodyOf(),files=appUploadFiles(app,body),prefix=resultPrefix(app,body.slug);
      if(await objects.codeExists(prefix,config))throw new HttpError(409,'code_exists','This result code already exists. Start a new submission.');
      await store.reserveJob(`${app}:${body.slug}`,identity.sub,now(),app);
      const entries=await Promise.all(files.map(file=>objects.presignUpload(prefix,file,config)));
      await audit('upload_authorized',body.slug,app);
      return json(200,{slug:body.slug,entries},cors);
    }
    if(!CODE.test(code??''))throw new HttpError(400,'invalid_code','Invalid result code.');
    const prefix=resultPrefix(app,code);
    if(action==='results'&&method==='GET'&&!encoded){
      const files=(await objects.list(prefix,config)).filter(f=>appFile(app,f.key.slice(prefix.length+1)));
      const entries=await Promise.all(files.map(async f=>({...f,url:f.key.endsWith('.html')?undefined:await objects.presignRead(prefix,f.key.slice(prefix.length+1),config)})));
      await audit('view_result',code,app);
      return json(200,{files:entries,expires_at:Date.now()+900000},cors);
    }
    if(action==='artifact'&&method==='GET'&&encoded){
      let relative;try{relative=encoded.split('/').map(decodeURIComponent).join('/');}catch{throw new HttpError(404,'not_found','File not found.');}
      if(!safePath(relative)||!(relative==='status.json'||app==='breseq'&&relative==='samples.json'||appFile(app,relative)))throw new HttpError(404,'not_found','File not found.');
      const object=await objects.get(prefix,relative,config);
      if(relative==='status.json')return json(200,cleanStatus(JSON.parse(await object.text())),cors);
      if(relative==='samples.json'){
        const data=JSON.parse(await object.text());
        return json(200,{samples:Array.isArray(data.samples)?data.samples.filter(s=>/^[A-Za-z0-9_.-]+$/.test(s.key)&&!['.','..'].includes(s.key)).map(s=>({key:s.key,label:String(s.label??s.key).slice(0,200)})):[]},cors);
      }
      await audit('read_artifact',code,app);
      return {status:200,headers:{...cors,'Content-Type':relative.endsWith('.html')?'text/html; charset=utf-8':'application/octet-stream','Cache-Control':'no-store','X-Content-Type-Options':'nosniff','Content-Security-Policy':'sandbox allow-scripts allow-downloads'},body:object.body};
    }
    throw new HttpError(404,'not_found','Not found.');
  };
}
