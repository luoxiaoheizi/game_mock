import {api,ApiError,storageKey} from './api';
let video:WechatMiniprogram.RewardedVideoAd|undefined;
let unitId='';
let showing=false;
// 仅 onClose 明确 isEnded === true 才发起领奖；错误、跳过和不明结果都不奖励。
export async function watchRealAd(adUnitId:string) {
  if(showing)throw new ApiError('AD_BUSY','广告正在播放');
  if(!adUnitId||!wx.createRewardedVideoAd)throw new ApiError('ADS_DISABLED','当前设备或广告位暂不可用');
  if(!video||unitId!==adUnitId){video=wx.createRewardedVideoAd({adUnitId});unitId=adUnitId;}
  showing=true;
  await new Promise<void>((resolve,reject)=>{
    const ad=video!;
    let finished=false;
    const cleanup=()=>{finished=true;ad.offClose(close);ad.offError(error);showing=false;};
    const close=(result:{isEnded:boolean})=>{if(finished)return;cleanup();result?.isEnded===true?resolve():reject(new ApiError('AD_INCOMPLETE','本次未完整观看，没有发放奖励'));};
    const error=()=>{if(finished)return;cleanup();reject(new ApiError('AD_LOAD_FAILED','暂时没有可播放的广告，请稍后再试'));};
    ad.onClose(close);ad.onError(error);
    ad.show().catch(()=>{if(!finished)return ad.load().then(()=>{if(!finished)return ad.show();});}).catch(error);
  });
}
export async function claimCompletedAd(sessionId:string) {
  wx.setStorageSync(storageKey('pending-ad'),sessionId);
  try {
    const result=await api('ad.claim',{sessionId,completed:true},sessionId);
    wx.removeStorageSync(storageKey('pending-ad'));return result;
  }catch(e){if(e instanceof ApiError&&!e.retryable&&e.code!=='AD_TOO_EARLY')wx.removeStorageSync(storageKey('pending-ad'));throw e;}
}
