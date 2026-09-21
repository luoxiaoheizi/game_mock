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
  rules(){wx.showModal({title:'关于骰趣',showCancel:false,content:'三颗骰子，每局独立开奖。所有积分仅供游戏体验，不可充值、提现、兑换或转让。大小遇豹子不中奖，其他玩法按各自规则独立结算。净赢倍数不包含退回本金。新用户赠送 500 积分；签到按连续天数发奖，完整奖励表见钱包，断签从第 1 天重新计算。完整观看视频每天最多 3 次，依次奖励 200、500、1000 分。每次分享给好友或群聊后，在钱包自行确认领取 100 分，不限次数。'});},
  noop(){}
});
