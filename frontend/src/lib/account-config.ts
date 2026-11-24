const env=import.meta.env;
export const ACCOUNT_ENABLED=env.VITE_MAB_AUTH_ENABLED==='true';
export const ACCOUNT_API=(env.VITE_MAB_API_BASE||'').replace(/\/+$/,'');
export const ACCOUNT_POOL=env.VITE_MAB_USER_POOL_ID||'us-east-2_VzCBot5S3';
export const ACCOUNT_CLIENT=env.VITE_MAB_CLIENT_ID||'6k3o2d5gtns534fcuqdkqgbto8';
export const ACCOUNT_DOMAIN=(env.VITE_MAB_COGNITO_DOMAIN||'https://us-east-2vzcbot5s3.auth.us-east-2.amazoncognito.com').replace(/\/+$/,'');
export const POSITIONS=['PI','Postdoc','Student','Lab manager','Bioinformatician','Industry scientist','Other'];
export function validApiBase(value:string):boolean {
  try{const url=new URL(value);return !url.username&&!url.password&&!url.search&&!url.hash&&(url.protocol==='https:'||url.protocol==='http:'&&['localhost','127.0.0.1'].includes(url.hostname));}catch{return false;}
}
export function safeReturnTo(value:unknown,origin=window.location.origin):string {
  if(typeof value!=='string')return '/';
  try{const url=new URL(value,origin);if(url.origin!==origin)return '/';url.searchParams.delete('code');url.searchParams.delete('state');url.searchParams.delete('error');url.searchParams.delete('error_description');return url.pathname+url.search+url.hash;}catch{return '/';}
}
