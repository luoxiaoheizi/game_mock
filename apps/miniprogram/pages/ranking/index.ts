import {api,refresh,toast,storageKey,dateText} from '../../services/api';
import {config} from '../../config';
Page({
  data:{demo:config.mode==='demo',items:[] as any[],myRank:0,invite:'',incoming:'',busy:false,loading:false,managing:false,error:'',inviteError:'',asOf:'',ready:false},
  async onShow(){const incoming=wx.getStorageSync(storageKey('incoming-invite'))||'';if(incoming)this.setData({incoming});await this.load();},
  async onPullDownRefresh(){try{await this.load();}finally{wx.stopPullDownRefresh();}},
  async load(){this.setData({loading:true});try{await refresh();const r=await api('ranking.listFriends');this.setData({items:r.items.map((v:any)=>({...v,initial:[...v.nickname][0]})),myRank:r.items.find((v:any)=>v.isMe)?.rank||0,asOf:dateText(r.asOf),ready:true,error:''});}catch(e){this.setData({error:(e as Error).message});}finally{this.setData({loading:false});}},
  input(e:any){this.setData({incoming:e.detail.value.trim(),inviteError:''});},
  manage(){this.setData({managing:!this.data.managing});},
  async create(){if(this.data.busy)return;this.setData({busy:true});try{const r=await api('friend.createInvite');this.setData({invite:r.token});}catch(e){toast(e);}finally{this.setData({busy:false});}},
  copy(){if(this.data.invite)wx.setClipboardData({data:this.data.invite});},
  async accept(){if(this.data.busy||!this.data.incoming)return;this.setData({busy:true,inviteError:''});try{await api('friend.acceptInvite',{token:this.data.incoming});wx.removeStorageSync(storageKey('incoming-invite'));this.setData({incoming:''});toast('已添加好友');await this.load();}catch(e){this.setData({inviteError:(e as Error).message});}finally{this.setData({busy:false});}},
  onShareAppMessage(){return {title:'来骰趣，一起记录手气',path:`/pages/game/index${this.data.invite?'?invite='+encodeURIComponent(this.data.invite):''}`};},
  async remove(e:any){const row=this.data.items.find(v=>v.userId===e.currentTarget.dataset.id);if(!row||row.isMe||this.data.busy)return;const decision=await wx.showModal({title:'移除好友',content:`将 ${row.nickname} 从游戏好友中移除？移除后，彼此的手气榜不再显示对方。`,confirmText:'移除好友',cancelText:'保留好友'});if(!decision.confirm)return;this.setData({busy:true});try{await api('friend.remove',{userId:row.userId});await this.load();}catch(error){toast(error);}finally{this.setData({busy:false});}}
});
