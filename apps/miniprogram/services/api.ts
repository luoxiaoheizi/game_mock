import {config} from '../config';
import {demoCall} from './demo';
import type {Bootstrap,Wallet,Response} from '../../../packages/contracts';
export const storageKey=(name:string)=>`dice-${config.mode}-${config.cloudEnv||'local'}-${name}`;
export const requestId=()=>`req_${Date.now().toString(36)}_${Math.random().toString(36).slice(2,12)}`;
export const session:{snapshot:Bootstrap|null}={snapshot:null};
export class ApiError extends Error {
  constructor(public code:string,message:string,public retryable=false){super(message);}
}
export function acceptWallet(wallet?:Wallet) {
  if(wallet && session.snapshot && wallet.version>=session.snapshot.wallet.version)session.snapshot.wallet=wallet;
}
export async function api(action:string,payload:Record<string,any>={},id=requestId()):Promise<any> {
  let response:Response;
  try {
    const data={action,payload,requestId:id};
    response=config.mode==='demo'?await demoCall(data):(await wx.cloud.callFunction({name:'gameApi',data})).result as Response;
  }catch {throw new ApiError('NETWORK_ERROR','连接失败，请检查网络后重试',true);}
  if(!response?.ok) {
    const error=(response as any)?.error;
    throw new ApiError(error?.code||'BAD_RESPONSE',error?.message||'服务响应异常',error?.retryable??true);
  }
  acceptWallet(response.data?.wallet);
  return response.data;
}
export async function refresh():Promise<Bootstrap> {
  const next=await api('user.bootstrap') as Bootstrap;
  const previous=session.snapshot;
  if(previous && previous.wallet.version>next.wallet.version)next.wallet=previous.wallet;
  if(previous && previous.user.profileVersion>next.user.profileVersion)next.user=previous.user;
  session.snapshot=next;return next;
}
export function toast(error:unknown){wx.showToast({title:error instanceof Error?error.message:String(error),icon:'none',duration:2500});}
export function dateText(time:number){const d=new Date(time);return `${d.getMonth()+1}/${d.getDate()} ${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}`;}
export function balance(){return session.snapshot?.wallet.balance??0;}
export const delay=(ms:number)=>new Promise(resolve=>setTimeout(resolve,ms));
