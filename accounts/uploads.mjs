import {PutObjectCommand} from '@aws-sdk/client-s3';
import {getSignedUrl} from '@aws-sdk/s3-request-presigner';
export async function presignUpload(s3,bucket,code,file){
  const command=new PutObjectCommand({Bucket:bucket,Key:code+'/'+file.name,ContentType:file.content_type,ContentLength:file.size});
  return {file_name:file.name,url:await getSignedUrl(s3,command,{expiresIn:900,signableHeaders:new Set(['content-length','content-type'])}),headers:{'Content-Type':file.content_type}};
}
