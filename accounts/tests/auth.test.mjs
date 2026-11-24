import {test} from 'node:test';
import assert from 'node:assert/strict';
import {generateKeyPairSync,sign} from 'node:crypto';
import {CognitoJwtVerifier} from 'aws-jwt-verify';
import {makeAuthenticate} from '../auth.mjs';

const pool='us-east-2_Test123',client='exampleclient';
const {privateKey,publicKey}=generateKeyPairSync('rsa',{modulusLength:2048});
const key={...publicKey.export({format:'jwk'}),kid:'test-key',alg:'RS256',use:'sig'};
const verifier=CognitoJwtVerifier.create({userPoolId:pool,clientId:[client],tokenUse:'access',scope:'openid'});verifier.cacheJwks({keys:[key]});
const defaults={iss:'https://cognito-idp.us-east-2.amazonaws.com/'+pool,sub:'user-123',token_use:'access',client_id:client,scope:'openid email profile',iat:Math.floor(Date.now()/1000)-1,exp:Math.floor(Date.now()/1000)+300};
function jwt(changes={},keyToUse=privateKey){const header=Buffer.from(JSON.stringify({alg:'RS256',kid:'test-key'})).toString('base64url');const body=Buffer.from(JSON.stringify({...defaults,...changes})).toString('base64url');const data=header+'.'+body;return data+'.'+sign('RSA-SHA256',Buffer.from(data),keyToUse).toString('base64url');}
const identity={sub:'user-123',email:'scientist@example.org',name:'Scientist',email_verified:true};
function authenticate(info=identity){return makeAuthenticate({poolId:pool,clientIds:[client],domain:'https://auth.example',verifier,fetchImpl:async()=>new Response(JSON.stringify(info))});}
test('real RSA-signed Cognito access token and verified userInfo identify account',async()=>{
  const user=await authenticate()({authorization:'Bearer '+jwt()});assert.equal(user.sub,'user-123');assert.equal(user.admin,false);
  assert.equal((await authenticate()({authorization:'Bearer '+jwt({'cognito:groups':['mab-admin']})})).admin,true);
});
test('expired/wrong-client/wrong-issuer/ID/wrong-scope and tampered tokens are rejected',async()=>{
  for(const changes of [{exp:1},{client_id:'different'},{iss:'https://evil.example'},{token_use:'id',aud:client},{scope:'email profile'}])await assert.rejects(()=>authenticate()({authorization:'Bearer '+jwt(changes)}),e=>e.status===401);
  const other=generateKeyPairSync('rsa',{modulusLength:2048});await assert.rejects(()=>authenticate()({authorization:'Bearer '+jwt({},other.privateKey)}),e=>e.status===401);
});
test('unverified email or userInfo-sub mismatch cannot gain access',async()=>{
  await assert.rejects(()=>authenticate({...identity,email_verified:false})({authorization:'Bearer '+jwt()}),e=>e.status===403);
  await assert.rejects(()=>authenticate({...identity,sub:'other-user'})({authorization:'Bearer '+jwt()}),e=>e.status===401);
  await assert.rejects(()=>authenticate()({}),e=>e.status===401);
});
