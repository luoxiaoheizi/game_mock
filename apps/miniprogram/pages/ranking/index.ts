import {api,refresh,toast,storageKey,dateText} from '../../services/api';
import {config} from '../../config';
Page({
  data:{demo:config.mode==='demo',items:[] as any[],myRank:0,invite:'',incoming:'',busy:false,error:'',asOf:'',ready:false},
  async onShow(){const incoming=wx.getStorageSync(storageKey('incoming-invite'))||'';if(incoming)this.setData({incoming});await this.load();},
  async onPullDownRefresh(){try{await this.load();}finally{wx.stopPullDownRefresh();}},
  async load(){try{await refresh();const r=await api('ranking.listFriends');this.setData({items:r.items.map((v:any)=>({...v,initial:[...v.nickname][0]})),myRank:r.items.find((v:any)=>v.isMe)?.rank||0,asOf:dateText(r.asOf),ready:true,error:''});}catch(e){this.setData({error:(e as Error).message});}},
  input(e:any){this.setData({incoming:e.detail.value.trim()});},
  async create(){if(this.data.busy)return;this.setData({busy:true});try{const r=await api('friend.createInvite');this.setData({invite:r.token});}catch(e){toast(e);}finally{this.setData({busy:false});}},
  copy(){if(this.data.invite)wx.setClipboardData({data:this.data.invite});},
  async accept(){if(this.data.busy||!this.data.incoming)return;this.setData({busy:true});try{await api('friend.acceptInvite',{token:this.data.incoming});wx.removeStorageSync(storageKey('incoming-invite'));this.setData({incoming:''});toast('已添加好友');await this.load();}catch(e){toast(e);}finally{this.setData({busy:false});}},
  onShareAppMessage(){return {title:'来骰趣，一起记录手气',path:`/pages/game/index${this.data.invite?'?invite='+encodeURIComponent(this.data.invite):''}`};},
  async remove(e:any){const row=this.data.items.find(v=>v.userId===e.currentTarget.dataset.id);if(!row||row.isMe||this.data.busy)return;const decision=await wx.showModal({title:'移除好友',content:`将 ${row.nickname} 从游戏好友中移除？`});if(!decision.confirm)return;this.setData({busy:true});try{await api('friend.remove',{userId:row.userId});await this.load();}catch(error){toast(error);}finally{this.setData({busy:false});}}
});
