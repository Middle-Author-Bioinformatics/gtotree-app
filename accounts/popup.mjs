import {createHash,timingSafeEqual} from 'node:crypto';
import {HttpError} from './policy.mjs';

const HEX=/^[a-f0-9]{64}$/,STATE=/^[a-f0-9]{32}$/;
const isHex=value=>typeof value==='string'&&HEX.test(value);
const digest=value=>createHash('sha256').update(value).digest('hex');
const equal=(a,b)=>typeof a==='string'&&typeof b==='string'&&HEX.test(a)&&HEX.test(b)&&timingSafeEqual(Buffer.from(a,'hex'),Buffer.from(b,'hex'));
const fail=()=>{throw new HttpError(400,'invalid_popup','Invalid sign-in response.');};
export function createPopupRoutes({store,now=()=>Date.now()}){
  return async({path,method,body,origin,json,cors})=>{
    if(!path.startsWith('/oauth/popup/'))return null;
    if(method!=='POST'||!origin)throw new HttpError(403,'popup_denied','Sign-in response unavailable.');
    const action=path.slice('/oauth/popup/'.length);
    if(!['start','finish','read','cancel'].includes(action))throw new HttpError(404,'not_found','Not found.');
    const fields={start:['id','state','read_hash','write_hash'],finish:['id','secret','state','code','error'],read:['id','secret'],cancel:['id','secret']}[action];
    if(Object.keys(body).some(key=>!fields.includes(key))||!isHex(body.id))fail();
    const at=Math.floor(now()/1000);
    if(action==='start'){
      if(!STATE.test(body.state??'')||!isHex(body.read_hash)||!isHex(body.write_hash)||body.read_hash===body.write_hash)fail();
      await store.createPopup({popup_id:body.id,state:body.state,origin,read_hash:body.read_hash,write_hash:body.write_hash,expires_at:at+600});
      return json(201,{expires_at:at+600},cors);
    }
    if(!isHex(body.secret))fail();
    const item=await store.getPopup(body.id);
    if(!item||item.expires_at<=at)throw new HttpError(410,'popup_expired','Sign-in expired. Please try again.');
    const hash=digest(body.secret),expected=action==='finish'?item.write_hash:item.read_hash;
    if(item.origin!==origin||!equal(hash,expected))throw new HttpError(403,'popup_denied','Sign-in response unavailable.');
    if(action==='finish'){
      if(body.state!==item.state||!STATE.test(body.state??'')||Boolean(body.code)===Boolean(body.error))fail();
      if(body.code&&(typeof body.code!=='string'||body.code.length>4096||/[\s\x00-\x1f\x7f]/.test(body.code)))fail();
      if(body.error&&(typeof body.error!=='string'||!/^[a-zA-Z0-9_]{1,64}$/.test(body.error)))fail();
      const response=body.code?{code:body.code}:{error:body.error};
      await store.finishPopup(body.id,origin,hash,body.state,response,at);
      return json(200,{delivered:true},cors);
    }
    if(action==='cancel'){await store.deletePopup(body.id,origin,hash,at);return json(204,null,cors);}
    if(!item.response)return json(200,{ready:false},cors);
    // Conditional delete returns the response to exactly one reader, even under races.
    const consumed=await store.takePopup(body.id,origin,hash,at);
    return json(200,{ready:true,state:consumed.state,...consumed.response},cors);
  };
}
