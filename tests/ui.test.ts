import {test} from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import fs from 'node:fs';
import path from 'node:path';
const root=path.resolve('dist/miniprogram');
function harness(){
  const storage=new Map<string,any>(),timers=new Map<number,()=>void>(),clock={now:Date.parse('2026-09-20T04:00:00Z')};
  let definition:any,timerId=0;
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
    factory((p:string)=>load(path.resolve(path.dirname(filename),p)),module,module.exports);return module.exports;
  }
  function page(name:string){load(path.join(root,'pages',name,'index.js'));const instance={...definition,data:clone(definition.data),setData(values:any){Object.assign(this.data,clone(values));}};instance.onLoad?.();return instance;}
  return {page,wx,storage,messages,api:()=>load(path.join(root,'services/api.js')),advance:(ms:number)=>{clock.now+=ms;for(const f of timers.values())f();}};
}
test('编译产物四页集成：下注、钱包、签到、广告、改昵称与排行共享同一状态',async()=>{
  const h=harness(),game=h.page('game');await game.onShow();assert.equal(game.data.balance,1000);assert.equal(game.data.singles.length,6);assert.equal(game.data.sums.length,14);
  game.add({currentTarget:{dataset:{key:'SMALL_0'}}});assert.equal(game.data.total,10);
  await game.play();assert.ok(game.data.result);assert.equal(game.data.pending,false);assert.equal(game.data.rolling,false);
  const afterBet=game.data.balance;
  const wallet=h.page('wallet');await wallet.onShow();assert.equal(wallet.data.balance,afterBet);
  await wallet.sign();assert.equal(wallet.data.balance,afterBet+500);await wallet.sign();assert.equal(wallet.data.balance,afterBet+500);
  await wallet.watch();assert.equal(wallet.data.showAd,true);wallet.cancelDemo();await wallet.load();assert.equal(wallet.data.balance,afterBet+500);
  h.advance(16000);await wallet.watch();h.advance(6000);assert.equal(wallet.data.remaining,0);await wallet.completeDemo();assert.equal(wallet.data.balance,afterBet+700);assert.equal(wallet.data.rewards.adCount,1);
  const profile=h.page('profile');await profile.onShow();profile.edit();profile.input({detail:{value:'小熊好运'}});await profile.save();assert.equal(profile.data.nickname,'小熊好运');
  const ranking=h.page('ranking');await ranking.onShow();assert.equal(ranking.data.items.length,3);
  const me=ranking.data.items.find((v:any)=>v.isMe);assert.equal(me.nickname,'小熊好运');assert.equal(me.balance,afterBet+700);
  await game.onShow();assert.equal(game.data.balance,afterBet+700);
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
  await wallet.watch();assert.equal(wallet.data.busy,false);assert.ok(h.messages.some(v=>v.includes('未完整观看')));assert.equal((await h.api().api('wallet.get')).wallet.balance,1000);
  h.advance(16000);behavior='error';await wallet.watch();assert.equal(wallet.data.busy,false);assert.equal(loads,0);assert.equal((await h.api().api('wallet.get')).wallet.balance,1000);
  h.advance(16000);behavior='complete';await wallet.watch();assert.equal((await h.api().api('wallet.get')).wallet.balance,1200);
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
