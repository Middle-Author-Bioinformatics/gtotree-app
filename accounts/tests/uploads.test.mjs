import {test} from 'node:test';
import assert from 'node:assert/strict';
import {S3Client} from '@aws-sdk/client-s3';
import {presignUpload} from '../uploads.mjs';
test('presigned PUT binds file length/type and does not sign an empty-body checksum',async()=>{
  const s3=new S3Client({region:'us-east-2',credentials:{accessKeyId:'TESTKEY',secretAccessKey:'TESTSECRET'},requestChecksumCalculation:'WHEN_REQUIRED'});
  const result=await presignUpload(s3,'input-bucket','Example123',{name:'mine.fna',size:100,content_type:'text/plain'});
  const url=new URL(result.url),headers=url.searchParams.get('X-Amz-SignedHeaders');
  assert(headers.includes('content-length'));assert(headers.includes('content-type'));
  assert.equal(url.pathname,'/Example123/mine.fna');assert.equal(url.searchParams.has('x-amz-checksum-crc32'),false);
  assert.equal(url.searchParams.get('X-Amz-Expires'),'900');
});
