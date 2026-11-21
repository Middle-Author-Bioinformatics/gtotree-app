import { useRef, useState } from "react";

export function DashboardRequest({reportCode}: {reportCode:string}) {
  const dialog=useRef<HTMLDialogElement>(null);
  const [name,setName]=useState(""),[email,setEmail]=useState(""),[lab,setLab]=useState(""),[message,setMessage]=useState("");
  const destination=(import.meta.env.VITE_DASHBOARD_CONTACT_EMAIL as string|undefined)||"ark@midauthorbio.com";
  const safeDestination=/^[^\s@?&#]+@[^\s@?&#]+\.[^\s@?&#]+$/.test(destination)?destination:"ark@midauthorbio.com";
  function prepare(event:React.FormEvent<HTMLFormElement>){event.preventDefault();
    const body=`Name: ${name}\nEmail: ${email}\nLab / institution: ${lab}\nGToTree result code: ${reportCode}\n\nWhat I would like in my lab dashboard:\n${message}\n\nOnly this report reference is included; no genome files are attached.`;
    window.location.href=`mailto:${safeDestination}?subject=${encodeURIComponent("Dashboard request — GToTree "+reportCode)}&body=${encodeURIComponent(body)}`;
  }
  return <>
    <section className="dashboard-cta"><div><h2>Make this dashboard work for your lab</h2><p>Add your experimental metadata, custom comparisons, and future datasets.</p></div><button className="btn-primary" onClick={()=>dialog.current?.showModal()}>Request a dashboard for my lab</button></section>
    <dialog ref={dialog} className="dashboard-request"><form onSubmit={prepare} className="space-y-4">
      <div className="flex items-center justify-between gap-4"><h2 className="text-xl font-semibold">A dashboard for your lab</h2><button type="button" className="btn-ghost" onClick={()=>dialog.current?.close()}>Close</button></div>
      <p className="text-sm text-fg-muted">Tell us what would make this report useful across your lab’s projects.</p>
      <label className="label">Name<input required maxLength={150} className="field mt-1" value={name} onChange={e=>setName(e.target.value)} autoComplete="name" /></label>
      <label className="label">Email<input required type="email" maxLength={254} className="field mt-1" value={email} onChange={e=>setEmail(e.target.value)} autoComplete="email" /></label>
      <label className="label">Lab / institution<input required maxLength={200} className="field mt-1" value={lab} onChange={e=>setLab(e.target.value)} autoComplete="organization" /></label>
      <label className="label">What would you like to add?<textarea required maxLength={4000} rows={4} className="field mt-1" value={message} onChange={e=>setMessage(e.target.value)} /></label>
      <p className="text-xs text-fg-muted">This opens your email app with the result code {reportCode}. Send that email to complete your request. Nothing is submitted or added to a mailing list automatically.</p>
      <button className="btn-primary" type="submit">Prepare email request</button><p className="text-xs">You can also email <a className="underline" href={`mailto:${safeDestination}`}>{safeDestination}</a> with this result code.</p>
    </form></dialog>
  </>;
}
