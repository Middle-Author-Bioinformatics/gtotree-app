import {pipeline} from 'node:stream/promises';
import {Readable} from 'node:stream';
import {S3Client,ListObjectsV2Command,GetObjectCommand} from '@aws-sdk/client-s3';
import {DynamoDBClient} from '@aws-sdk/client-dynamodb';
import {DynamoDBDocumentClient,GetCommand,PutCommand,ScanCommand,UpdateCommand} from '@aws-sdk/lib-dynamodb';
import {presignUpload} from './uploads.mjs';
import {makeAuthenticate} from './auth.mjs';
import {createService} from './service.mjs';
import {HttpError} from './policy.mjs';

const env=process.env,s3=new S3Client({requestChecksumCalculation:'WHEN_REQUIRED'}),db=DynamoDBDocumentClient.from(new DynamoDBClient({}));
const store={
  async getProfile(sub){return (await db.send(new GetCommand({TableName:env.PROFILES_TABLE,Key:{user_id:sub},ConsistentRead:true}))).Item;},
  async saveProfile(identity,fields){
    // Update selected fields without letting client input replace counters or roles.
    const values={':name':identity.name,':email':identity.email,':institution':fields.institution,':position':fields.position,':software':fields.favorite_software,':research':fields.research_area,':updated':fields.updated_at,':created':fields.created_at};
    const result=await db.send(new UpdateCommand({TableName:env.PROFILES_TABLE,Key:{user_id:identity.sub},UpdateExpression:'SET #name=:name, email=:email, institution=:institution, #position=:position, favorite_software=:software, research_area=:research, updated_at=:updated, created_at=if_not_exists(created_at,:created)',ExpressionAttributeNames:{'#name':'name','#position':'position'},ExpressionAttributeValues:values,ReturnValues:'ALL_NEW'}));
    return result.Attributes;
  },
  async reserveJob(code,sub,at){await db.send(new PutCommand({TableName:env.JOBS_TABLE,Item:{result_code:code,user_id:sub,created_at:at,app:'gtotree'},ConditionExpression:'attribute_not_exists(result_code)'}));},
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
  async codeExists(code){
    for(const bucket of [env.INPUT_BUCKET,env.RESULTS_BUCKET]){
      const r=await s3.send(new ListObjectsV2Command({Bucket:bucket,Prefix:code+'/',MaxKeys:1}));if(r.Contents?.length)return true;
    }return false;
  },
  async presignUpload(code,file){
    return presignUpload(s3,env.INPUT_BUCKET,code,file);
  },
  async list(code){
    const files=[];let token;
    do{const result=await s3.send(new ListObjectsV2Command({Bucket:env.RESULTS_BUCKET,Prefix:code+'/',ContinuationToken:token}));
      for(const file of result.Contents??[])files.push({key:file.Key,size:file.Size,last_modified:file.LastModified?.toISOString()??''});
      token=result.IsTruncated?result.NextContinuationToken:undefined;
    }while(token);return files;
  },
  async get(code,relative){const result=await s3.send(new GetObjectCommand({Bucket:env.RESULTS_BUCKET,Key:code+'/'+relative}));return {body:result.Body,text:()=>result.Body.transformToString()};}
};
const service=createService({authenticate:makeAuthenticate({poolId:env.USER_POOL_ID,clientIds:env.CLIENT_IDS.split(','),domain:env.COGNITO_DOMAIN}),store,objects,origins:env.ALLOWED_ORIGINS.split(',')});
export const handler=awslambda.streamifyResponse(async(event,responseStream)=>{
  const result=await service(event);
  const output=awslambda.HttpResponseStream.from(responseStream,{statusCode:result.status,headers:result.headers});
  await pipeline(result.body instanceof Readable?result.body:Readable.from([result.body??'']),output);
});
