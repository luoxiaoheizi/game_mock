export interface Tx {
  get<T=any>(collection:string,id:string):Promise<T|null>;
  set(collection:string,id:string,value:any):Promise<void>;
}
export interface Store extends Tx {
  transaction<T>(fn:(tx:Tx)=>Promise<T>):Promise<T>;
  list(collection:string,where:Record<string,unknown>,order:string,limit:number,before?:number):Promise<any[]>;
}
export type Snapshot = Record<string,Record<string,any>>;
const clone = <T>(v:T):T=>JSON.parse(JSON.stringify(v));
// 本地演示与自动测试适配器。串行、复制后提交，模拟原子性；正式环境使用云事务。
export class MemoryStore implements Store {
  private queue:Promise<unknown>=Promise.resolve();
  constructor(public data:Snapshot={},private persist?:(snapshot:Snapshot)=>void) {}
  async get<T=any>(c:string,id:string):Promise<T|null> {return clone(this.data[c]?.[id]??null);}
  async set(c:string,id:string,v:any) { (this.data[c]??={})[id]=clone(v); }
  async transaction<T>(fn:(tx:Tx)=>Promise<T>):Promise<T> {
    const job=this.queue.then(async()=>{
      const staged=new MemoryStore(clone(this.data));
      const result=await fn(staged);
      this.persist?.(staged.data); // 持久化失败时不提交内存状态。
      this.data=staged.data;
      return result;
    });
    this.queue=job.catch(()=>{}); return job;
  }
  async list(c:string,where:Record<string,unknown>,order:string,limit:number,before?:number) {
    return Object.values(this.data[c]??{}).filter(v=>Object.entries(where).every(([k,w])=>v[k]===w) && (before===undefined||v[order]<before)).sort((a,b)=>b[order]-a[order]).slice(0,limit).map(clone);
  }
}
