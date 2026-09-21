import {api,refresh,session,toast,storageKey} from '../../services/api';
import {config} from '../../config';
import {validNickname} from '../../../../packages/domain';
Page({
  data:{demo:config.mode==='demo',nickname:'',initial:'我',profileVersion:0,editName:'',editing:false,busy:false,haptics:true,wallet:{rounds:0,wins:0,totalStake:0,totalPayout:0},error:'',formError:'',nameFocused:false,loading:false,ready:false},
  async onShow(){await this.load();},
  async onPullDownRefresh(){try{await this.load();}finally{wx.stopPullDownRefresh();}},
  async load(){this.setData({loading:true});try{const s=await refresh();this.setData({nickname:s.user.nickname,initial:[...s.user.nickname][0],profileVersion:s.user.profileVersion,wallet:s.wallet,haptics:wx.getStorageSync(storageKey('haptics'))!==false,ready:true,error:''});}catch(e){this.setData({error:(e as Error).message});}finally{this.setData({loading:false});}},
  edit(){if(!this.data.ready)return;this.setData({editing:true,editName:this.data.nickname,formError:'',nameFocused:true});},
  input(e:any){this.setData({editName:e.detail.value,formError:''});},
  close(){if(!this.data.busy)this.setData({editing:false});},
  async save(){if(this.data.busy)return;try{const nickname=validNickname(this.data.editName);this.setData({busy:true,formError:''});const r=await api('user.updateNickname',{nickname,profileVersion:this.data.profileVersion});if(session.snapshot)session.snapshot.user=r.user;this.setData({editing:false,nameFocused:false});await this.load();toast('昵称已更新');}catch(e){this.setData({formError:(e as Error).message,nameFocused:true});await this.load();}finally{this.setData({busy:false});}},
  toggle(e:any){const haptics=!!e.detail.value;wx.setStorageSync(storageKey('haptics'),haptics);this.setData({haptics});},
  wallet(){wx.switchTab({url:'/pages/wallet/index'});},
  rules(){wx.showModal({title:'关于骰趣',showCancel:false,content:'三颗骰子，每局独立开奖。所有积分仅供游戏体验，不可充值、提现、兑换或转让。大小遇豹子不中奖，其他玩法按各自规则独立结算。净赢倍数不包含退回本金。每日签到赠送 500 积分，完整观看视频奖励 200 积分，每天最多 3 次。'});},
  noop(){}
});
