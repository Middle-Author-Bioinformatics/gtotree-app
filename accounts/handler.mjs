import {LambdaClient,InvokeCommand} from '@aws-sdk/client-lambda';
import {getSignedUrl} from '@aws-sdk/s3-request-presigner';
import {pipeline} from 'node:stream/promises';
import {Readable} from 'node:stream';
import {S3Client,ListObjectsV2Command,GetObjectCommand} from '@aws-sdk/client-s3';
import {DynamoDBClient} from '@aws-sdk/client-dynamodb';
import {DynamoDBDocumentClient,GetCommand,PutCommand,ScanCommand,UpdateCommand,DeleteCommand} from '@aws-sdk/lib-dynamodb';
import {presignUpload} from './uploads.mjs';
import {makeAuthenticate} from './auth.mjs';
import {createService} from './service.mjs';
import {HttpError} from './policy.mjs';

const env=process.env,s3=new S3Client({requestChecksumCalculation:'WHEN_REQUIRED'}),db=DynamoDBDocumentClient.from(new DynamoDBClient({}));
const store={
  async createPopup(item){await db.send(new PutCommand({TableName:env.POPUPS_TABLE,Item:item,ConditionExpression:'attribute_not_exists(popup_id)'}));},
  async getPopup(id){return (await db.send(new GetCommand({TableName:env.POPUPS_TABLE,Key:{popup_id:id},ConsistentRead:true}))).Item;},
  async finishPopup(id,origin,hash,state,response,at){await db.send(new UpdateCommand({TableName:env.POPUPS_TABLE,Key:{popup_id:id},UpdateExpression:'SET #response=:response',ConditionExpression:'#origin=:origin AND write_hash=:hash AND #state=:state AND expires_at>:at AND attribute_not_exists(#response)',ExpressionAttributeNames:{'#origin':'origin','#state':'state','#response':'response'},ExpressionAttributeValues:{':origin':origin,':hash':hash,':state':state,':response':response,':at':at}}));},
  async takePopup(id,origin,hash,at){return (await db.send(new DeleteCommand({TableName:env.POPUPS_TABLE,Key:{popup_id:id},ConditionExpression:'#origin=:origin AND read_hash=:hash AND expires_at>:at AND attribute_exists(#response)',ExpressionAttributeNames:{'#origin':'origin','#response':'response'},ExpressionAttributeValues:{':origin':origin,':hash':hash,':at':at},ReturnValues:'ALL_OLD'}))).Attributes;},
  async deletePopup(id,origin,hash,at){await db.send(new DeleteCommand({TableName:env.POPUPS_TABLE,Key:{popup_id:id},ConditionExpression:'#origin=:origin AND read_hash=:hash AND expires_at>:at',ExpressionAttributeNames:{'#origin':'origin'},ExpressionAttributeValues:{':origin':origin,':hash':hash,':at':at}}));},
  async getProfile(sub){return (await db.send(new GetCommand({TableName:env.PROFILES_TABLE,Key:{user_id:sub},ConsistentRead:true}))).Item;},
  async saveProfile(identity,fields){
    // Update selected fields without letting client input replace counters or roles.
    const values={':name':identity.name,':email':identity.email,':institution':fields.institution,':position':fields.position,':software':fields.favorite_software,':research':fields.research_area,':updated':fields.updated_at,':created':fields.created_at};
    const result=await db.send(new UpdateCommand({TableName:env.PROFILES_TABLE,Key:{user_id:identity.sub},UpdateExpression:'SET #name=:name, email=:email, institution=:institution, #position=:position, favorite_software=:software, research_area=:research, updated_at=:updated, created_at=if_not_exists(created_at,:created)',ExpressionAttributeNames:{'#name':'name','#position':'position'},ExpressionAttributeValues:values,ReturnValues:'ALL_NEW'}));
    return result.Attributes;
  },
  async reserveJob(code,sub,at,app='gtotree'){await db.send(new PutCommand({TableName:env.JOBS_TABLE,Item:{result_code:code,user_id:sub,created_at:at,app},ConditionExpression:'attribute_not_exists(result_code)'}));},
  async recordUsage(sub,event){
    await db.send(new PutCommand({TableName:env.EVENTS_TABLE,Item:{user_id:sub,...event,expires_at:Math.floor(Date.now()/1000)+90*86400}}));
    await db.send(new UpdateCommand({TableName:env.PROFILES_TABLE,Key:{user_id:sub},UpdateExpression:'SET last_seen=:at, last_app=:app',ExpressionAttributeValues:{':at':event.at,':app':event.app}}));
  },
  async listProfiles(cursor){
    let key;
    if(cursor){try{key=JSON.parse(Buffer.from(cursor,'base64url').toString());if(typeof key.user_id!=='string'||Object.keys(key).length!==1)throw new Error();}catch{throw new HttpError(400,'invalid_cursor','Invalid cursor.');}}
    const result=await db.send(new ScanCommand({TableName:env.PROFILES_TABLE,Limit:100,ExclusiveStartKey:key}));
    return {users:result.Items??[],cursor:result.LastEvaluatedKey?Buffer.from(JSON.stringify(result.LastEvaluatedKey)).toString('base64url'):null};
  }
};
const objects={
  async codeExists(code,config={inputBucket:env.INPUT_BUCKET,resultsBucket:env.RESULTS_BUCKET}){
    for(const bucket of [config.inputBucket,config.resultsBucket]){
      const r=await s3.send(new ListObjectsV2Command({Bucket:bucket,Prefix:code+'/',MaxKeys:1}));if(r.Contents?.length)return true;
    }return false;
  },
  async presignUpload(code,file,config={inputBucket:env.INPUT_BUCKET}){
    return presignUpload(s3,config.inputBucket,code,file);
  },
  async list(code,config={resultsBucket:env.RESULTS_BUCKET}){
    const files=[];let token;
    do{const result=await s3.send(new ListObjectsV2Command({Bucket:config.resultsBucket,Prefix:code+'/',ContinuationToken:token}));
      for(const file of result.Contents??[])files.push({key:file.Key,size:file.Size,last_modified:file.LastModified?.toISOString()??''});
      token=result.IsTruncated?result.NextContinuationToken:undefined;
    }while(token);return files;
  },
  async presignRead(code,relative,config){return getSignedUrl(s3,new GetObjectCommand({Bucket:config.resultsBucket,Key:code+'/'+relative,ResponseCacheControl:'private, no-store',ResponseContentDisposition:'inline'}),{expiresIn:900});},
  async get(code,relative,config={resultsBucket:env.RESULTS_BUCKET}){const result=await s3.send(new GetObjectCommand({Bucket:config.resultsBucket,Key:code+'/'+relative}));return {body:result.Body,text:()=>result.Body.transformToString()};}
};
const lambda=new LambdaClient({});
const apps=JSON.parse(env.APP_CONFIG||'{}');
async function search(config,body){
  const response=await lambda.send(new InvokeCommand({FunctionName:config.searchFunction,Payload:Buffer.from(JSON.stringify({rawPath:'/',headers:{},requestContext:{http:{method:'POST'}},body:JSON.stringify(body),isBase64Encoded:false}))}));
  if(response.FunctionError)throw new Error('search_failed');
  const result=JSON.parse(Buffer.from(response.Payload).toString());
  if(result.statusCode!==200)throw new HttpError(result.statusCode>=400&&result.statusCode<500?result.statusCode:502,'search_failed','Search could not be completed.');
  const headers=Object.fromEntries(Object.entries(result.headers??{}).map(([k,v])=>[k.toLowerCase(),v]));
  return {status:200,type:headers['content-type']??'application/json',body:result.isBase64Encoded?Buffer.from(result.body,'base64'):result.body};
}
const service=createService({authenticate:makeAuthenticate({poolId:env.USER_POOL_ID,clientIds:env.CLIENT_IDS.split(','),domain:env.COGNITO_DOMAIN}),store,objects,apps,search,origins:env.ALLOWED_ORIGINS.split(',')});
export const handler=awslambda.streamifyResponse(async(event,responseStream)=>{
  const result=await service(event);
  const output=awslambda.HttpResponseStream.from(responseStream,{statusCode:result.status,headers:result.headers});
  await pipeline(result.body instanceof Readable?result.body:Readable.from([result.body??'']),output);
});

