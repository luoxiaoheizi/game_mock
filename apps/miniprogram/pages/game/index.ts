import {api,refresh,toast,balance,session,requestId,storageKey,delay,ApiError,dateText} from '../../services/api';
import {config} from '../../config';
import {RULES,label,type Bet,type BetType} from '../../../../packages/domain';
type Cell={key:string;type:BetType;value?:number;title:string;odds:string;stake:number};
function cells():Cell[] {
  return [
    {type:'SMALL',title:'小',odds:'4—10 · 1:1'}, {type:'ANY_TRIPLE',title:'任意豹子',odds:'三骰相同 · 1:24'}, {type:'BIG',title:'大',odds:'11—17 · 1:1'},
    ...Array.from({length:6},(_,i)=>({type:'SINGLE',value:i+1,title:`${i+1} 点`,odds:'1 / 2 / 3 倍'})),
    ...Array.from({length:14},(_,i)=>({type:'SUM',value:i+4,title:`${i+4}`,odds:`1:${RULES.sums[i+4]}`})),
    ...Array.from({length:6},(_,i)=>({type:'EXACT_TRIPLE',value:i+1,title:`${i+1} ${i+1} ${i+1}`,odds:'1:150'}))
  ].map(v=>({...v,type:v.type as BetType,key:`${v.type}_${'value' in v ? v.value : 0}`,stake:0}));
}
Page({
  data:{demo:config.mode==='demo',balance:0,chip:10,chips:RULES.chips,total:0,cells:cells(),main:[] as Cell[],singles:[] as Cell[],sums:[] as Cell[],triples:[] as Cell[],dice:[1,3,5],rolling:false,pending:false,result:null as any,history:[] as any[],error:'',ready:false},
  onLoad(){this.renderBets();},
  async onShow(){await this.load(); if(wx.getStorageSync(storageKey('pending-round')))await this.recover();},
  async onPullDownRefresh(){try{await this.load();}finally{wx.stopPullDownRefresh();}},
  async load(){try{const s=await refresh();this.setData({balance:s.wallet.balance,ready:true,error:''});await this.history();}catch(e){this.setData({error:(e as Error).message});}},
  async history(){const h=await api('game.listRounds',{limit:8});this.setData({history:h.items.map((r:any)=>({...r,time:dateText(r.createdAt),netText:r.netChange>0?`+${r.netChange}`:String(r.netChange)}))});},
  renderBets(){const c=this.data.cells;this.setData({main:c.slice(0,3),singles:c.slice(3,9),sums:c.slice(9,23),triples:c.slice(23),total:c.reduce((s,v)=>s+v.stake,0)});},
  chooseChip(e:any){this.setData({chip:Number(e.currentTarget.dataset.value)});},
  add(e:any){if(this.data.rolling||this.data.pending)return;const key=e.currentTarget.dataset.key;const c=this.data.cells.map(v=>({...v}));const cell=c.find(v=>v.key===key);if(!cell)return;const next=this.data.total+this.data.chip;if(next>RULES.maxStake||next>this.data.balance){toast('投入不能超过余额或每局 500 积分');return;}cell.stake+=this.data.chip;this.setData({cells:c});this.renderBets();},
  subtract(e:any){if(this.data.rolling||this.data.pending)return;this.setData({cells:this.data.cells.map(v=>v.key===e.currentTarget.dataset.key?{...v,stake:Math.max(0,v.stake-this.data.chip)}:v)});this.renderBets();},
  clear(){if(this.data.rolling||this.data.pending)return;this.setData({cells:cells()});this.renderBets();},
  async play(){
    if(this.data.rolling)return;if(this.data.pending){await this.recover();return;}
    if(!this.data.total){toast('先点选玩法，加入筹码');return;}
    const bets:Bet[]=this.data.cells.filter(v=>v.stake>0).map(v=>({type:v.type,...(v.value?{value:v.value}:{}),stake:v.stake}));
    const pending={id:requestId(),payload:{ruleVersion:session.snapshot?.rules.version||RULES.version,bets}};
    wx.setStorageSync(storageKey('pending-round'),pending);this.setData({pending:true});await this.submit(pending);
  },
  async submit(pending:any){
    this.setData({rolling:true,error:''});
    try {
      const [round]=await Promise.all([api('game.play',pending.payload,pending.id),delay(1100)]);
      this.finish(round);
      await this.history();
    }catch(e){this.setData({error:(e as Error).message});if(e instanceof ApiError&&!e.retryable){wx.removeStorageSync(storageKey('pending-round'));this.setData({pending:false});await this.load();}else{this.setData({pending:true});}}
    finally{this.setData({rolling:false});}
  },
  async recover(){
    if(this.data.rolling)return;const p=wx.getStorageSync(storageKey('pending-round'));if(!p)return;
    this.setData({pending:true,rolling:true});
    try{const {round}=await api('game.getRound',{requestId:p.id});if(round){this.finish(round);await this.history();}else{this.setData({rolling:false});await this.submit(p);}}
    catch(e){this.setData({error:(e as Error).message});}finally{this.setData({rolling:false});}
  },
  finish(round:any){wx.removeStorageSync(storageKey('pending-round'));this.setData({pending:false,dice:round.dice,result:{...round,netText:round.netChange>0?`+${round.netChange}`:String(round.netChange)},balance:balance(),cells:cells()});this.renderBets();if(wx.getStorageSync(storageKey('haptics'))!==false)wx.vibrateShort({type:'light'});},
  closeResult(){this.setData({result:null});},
  rules(){wx.showModal({title:'玩法与积分规则',showCancel:false,content:'小：4—10；大：11—17。豹子时大小都不中奖。净赢倍数：大小 1、任意豹子 24、指定豹子 150；总点数倍数见格子。出现某点按出现 1/2/3 次净赢 1/2/3 倍。命中另返该项本金，未命中不返。长按格子减筹码。仅供虚拟积分娱乐。'});},
  noop(){}
});
