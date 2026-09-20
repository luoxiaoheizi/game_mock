import type {Store,Tx} from './store';
// SDK 使用原生对象 set(value)，不是小程序客户端 SDK 的 set({data:value})。
class CloudTx implements Tx {
  constructor(protected db:any) {}
  async get<T=any>(collection:string,id:string):Promise<T|null> {
    const result=await this.db.collection(collection).doc(id).get();
    if(result.code)throw result;
    const value=Array.isArray(result.data)?result.data[0]:result.data;
    if(!value)return null;
    const {_id,...record}=value;return record as T;
  }
  async set(collection:string,id:string,value:any) {
    const result=await this.db.collection(collection).doc(id).set(value);
    if(result.code)throw result;
  }
}
export class CloudStore extends CloudTx implements Store {
  async transaction<T>(fn:(tx:Tx)=>Promise<T>):Promise<T> {
    return this.db.runTransaction((tx:any)=>fn(new CloudTx(tx)));
  }
  async list(c:string,where:Record<string,unknown>,order:string,limit:number,before?:number) {
    const filter={...where,...(before===undefined?{}:{[order]:this.db.command.lt(before)})};
    const result=await this.db.collection(c).where(filter).orderBy(order,'desc').limit(limit).get();
    if(result.code)throw result;
    return result.data.map(({_id,...v}:any)=>v);
  }
}
