import {CognitoJwtVerifier} from 'aws-jwt-verify';
import {HttpError} from './policy.mjs';

export function makeAuthenticate({poolId,clientIds,domain,fetchImpl=fetch,verifier}) {
  const verify=verifier??CognitoJwtVerifier.create({userPoolId:poolId,clientId:clientIds,tokenUse:'access',scope:'openid'});
  return async headers=>{
    const value=headers.authorization??headers.Authorization??'';
    if(!/^Bearer [^\s]+$/.test(value))throw new HttpError(401,'sign_in_required','Sign in to your MAB account.');
    const token=value.slice(7);let claims;
    try {claims=await verify.verify(token);}catch{throw new HttpError(401,'sign_in_required','Your session expired. Sign in again.');}
    let response;
    try {response=await fetchImpl(domain+'/oauth2/userInfo',{headers:{Authorization:'Bearer '+token},signal:AbortSignal.timeout(8000)});}catch{throw new HttpError(503,'identity_unavailable','Account verification is temporarily unavailable.');}
    if(!response.ok)throw new HttpError(response.status>=500?503:401,'sign_in_required','Sign in again.');
    const identity=await response.json();
    if(identity.sub!==claims.sub)throw new HttpError(401,'invalid_identity','Invalid account identity.');
    if(identity.email_verified!==true&&identity.email_verified!=='true')throw new HttpError(403,'email_unverified','Verify your email before using MAB apps.');
    if(typeof identity.email!=='string'||!identity.email.includes('@')||typeof identity.name!=='string'||!identity.name.trim())throw new HttpError(403,'identity_incomplete','Your account needs a full name and verified email.');
    return {sub:claims.sub,email:identity.email,name:identity.name,email_verified:true,admin:Array.isArray(claims['cognito:groups'])&&claims['cognito:groups'].includes('mab-admin')};
  };
}
