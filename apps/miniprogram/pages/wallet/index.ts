import {api,refresh,toast,balance,requestId,storageKey,dateText} from '../../services/api';
import {watchRealAd,claimCompletedAd} from '../../services/ads';
import {config} from '../../config';
import {RULES} from '../../../../packages/domain';
const titles:Record<string,string>={WELCOME:'初次见面礼',BET_DEBIT:'骰宝投入',BET_PAYOUT:'骰宝返还',SIGN_IN:'每日签到',AD_REWARD:'观看广告奖励'};
Page({
  data:{demo:config.mode==='demo',balance:0,rewards:{signed:false,streak:0,adCount:0,adEnabled:false,adMinSeconds:6,adUnitId:''},rules:RULES,ledgers:[] as any[],cursor:null as number|null,busy:false,loading:false,loadingMore:false,showAd:false,remaining:6,adSession:'',pendingAd:false,error:'',ready:false},
  timer:undefined as ReturnType<typeof setInterval>|undefined,
  async onShow(){await this.load();},
  onHide(){if(this.data.showAd)this.cancelDemo();},
  onUnload(){if(this.timer)clearInterval(this.timer);},
  async onPullDownRefresh(){try{await this.load();}finally{wx.stopPullDownRefresh();}},
  async load(){this.setData({loading:true});try{const s=await refresh();const l=await api('wallet.listLedgers');this.setData({balance:balance(),rewards:s.rewards,ledgers:this.rows(l.items),cursor:l.nextCursor,pendingAd:!!wx.getStorageSync(storageKey('pending-ad')),ready:true,error:''});}catch(e){this.setData({error:(e as Error).message});}finally{this.setData({loading:false});}},
  rows(items:any[]){return items.map(v=>({...v,title:titles[v.kind]||v.kind,time:dateText(v.createdAt),deltaText:v.delta>0?`+${v.delta}`:String(v.delta)}));},
  async more(){if(!this.data.cursor||this.data.loadingMore)return;this.setData({loadingMore:true});try{const l=await api('wallet.listLedgers',{before:this.data.cursor});this.setData({ledgers:[...this.data.ledgers,...this.rows(l.items)],cursor:l.nextCursor});}catch(e){toast(e);}finally{this.setData({loadingMore:false});}},
  async sign(){if(this.data.busy)return;this.setData({busy:true});try{const r=await api('wallet.claimDaily');toast(r.alreadyClaimed?'今天已经签到过啦':`签到成功 +${r.amount} 积分`);await this.load();}catch(e){toast(e);}finally{this.setData({busy:false});}},
  async watch(){
    if(this.data.busy)return;this.setData({busy:true});
    try {
      const s=await api('ad.start',{},requestId());
      this.setData({adSession:s.sessionId});
      if(this.data.demo){
        const end=Date.now()+this.data.rewards.adMinSeconds*1000;
        this.setData({showAd:true,remaining:this.data.rewards.adMinSeconds});
        this.timer=setInterval(()=>{const remaining=Math.max(0,Math.ceil((end-Date.now())/1000));this.setData({remaining});if(!remaining&&this.timer){clearInterval(this.timer);this.timer=undefined;}},200);
        return;
      }
      await watchRealAd(this.data.rewards.adUnitId);
      await this.claim(s.sessionId);
    }catch(e){toast(e);}finally{if(!this.data.showAd)this.setData({busy:false});}
  },
  cancelDemo(){if(this.timer)clearInterval(this.timer);this.timer=undefined;this.setData({showAd:false,busy:false,adSession:''});},
  async completeDemo(){if(this.data.remaining>0)return;const sid=this.data.adSession;this.setData({showAd:false});try{await this.claim(sid);}catch(e){toast(e);}finally{this.setData({busy:false});}},
  async claim(sid:string){try{const r=await claimCompletedAd(sid);this.setData({balance:balance()});toast(`已到账 +${r.amount} 积分`);await this.load();}finally{this.setData({pendingAd:!!wx.getStorageSync(storageKey('pending-ad'))});}},
  async recoverAd(){if(this.data.busy)return;const sid=wx.getStorageSync(storageKey('pending-ad'));if(!sid)return;this.setData({busy:true});try{await this.claim(sid);}catch(e){toast(e);}finally{this.setData({busy:false});}},
  noop(){}
});
