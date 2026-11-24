import {randomUUID} from 'node:crypto';
import {HttpError,CODE,scientificFile,completeProfile,profileFields,uploadFiles} from './policy.mjs';

function json(status,data,headers={}) {return {status,headers:{'Content-Type':'application/json','Cache-Control':'no-store',...headers},body:status===204?'':JSON.stringify(data)};}
function bodyOf(event) {
  try {
    const raw=event.isBase64Encoded?Buffer.from(event.body??'','base64').toString('utf8'):(event.body??'{}');
    if(Buffer.byteLength(raw)>100000)throw new Error();
    const body=JSON.parse(raw);if(!body||typeof body!=='object'||Array.isArray(body))throw new Error();return body;
  }catch{throw new HttpError(400,'invalid_request','Invalid request.');}
}
export function createService({authenticate,store,objects,origins,now=()=>new Date().toISOString()}) {
  return async event=>{
    const headers=event.headers??{},origin=headers.origin??headers.Origin;
    const cors=origin&&origins.includes(origin)?{'Access-Control-Allow-Origin':origin,'Vary':'Origin'}:{};
    try {
      if(origin&&!origins.includes(origin))throw new HttpError(403,'origin_denied','Origin not allowed.');
      const method=event.requestContext?.http?.method??'';
      if(method==='OPTIONS')return json(204,null,{...cors,'Access-Control-Allow-Headers':'Authorization, Content-Type','Access-Control-Allow-Methods':'GET, PUT, POST, OPTIONS'});
      const identity=await authenticate(headers);
      const path=event.rawPath??'/';
      const profile=await store.getProfile(identity.sub);
      const complete=completeProfile(profile,identity);
      if(path==='/profile'&&method==='GET')return json(200,{identity:{name:identity.name,email:identity.email},profile:profile??null,complete,admin:identity.admin},cors);
      if(path==='/profile'&&method==='PUT') {
        const fields=profileFields(bodyOf(event));
        const saved=await store.saveProfile(identity,{...fields,updated_at:now(),created_at:profile?.created_at??now()});
        return json(200,{identity:{name:identity.name,email:identity.email},profile:saved,complete:true,admin:identity.admin},cors);
      }
      if(!complete)throw new HttpError(403,'profile_required','Complete your MAB profile before using the apps.');
      if(path==='/admin/users'&&method==='GET') {
        if(!identity.admin)throw new HttpError(403,'admin_required','Administrator access required.');
        const cursor=event.queryStringParameters?.cursor;
        if(cursor&&(cursor.length>1000||!/^[A-Za-z0-9_-]+$/.test(cursor)))throw new HttpError(400,'invalid_cursor','Invalid cursor.');
        return json(200,await store.listProfiles(cursor),cors);
      }
      const audit=async(action,code)=>{
        try {await store.recordUsage(identity.sub,{action,result_code:code,app:'gtotree',at:now(),event_id:randomUUID()});}
        catch{console.error('usage_record_failed');}
      };
      if(path==='/upload'&&method==='POST') {
        const body=bodyOf(event),files=uploadFiles(body);
        if(await objects.codeExists(body.slug))throw new HttpError(409,'code_exists','This result code already exists. Start a new submission.');
        await store.reserveJob(body.slug,identity.sub,now());
        const entries=await Promise.all(files.map(file=>objects.presignUpload(body.slug,file)));
        await audit('upload_authorized',body.slug);
        return json(200,{slug:body.slug,entries},cors);
      }
      const result=path.match(/^\/results\/([^/]+)$/);
      if(result&&method==='GET') {
        const code=result[1];if(!CODE.test(code))throw new HttpError(400,'invalid_code','Invalid result code.');
        const all=await objects.list(code);
        const files=all.filter(file=>scientificFile(file.key.slice(code.length+1)));
        await audit('view_result',code);
        return json(200,{files},cors);
      }
      const artifact=path.match(/^\/artifact\/([^/]+)\/(.+)$/);
      if(artifact&&method==='GET') {
        const code=artifact[1];let relative;
        try {relative=artifact[2].split('/').map(decodeURIComponent).join('/');}catch{throw new HttpError(400,'invalid_path','Invalid file path.');}
        if(!CODE.test(code)||!(relative==='status.json'||scientificFile(relative)))throw new HttpError(404,'not_found','File not found.');
        const object=await objects.get(code,relative);
        const type=relative.endsWith('.html')?'text/html; charset=utf-8':relative.endsWith('.json')?'application/json':'text/plain; charset=utf-8';
        // Legacy status files can contain command/path details; expose only viewer fields.
        if(relative==='status.json') {
          const state=JSON.parse(await object.text());
          return json(200,{state:state.state,status:state.status,has_report:state.has_report,has_tree:state.has_tree},cors);
        }
        await audit('read_artifact',code);
        return {status:200,headers:{...cors,'Content-Type':type,'Cache-Control':'no-store','X-Content-Type-Options':'nosniff','Content-Security-Policy':"sandbox allow-scripts allow-downloads"},body:object.body};
      }
      throw new HttpError(404,'not_found','Not found.');
    }catch(error) {
      if(error instanceof HttpError)return json(error.status,{code:error.code,error:error.message},cors);
      if(['NoSuchKey','NotFound'].includes(error.name))return json(404,{code:'not_found',error:'File not found.'},cors);
      if(error.name==='ConditionalCheckFailedException')return json(409,{code:'code_exists',error:'This result code already exists. Start a new submission.'},cors);
      console.error('accounts_request_failed',error.name);
      return json(500,{code:'service_error',error:'The service is temporarily unavailable.'},cors);
    }
  };
}
