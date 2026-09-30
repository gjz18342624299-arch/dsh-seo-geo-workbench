export class SeoJobs {
 constructor(store,complete){this.store=store;this.complete=complete;this.active=new Map();}
 async recover(){if(!(await this.store.read()).reports?.some(r=>r.analysisJob?.status==='running'))return;await this.store.mutate(s=>{for(const r of s.reports||[])if(r.analysisJob?.status==='running')r.analysisJob={...r.analysisJob,status:'failed',error:'应用重启导致分析中断，请重试。'};});}
 async status(id){const base=await this.store.seoSaved(id);return {job:base.analysisJob||null,report:base.analysisJob?.resultId?await this.store.seoSaved(base.analysisJob.resultId):base};}
 async start({id,selection}){
  if(this.active.has(id))return this.status(id);
  const base=await this.store.seoSaved(id);if(base.narrative)return {job:{status:'completed'},report:base};
  this.active.set(id,true);
  try{await this.store.mutate(s=>{s.reports.find(r=>r.id===id).analysisJob={status:'running',startedAt:Date.now()};});}catch(e){this.active.delete(id);throw e;}
  const pending=(async()=>{try{const text=await this.complete(base.analysisPrompt,selection);const result=await this.store.seoNarrative({id,text});await this.store.mutate(s=>{s.reports.find(r=>r.id===id).analysisJob={status:'completed',resultId:result.id};});}catch(e){await this.store.mutate(s=>{s.reports.find(r=>r.id===id).analysisJob={status:'failed',error:String(e.message||e)};});}finally{this.active.delete(id);}})();
  this.pending=pending;pending.catch(e=>console.error('[seo-geo] SEO analysis persistence failed:',e.message));return this.status(id);
 }
}
