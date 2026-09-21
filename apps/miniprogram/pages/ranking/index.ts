import {api,refresh,toast,storageKey,dateText} from '../../services/api';
import {config} from '../../config';
import {beginShare,pendingShare} from '../../services/shares';
import type {RankingBoard,RankingRow,FriendRankings} from '../../../../packages/contracts';
type DisplayRow=RankingRow&{initial:string;metric:string};
Page({
  data:{demo:config.mode==='demo',board:'winRate' as RankingBoard,boards:{winRate:[],turnover:[]} as FriendRankings['boards'],items:[] as DisplayRow[],myRank:0,rankedCount:0,invite:'',incoming:'',busy:false,loading:false,managing:false,error:'',inviteError:'',asOf:'',ready:false,pendingShare:false},
  loadSequence:0,
  onLoad(){const board=wx.getStorageSync(storageKey('ranking-board'));if(board==='winRate'||board==='turnover')this.setData({board});},
  async onShow(){this.setData({pendingShare:!!pendingShare()});const incoming=wx.getStorageSync(storageKey('incoming-invite'))||'';if(incoming)this.setData({incoming});await this.load();},
  async onPullDownRefresh(){try{await this.load();}finally{wx.stopPullDownRefresh();}},
  async load(){
    const sequence=++this.loadSequence;this.setData({loading:true});
    try{await refresh();const r=await api('ranking.listFriends') as FriendRankings;if(sequence!==this.loadSequence)return;this.setData({boards:r.boards,asOf:dateText(r.asOf),ready:true,error:''});this.renderBoard();}
    catch(e){if(sequence===this.loadSequence)this.setData({error:(e as Error).message});}
    finally{if(sequence===this.loadSequence)this.setData({loading:false});}
  },
  changeBoard(e:any){const board=e.currentTarget.dataset.board;if(board!=='winRate'&&board!=='turnover')return;this.setData({board});wx.setStorageSync(storageKey('ranking-board'),board);this.renderBoard();},
  renderBoard(){const items=this.data.boards[this.data.board].map(v=>({...v,initial:[...v.nickname][0],metric:this.data.board==='winRate'?(v.winRate===null?'—':`${(v.winRate*100).toFixed(1)}%`):String(v.totalStake)}));this.setData({items,myRank:items.find(v=>v.isMe)?.rank||0,rankedCount:items.filter(v=>v.rank!==null).length});},
  input(e:any){this.setData({incoming:e.detail.value.trim(),inviteError:''});},
  manage(){this.setData({managing:!this.data.managing});},
  async create(){if(this.data.busy)return;this.setData({busy:true});try{const r=await api('friend.createInvite');this.setData({invite:r.token});}catch(e){toast(e);}finally{this.setData({busy:false});}},
  copy(){if(this.data.invite)wx.setClipboardData({data:this.data.invite});},
  async accept(){if(this.data.busy||!this.data.incoming)return;this.setData({busy:true,inviteError:''});try{await api('friend.acceptInvite',{token:this.data.incoming});wx.removeStorageSync(storageKey('incoming-invite'));this.setData({incoming:''});toast('已添加好友');await this.load();}catch(e){this.setData({inviteError:(e as Error).message});}finally{this.setData({busy:false});}},
  onShareAppMessage(){const result=beginShare(this.data.invite);this.setData({pendingShare:true});return result;},
  rewardWallet(){wx.switchTab({url:'/pages/wallet/index'});},
  async remove(e:any){const row=this.data.items.find(v=>v.userId===e.currentTarget.dataset.id);if(!row||row.isMe||this.data.busy)return;const decision=await wx.showModal({title:'移除好友',content:`将 ${row.nickname} 从游戏好友中移除？移除后，彼此的手气榜不再显示对方。`,confirmText:'移除好友',cancelText:'保留好友'});if(!decision.confirm)return;this.setData({busy:true});try{await api('friend.remove',{userId:row.userId});await this.load();}catch(error){toast(error);}finally{this.setData({busy:false});}}
});
