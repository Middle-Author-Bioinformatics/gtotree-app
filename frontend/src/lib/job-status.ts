export interface JobState { state: "running" | "complete" | "failed"; has_report?: boolean; error?: string }
export function validateJobState(data: unknown): JobState {
  const value=data as Partial<JobState>|null;
  if(!value||!["running","complete","failed"].includes(value.state||""))throw new Error("The worker returned an invalid job status.");
  return {state:value.state!,has_report:value.has_report,error:typeof value.error==="string"?value.error.slice(0,1000):undefined};
}
export function finalState(derived: "pending"|"running"|"succeeded"|"failed", reportPresent:boolean, job:JobState|null) {
  if(!job)return derived; // Older published reports remain accessible.
  if(job.state==="failed")return "failed";
  if(job.state==="running")return "running";
  if(job.has_report===false)return "failed";
  // A listing may have been fetched just before the final report was uploaded.
  return reportPresent?"succeeded":"running";
}
