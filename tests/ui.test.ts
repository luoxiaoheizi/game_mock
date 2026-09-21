import {test} from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import fs from 'node:fs';
import path from 'node:path';
const root=path.resolve('dist/miniprogram');
function harness(){
  const storage=new Map<string,any>(),timers=new Map<number,()=>void>(),clock={now:Date.parse('2026-09-20T04:00:00Z')};
  let definition:any,timerId=0,failedAction='';
  const messages:string[]=[],clone=(v:any)=>v===undefined?undefined:JSON.parse(JSON.stringify(v));
  const wx:any={
    getStorageSync:(k:string)=>clone(storage.get(k)),setStorageSync:(k:string,v:any)=>storage.set(k,clone(v)),removeStorageSync:(k:string)=>storage.delete(k),
    showToast:(o:any)=>messages.push(o.title),showModal:async()=>({confirm:true,cancel:false}),vibrateShort:()=>{},stopPullDownRefresh:()=>{},setClipboardData:()=>{},switchTab:()=>{}
  };
  const context=vm.createContext({wx,console,clock,Page:(v:any)=>{definition=v;},App:()=>{},Component:()=>{},setTimeout:(f:()=>void)=>{queueMicrotask(f);return ++timerId;},clearTimeout:()=>{},setInterval:(f:()=>void)=>{const id=++timerId;timers.set(id,f);return id;},clearInterval:(id:number)=>timers.delete(id)});
  vm.runInContext('const RealDate = Date; Date = class extends RealDate { static now() { return clock.now; } };',context);
  const modules=new Map<string,any>();
  function load(file:string):any{
    const filename=path.resolve(file.endsWith('.js')?file:file+'.js');
    assert.ok(filename.startsWith(root+path.sep));
    if(modules.has(filename))return modules.get(filename).exports;
    const module={exports:{}};modules.set(filename,module);
    const factory=vm.runInContext(`(function(require,module,exports){${fs.readFileSync(filename,'utf8')}\n})`,context,{filename});
    factory((p:string)=>{const loaded=load(path.resolve(path.dirname(filename),p));return p.endsWith('/api')?new Proxy(loaded,{get(target,key){if(key==='api'&&failedAction)return async(action:string,...args:any[])=>{if(action===failedAction)throw Error('模拟网络失败');return target.api(action,...args);};return Reflect.get(target,key);}}):loaded;},module,module.exports);return module.exports;
  }
  function page(name:string){load(path.join(root,'pages',name,'index.js'));const instance={...definition,data:clone(definition.data),setData(values:any){Object.assign(this.data,clone(values));}};instance.onLoad?.();return instance;}
  return {page,wx,storage,messages,api:()=>load(path.join(root,'services/api.js')),failApi:(action:string)=>{failedAction=action;},advance:(ms:number)=>{clock.now+=ms;for(const f of timers.values())f();}};
}

test('广告三档奖励在观看前、观看中和到账后同步，跳过不升级',async()=>{
  const h=harness(),wallet=h.page('wallet');await wallet.onShow();let total=500;
  for(const amount of [200,500,1000]){
    assert.equal(wallet.data.rewards.adNextAmount,amount);
    await wallet.watch();assert.equal(wallet.data.adAmount,amount);
    wallet.cancelDemo();h.advance(16000);await wallet.watch();h.advance(6000);await wallet.completeDemo();
    total+=amount;assert.equal(wallet.data.balance,total);h.advance(16000);
  }
  assert.equal(wallet.data.rewards.adNextAmount,0);assert.equal(wallet.data.rewards.adCount,3);
  h.advance(86400_000);await wallet.load();assert.equal(wallet.data.rewards.adNextAmount,200);
});

test('分享不会自动发奖，取消不加分，确认可重复领取，好友页共用钱包确认入口',async()=>{
  const h=harness(),wallet=h.page('wallet');await wallet.onShow();
  const first=wallet.onShareAppMessage();assert.equal(first.path,'/pages/game/index');await first.promise;
  await wallet.onShow();assert.equal(wallet.data.pendingShare,true);assert.equal(wallet.data.balance,500);
  wallet.cancelShare();assert.equal(wallet.data.pendingShare,false);await wallet.confirmShare();assert.equal(wallet.data.balance,500);
  for(let i=0;i<4;i++){
    await wallet.onShareAppMessage().promise;await wallet.onShow();
    await Promise.all([wallet.confirmShare(),wallet.confirmShare()]);assert.equal(wallet.data.balance,600+i*100);
  }
  const ranking=h.page('ranking');await ranking.onShow();ranking.setData({invite:'invite_test_123'});
  const shared=ranking.onShareAppMessage();assert.ok(shared.path.includes('invite=invite_test_123'));await shared.promise;
  await ranking.onShow();assert.equal(ranking.data.pendingShare,true);
  await wallet.onShow();await wallet.confirmShare();assert.equal(wallet.data.balance,1000);
  assert.equal(wallet.data.ledgers[0].title,'分享奖励（自行确认）');
});

test('分享确认响应丢失后保留原请求，返回页面重试不重复发奖',async()=>{
  const h=harness(),wallet=h.page('wallet');await wallet.onShow();await wallet.onShareAppMessage().promise;await wallet.onShow();
  const key=h.api().storageKey('pending-share'),pending=h.storage.get(key);
  await h.api().api('share.claim',{sessionId:pending.id,confirmed:true},pending.id);
  h.storage.set(key,{...pending,confirmed:true});await wallet.onShow();
  wallet.cancelShare();assert.equal(wallet.data.pendingShare,true);
  await wallet.confirmShare();assert.equal(wallet.data.balance,600);assert.equal(wallet.data.pendingShare,false);
  assert.equal(wallet.data.ledgers.filter((v:any)=>v.kind==='SHARE_REWARD').length,1);
});
test('编译产物四页集成：下注、钱包、签到、广告、改昵称与排行共享同一状态',async()=>{
  const h=harness(),game=h.page('game');await game.onShow();assert.equal(game.data.balance,500);assert.equal(game.data.singles.length,6);assert.equal(game.data.sums.length,14);
  game.add({currentTarget:{dataset:{key:'SMALL_0'}}});assert.equal(game.data.total,10);
  await game.play();assert.ok(game.data.result);assert.equal(game.data.pending,false);assert.equal(game.data.rolling,false);
  const afterBet=game.data.balance;
  const wallet=h.page('wallet');await wallet.onShow();assert.equal(wallet.data.balance,afterBet);
  await wallet.sign();assert.equal(wallet.data.balance,afterBet+100);await wallet.sign();assert.equal(wallet.data.balance,afterBet+100);
  await wallet.watch();assert.equal(wallet.data.showAd,true);wallet.cancelDemo();await wallet.load();assert.equal(wallet.data.balance,afterBet+100);
  h.advance(16000);await wallet.watch();h.advance(6000);assert.equal(wallet.data.remaining,0);await wallet.completeDemo();assert.equal(wallet.data.balance,afterBet+300);assert.equal(wallet.data.rewards.adCount,1);
  const profile=h.page('profile');await profile.onShow();profile.edit();profile.input({detail:{value:'小熊好运'}});await profile.save();assert.equal(profile.data.nickname,'小熊好运');
  const ranking=h.page('ranking');await ranking.onShow();assert.equal(ranking.data.items.length,3);
  const me=ranking.data.items.find((v:any)=>v.isMe);assert.equal(me.nickname,'小熊好运');assert.equal(me.rounds,1);assert.equal(me.totalStake,10);
  await game.onShow();assert.equal(game.data.balance,afterBet+300);
  assert.ok(h.storage.has('dice-club-demo-v1'));
});
test('客户端恢复已提交但响应丢失的局，不重新开奖或重复扣款',async()=>{
  const h=harness(),game=h.page('game');await game.onShow();
  const api=h.api(),pending={id:'restore_round_123',payload:{ruleVersion:'sicbo-v1',bets:[{type:'BIG',stake:100}]}};
  h.storage.set(api.storageKey('pending-round'),pending);
  const result=await api.api('game.play',pending.payload,pending.id);
  await game.onShow();assert.equal(game.data.result.roundId,result.roundId);assert.equal(game.data.balance,result.wallet.balance);assert.equal(game.data.pending,false);
  const history=await api.api('game.listRounds');assert.equal(history.items.length,1);
});
test('原生广告完成、跳过、加载失败的客户端事件分支',async()=>{
  const h=harness(),wallet=h.page('wallet');await wallet.onShow();
  let close:((r:any)=>void)|undefined,error:(()=>void)|undefined,loads=0,behavior='skip';
  h.wx.createRewardedVideoAd=()=>({
    onClose:(f:any)=>{close=f;},offClose:()=>{close=undefined;},onError:(f:any)=>{error=f;},offError:()=>{error=undefined;},
    load:async()=>{loads++;},
    show:async()=>{if(behavior==='error'){error?.();throw Error('no fill');}h.advance(6000);close?.({isEnded:behavior==='complete'});}
  });
  wallet.setData({demo:false,rewards:{...wallet.data.rewards,adUnitId:'adunit-test'}});
  await wallet.watch();assert.equal(wallet.data.busy,false);assert.ok(h.messages.some(v=>v.includes('未完整观看')));assert.equal((await h.api().api('wallet.get')).wallet.balance,500);
  h.advance(16000);behavior='error';await wallet.watch();assert.equal(wallet.data.busy,false);assert.equal(loads,0);assert.equal((await h.api().api('wallet.get')).wallet.balance,500);
  h.advance(16000);behavior='complete';await wallet.watch();assert.equal((await h.api().api('wallet.get')).wallet.balance,700);
});
test('页面事件绑定和组件引用完整，前端打包没有 Node.js 内置模块',()=>{
  const h=harness();
  for(const name of ['game','wallet','ranking','profile']){
    const instance=h.page(name),xml=fs.readFileSync(path.join(root,'pages',name,'index.wxml'),'utf8');
    for(const match of xml.matchAll(/(?:bind(?:tap|longpress|input|change)|catchtouchmove)="([\w]+)"/g))assert.equal(typeof instance[match[1]],'function',`${name}: ${match[1]}`);
    assert.ok(!/<br\s*\//.test(xml),'WXML 不使用 HTML br 标签');
  }
  const app=JSON.parse(fs.readFileSync(path.join(root,'app.json'),'utf8'));
  for(const p of app.pages)for(const ext of ['js','json','wxml','wxss'])assert.ok(fs.existsSync(path.join(root,`${p}.${ext}`)));
  for(const component of Object.values(app.usingComponents) as string[])assert.ok(fs.existsSync(path.join(root,component+'.json')));
  const api=fs.readFileSync(path.join(root,'services/api.js'),'utf8');assert.ok(!api.includes('require("node:'));assert.ok(!api.includes('require("wx-server-sdk")'));
});
test('玩法分组切换保留已选投注，显式减筹码同步更新汇总',async()=>{
  const h=harness(),game=h.page('game');await game.onShow();
  assert.equal(typeof game.changeGroup,'function');
  game.add({currentTarget:{dataset:{key:'SINGLE_2'}}});
  game.changeGroup({currentTarget:{dataset:{group:'sum'}}});
  game.add({currentTarget:{dataset:{key:'SUM_9'}}});
  assert.equal(game.data.activeGroup,'sum');assert.equal(game.data.total,20);assert.equal(game.data.selected.length,2);
  game.subtract({currentTarget:{dataset:{key:'SINGLE_2'}}});
  assert.equal(game.data.total,10);assert.equal(game.data.selected.length,1);
  game.changeGroup({currentTarget:{dataset:{group:'single'}}});assert.equal(game.data.total,10);
});
test('尚未加载和结算锁定期间，玩法与筹码不能被修改',async()=>{
  const h=harness(),game=h.page('game');game.setData({balance:1000});
  game.add({currentTarget:{dataset:{key:'BIG_0'}}});assert.equal(game.data.total,0);
  await game.onShow();game.setData({pending:true});game.chooseChip({currentTarget:{dataset:{value:100}}});assert.equal(game.data.chip,10);
});
test('昵称校验在弹层内显示错误，保留输入并允许修正',async()=>{
  const h=harness(),profile=h.page('profile');await profile.onShow();profile.edit();
  profile.input({detail:{value:'x'}});await profile.save();
  assert.equal(profile.data.editing,true);assert.equal(profile.data.editName,'x');assert.ok(profile.data.formError.includes('2～12'));
  profile.input({detail:{value:'新的昵称'}});assert.equal(profile.data.formError,'');await profile.save();assert.equal(profile.data.nickname,'新的昵称');
});
test('已结算局的历史列表刷新失败，不把成功结算重新标为待恢复',async()=>{
  const h=harness(),game=h.page('game');await game.onShow();game.add({currentTarget:{dataset:{key:'SMALL_0'}}});
  game.history=async()=>{throw Error('记录暂时无法加载');};await game.play();
  assert.ok(game.data.result);assert.equal(game.data.pending,false);assert.equal(game.data.rolling,false);assert.ok(game.data.historyError);
});
test('摇盅按摇动、确认、落定、展示顺序完成，点数和高亮服从后端结果',async()=>{
  const h=harness(),game=h.page('game');await game.onShow();
  const states:string[]=[],set=game.setData.bind(game);game.setData=(v:any)=>{if(v.phase)states.push(v.phase);set(v);};
  game.add({currentTarget:{dataset:{key:'SINGLE_2'}}});states.length=0;await game.play();
  assert.deepEqual(states.filter((v,i)=>i===0||v!==states[i-1]),['shaking','waiting','settling','result']);
  assert.deepEqual(game.data.dice,game.data.result.dice);assert.equal(game.data.detailsOpen,false);
  for(const cell of game.data.cells){const item=game.data.result.items.find((v:any)=>`${v.type}_${v.value||0}`===cell.key);assert.equal(cell.won,!!item?.payout);assert.equal(cell.settledStake,item?.stake||0);}
  const prior=game.data.balance;game.add({currentTarget:{dataset:{key:'BIG_0'}}});
  assert.equal(game.data.result,null);assert.equal(game.data.phase,'idle');assert.equal(game.data.total,10);assert.equal(game.data.balance,prior);
  assert.ok(game.data.cells.every((v:any)=>!v.won&&!v.settledStake));
});
test('恢复开奖直接展示原点数，不重新摇盅；明细可展开且不改变积分',async()=>{
  const h=harness(),game=h.page('game');await game.onShow();const api=h.api();
  const p={id:'cup_restore_123',payload:{ruleVersion:'sicbo-v1',bets:[{type:'SMALL',stake:10}]}};
  h.storage.set(api.storageKey('pending-round'),p);const r=await api.api('game.play',p.payload,p.id);await game.recover();
  assert.equal(game.data.phase,'result');assert.deepEqual(game.data.dice,Array.from(r.dice));game.toggleDetails();assert.equal(game.data.detailsOpen,true);assert.equal(game.data.balance,r.wallet.balance);
});
test('立体骰子每种正面都有六个不同点面，相对两面之和为七',()=>{
  let component:any;vm.runInNewContext(fs.readFileSync(path.join(root,'components/dice/index.js'),'utf8'),{Component:(v:any)=>{component=v;}});
  for(let value=1;value<=6;value++){
    const state:any={data:{},setData(v:any){Object.assign(this.data,v);}};component.observers.value.call(state,value);
    assert.equal(state.data.sides?.length,6);const counts=state.data.sides.map((v:any)=>v.dots.filter((d:any)=>d.on).length);
    assert.equal(counts[0],value);assert.equal(new Set(counts).size,6);assert.equal(counts[0]+counts[1],7);assert.equal(counts[2]+counts[3],7);assert.equal(counts[4]+counts[5],7);
  }
});
test('钱包展示按天变化的签到奖励、完整奖励表和断签重置',async()=>{
  const h=harness(),wallet=h.page('wallet');await wallet.onShow();
  assert.equal(wallet.data.balance,500);assert.equal(wallet.data.rewards.dailyAmount,100);
  wallet.toggleSignRules();assert.equal(wallet.data.signRulesOpen,true);assert.equal(wallet.data.first30Rewards[29].amount,1000);
  const expected=[100,100,300,200,200,200,500,200,200,500];let total=500;
  for(let day=1;day<=10;day++){
    await wallet.load();assert.equal(wallet.data.rewards.dailyDay,day);assert.equal(wallet.data.rewards.dailyAmount,expected[day-1]);
    await wallet.sign();total+=expected[day-1];assert.equal(wallet.data.balance,total);assert.equal(wallet.data.rewards.signed,true);
    if(day<10)h.advance(86400_000);
  }
  h.advance(2*86400_000);await wallet.load();assert.equal(wallet.data.rewards.dailyDay,1);assert.equal(wallet.data.rewards.dailyAmount,100);
});

test('两个好友榜切换显示对应指标，保留选项，零局不排名，刷新失败保留榜单',async()=>{
  const h=harness(),ranking=h.page('ranking');await ranking.onShow();
  assert.equal(ranking.data.board,'winRate');assert.equal(ranking.data.myRank,0);
  assert.ok(ranking.data.items.every((v:any)=>v.metric==='—'&&v.rank===null));
  await h.api().api('game.play',{ruleVersion:'sicbo-v1',bets:[{type:'SMALL',stake:10},{type:'BIG',stake:10}]});
  await ranking.load();const me=ranking.data.items.find((v:any)=>v.isMe);
  assert.equal(me.metric,'0.0%');assert.equal(me.profitWins,0);assert.equal(ranking.data.myRank,1);
  ranking.manage();ranking.changeBoard({currentTarget:{dataset:{board:'turnover'}}});
  assert.equal(ranking.data.items.find((v:any)=>v.isMe).metric,'20');assert.equal(ranking.data.managing,true);
  await ranking.onShow();assert.equal(ranking.data.board,'turnover');
  const before=JSON.stringify(ranking.data.items);h.failApi('ranking.listFriends');
  await ranking.load();assert.equal(JSON.stringify(ranking.data.items),before);assert.equal(ranking.data.error,'模拟网络失败');
  ranking.changeBoard({currentTarget:{dataset:{board:'winRate'}}});assert.equal(ranking.data.items.find((v:any)=>v.isMe).metric,'0.0%');
});
