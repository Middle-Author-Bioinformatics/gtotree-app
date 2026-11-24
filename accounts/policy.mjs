export class HttpError extends Error {
  constructor(status, code, message) { super(message); this.status=status; this.code=code; }
}
export const POSITIONS=['PI','Postdoc','Student','Lab manager','Bioinformatician','Industry scientist','Other'];
export const CODE=/^[A-Za-z0-9_-]{1,64}$/;
const SCIENTIFIC=new Set(['GToTree_output.tre','Aligned_SCGs.faa','Genomes_summary_info.tsv','SCG_hit_counts.tsv','selected-genomes.json','Partitions.txt','citations.txt','iToL-colors.txt']);
export function scientificFile(path) {
  if(path==='gtotree-report.html'||path==='report.html')return true;
  const parts=path.split('/');
  return parts.length===1&&SCIENTIFIC.has(parts[0])||parts.length===2&&parts[0]==='output'&&SCIENTIFIC.has(parts[1]);
}
function text(value, max, required=false) {
  if(typeof value!=='string'||value.length>max||/[\x00-\x1f\x7f]/.test(value))throw new HttpError(400,'invalid_profile','Invalid profile field.');
  const result=value.trim();
  if(required&&!result)throw new HttpError(400,'incomplete_profile','Complete all required profile fields.');
  return result;
}
export function profileFields(body) {
  const institution=text(body.institution,200,true),position=text(body.position,60,true);
  if(!POSITIONS.includes(position))throw new HttpError(400,'invalid_profile','Choose a position.');
  return {institution,position,favorite_software:text(body.favorite_software??'',300),research_area:text(body.research_area??'',500)};
}
export function completeProfile(profile, identity) {
  if(!profile||profile.email!==identity.email||!identity.name?.trim()||identity.email_verified!==true)return false;
  try {profileFields(profile);return true;}catch{return false;}
}
export function uploadFiles(body) {
  if(typeof body.slug!=='string'||!CODE.test(body.slug))throw new HttpError(400,'invalid_upload','Invalid result code.');
  if(!Array.isArray(body.files)||body.files.length<1||body.files.length>200)throw new HttpError(400,'invalid_upload','Invalid file list.');
  let bytes=0;const seen=new Set();
  const files=body.files.map(file=>{
    if(!file||typeof file.name!=='string'||!/^[A-Za-z0-9._-]{1,180}$/.test(file.name)||file.name.includes('..')||seen.has(file.name)||!Number.isSafeInteger(file.size)||file.size<0)throw new HttpError(400,'invalid_upload','Invalid file name or size.');
    seen.add(file.name);bytes+=file.size;
    if(bytes>100*1024*1024)throw new HttpError(400,'invalid_upload','Upload limit is 100 MB.');
    return {name:file.name,size:file.size,content_type:'text/plain'};
  });
  if(!seen.has('form-data.txt'))throw new HttpError(400,'invalid_upload','The submission manifest is missing.');
  return files;
}
