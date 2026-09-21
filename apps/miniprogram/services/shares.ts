import {api,requestId,storageKey,toast} from './api';

interface PendingShare {id:string;confirmed:boolean}
const key=()=>storageKey('pending-share');
export const pendingShare=():PendingShare|undefined=>wx.getStorageSync(key())||undefined;

export function beginShare(invite='') {
  // 待处理的同一笔分享复用标识；取消或领取完成后才能开始下一笔。
  const pending=pendingShare()??{id:requestId(),confirmed:false};
  wx.setStorageSync(key(),pending);
  const content={title:'来骰趣，一起记录手气',path:`/pages/game/index${invite?'?invite='+encodeURIComponent(invite):''}`};
  const promise=api('share.start',{},pending.id).then(()=>content).catch(e=>{toast(e);return content;});
  return {...content,promise};
}

export async function confirmShared() {
  const pending=pendingShare();if(!pending)return;
  wx.setStorageSync(key(),{...pending,confirmed:true});
  // 开始请求可能丢失；沿用同一 ID 补齐记录，不生成第二笔奖励。
  await api('share.start',{},pending.id);
  const result=await api('share.claim',{sessionId:pending.id,confirmed:true},pending.id);
  if(pendingShare()?.id===pending.id)wx.removeStorageSync(key());
  return result;
}

export function cancelShare() {
  // 已提交的确认必须先查清到账结果，不能丢弃标识后重新领奖。
  if(!pendingShare()?.confirmed)wx.removeStorageSync(key());
}
