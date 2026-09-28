import {randomUUID} from 'node:crypto';

// Durable host-side jobs: closing the workbench does not lose the result.
export class QuestionJobs {
  constructor(store, complete) { this.store=store; this.complete=complete; this.running=false; }
  async recover() {
    await this.store.mutate(s=>{if(s.questionJob?.status==='running')s.questionJob={...s.questionJob,status:'interrupted',error:'DSH 已重启，上次生成中断。草稿已保留，可重新生成。'};});
  }
  async start({prompt,selection}={}) {
    if(this.running)throw Error('问题正在后台生成，请等待当前任务完成');
    if(typeof prompt!=='string'||!prompt.trim()||prompt.length>16000)throw Error('请填写有效需求（不超过16000字）');
    this.running=true;
    const job={id:randomUUID(),status:'running',startedAt:Date.now()};
    try { await this.store.mutate(s=>{s.questionJob=job;}); }
    catch(e){this.running=false;throw e;}
    this.pending=(async()=>{
      try {
        const text=await this.complete(prompt,selection);
        if(!text?.trim())throw Error('模型未返回问题，请调整需求后重试');
        await this.store.mutate(s=>{s.questionJob={...job,status:'completed',text,finishedAt:new Date().toISOString()};});
      } catch(e) {
        await this.store.mutate(s=>{s.questionJob={...job,status:'failed',error:String(e.message||e),finishedAt:new Date().toISOString()};});
      } finally {this.running=false;}
    })();
    this.pending.catch(e=>console.error('[seo-geo] question job could not be saved:',e.message));
    return job;
  }
}
