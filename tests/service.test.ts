import {test} from 'node:test';
import assert from 'node:assert/strict';
import {GameService} from '../services/game-api/src/service';
import {MemoryStore} from '../services/game-api/src/store';
import {CloudStore} from '../services/game-api/src/cloud-store';
import {RULES} from '../packages/domain';
function fixture(){
  let now=Date.parse('2026-09-20T04:00:00Z'),counter=0,dice=[1,2,3];
  const db=new MemoryStore();
  const service=new GameService(db,{now:()=>now,token:()=>`token_${String(++counter).padStart(10,'0')}`,dice:()=>dice,mode:'demo',minPlayMs:0,adEnabled:true,adUnitId:'',adMinSeconds:6,adCooldownMs:10_000,moderate:async()=>{}});
  const call=(action:string,payload:Record<string,any>={},rid=`request_${++counter}`,uid='player_0001')=>service.handle(uid,{action,payload,requestId:rid});
  const ok=async(action:string,payload:Record<string,any>={},rid?:string,uid?:string)=>{const r=await call(action,payload,rid,uid);assert.equal(r.ok,true,JSON.stringify(r));if(!r.ok)throw Error();return r.data;};
  return {db,service,call,ok,advance:(ms:number)=>{now+=ms;},dice:(value:number[])=>{dice=value;}};
}
const play={ruleVersion:RULES.version,bets:[{type:'BIG',stake:100}]};

test('分享自报确认每笔100分、不限次数，未确认及跨账号不能领，同笔并发只到账一次',async()=>{
  const f=fixture();await f.ok('user.bootstrap');
  assert.equal((await f.call('share.claim',{sessionId:'missing_share',confirmed:true})).ok,false);
  for(let i=0;i<5;i++){
    const s=await f.ok('share.start',{},`share_request_${i}`);
    assert.equal((await f.ok('wallet.get')).wallet.balance,500+i*100);
    assert.equal((await f.call('share.claim',{sessionId:s.sessionId,confirmed:false})).ok,false);
    assert.equal((await f.call('share.claim',{sessionId:s.sessionId,confirmed:true},undefined,'player_0002')).ok,false);
    const claims=await Promise.all(Array.from({length:5},()=>f.ok('share.claim',{sessionId:s.sessionId,confirmed:true,amount:9999})));
    assert.ok(claims.every(r=>r.amount===100));assert.equal((await f.ok('wallet.get')).wallet.balance,600+i*100);
  }
  const entries=(await f.ok('wallet.listLedgers')).items;
  assert.equal(entries.filter((v:any)=>v.kind==='SHARE_REWARD').length,5);
  assert.equal(entries.reduce((sum:number,v:any)=>sum+v.delta,0),1000);
});
test('并发建档只发一份初始积分与流水',async()=>{
  const f=fixture();await Promise.all(Array.from({length:20},()=>f.ok('user.bootstrap')));
  assert.equal((await f.ok('wallet.get')).wallet.balance,500);
  assert.equal((await f.ok('wallet.listLedgers')).items.length,1);
});
test('相同请求并发结算只扣一次，响应丢失后查到同一结果',async()=>{
  const f=fixture();await f.ok('user.bootstrap');
  const rounds=await Promise.all(Array.from({length:20},()=>f.ok('game.play',play,'same_round_123')));
  assert.ok(rounds.every(r=>r.roundId===rounds[0].roundId));
  assert.equal((await f.ok('wallet.get')).wallet.balance,400);
  assert.equal((await f.ok('game.listRounds')).items.length,1);
  f.dice([6,6,6]);assert.deepEqual((await f.ok('game.getRound',{requestId:'same_round_123'})).round.dice,[1,2,3]);
  assert.deepEqual((await f.ok('game.play',play,'same_round_123')).dice,[1,2,3]);
});
test('同 ID 改投注被拒绝，历史重试不受新规则检查影响',async()=>{
  const f=fixture();await f.ok('user.bootstrap');await f.ok('game.play',play,'same_round_123');
  const r=await f.call('game.play',{...play,bets:[{type:'SMALL',stake:100}]},'same_round_123');
  assert.ok(!r.ok&&r.error.code==='IDEMPOTENCY_CONFLICT');
  const expired=await f.call('game.play',{...play,ruleVersion:'old'});assert.ok(!expired.ok&&expired.error.code==='RULE_VERSION_EXPIRED');
});
test('多个请求竞争钱包，不允许透支',async()=>{
  const f=fixture();await f.ok('user.bootstrap');
  const result=await Promise.all(Array.from({length:4},()=>f.call('game.play',{...play,bets:[{type:'BIG',stake:500}]})));
  assert.equal(result.filter(v=>v.ok).length,1);assert.equal((await f.ok('wallet.get')).wallet.balance,0);
});
test('结算中途存储失败完整回滚',async()=>{
  const f=fixture();await f.ok('user.bootstrap');const previous=JSON.stringify(f.db.data);
  const transaction=f.db.transaction.bind(f.db);
  f.db.transaction=fn=>transaction(tx=>fn({get:tx.get.bind(tx),set:async(c,id,v)=>{if(c==='rounds')throw Error('injected');await tx.set(c,id,v);}}));
  const r=await f.call('game.play',play);assert.equal(r.ok,false);assert.equal(JSON.stringify(f.db.data),previous);
});
test('签到重复请求只领一次，跨日连续、断签重置',async()=>{
  const f=fixture();await f.ok('user.bootstrap');await Promise.all(Array.from({length:10},()=>f.ok('wallet.claimDaily')));
  assert.equal((await f.ok('wallet.get')).wallet.balance,600);
  f.advance(86400_000);assert.equal((await f.ok('wallet.claimDaily')).streak,2);
  f.advance(2*86400_000);assert.equal((await f.ok('wallet.claimDaily')).streak,1);
});
test('账本之和等于余额，投入和返还不重复返本金',async()=>{
  const f=fixture();await f.ok('user.bootstrap');f.dice([2,4,6]);await f.ok('game.play',{ruleVersion:RULES.version,bets:[{type:'BIG',stake:100},{type:'SINGLE',value:6,stake:50}]});await f.ok('wallet.claimDaily');
  const w=(await f.ok('wallet.get')).wallet,rows=(await f.ok('wallet.listLedgers')).items;
  assert.equal(w.balance,750);assert.equal(rows.reduce((s:number,v:any)=>s+v.delta,0),w.balance);
  assert.deepEqual(rows.map((v:any)=>v.seq),[4,3,2,1]);
});
test('广告过早、跳过不能领，完整观看只发一份奖励',async()=>{
  const f=fixture();await f.ok('user.bootstrap');const s=await f.ok('ad.start');
  assert.equal((await f.call('ad.claim',{sessionId:s.sessionId,completed:false})).ok,false);
  assert.equal((await f.call('ad.claim',{sessionId:s.sessionId,completed:true})).ok,false);
  f.advance(6000);await Promise.all(Array.from({length:10},()=>f.ok('ad.claim',{sessionId:s.sessionId,completed:true})));
  assert.equal((await f.ok('wallet.get')).wallet.balance,700);
  assert.equal((await f.ok('user.bootstrap')).rewards.adCount,1);
});
test('广告每日上限、过期、账号归属和关闭开关均生效',async()=>{
  const f=fixture();await f.ok('user.bootstrap');
  for(let i=0;i<3;i++){f.advance(20_000);const s=await f.ok('ad.start');f.advance(6000);await f.ok('ad.claim',{sessionId:s.sessionId,completed:true});}
  assert.equal((await f.call('ad.start')).ok,false);
  f.advance(86400_000);const s=await f.ok('ad.start');f.advance(601_000);assert.equal((await f.call('ad.claim',{sessionId:s.sessionId,completed:true})).ok,false);
  assert.equal((await f.call('ad.claim',{sessionId:s.sessionId,completed:true},undefined,'player_0002')).ok,false);
  f.service.options.adEnabled=false;assert.equal((await f.call('ad.start')).ok,false);
});
test('广告多个并发会话兑现时仍检查每日上限',async()=>{
  const f=fixture();await f.ok('user.bootstrap');const sessions=[];
  for(let i=0;i<5;i++){f.advance(20_000);sessions.push(await f.ok('ad.start'));}
  f.advance(6000);
  const rewards=await Promise.all(sessions.map(s=>f.call('ad.claim',{sessionId:s.sessionId,completed:true})));
  assert.equal(rewards.filter(r=>r.ok).length,3);assert.equal((await f.ok('wallet.get')).wallet.balance,2200);
  assert.deepEqual(rewards.filter(r=>r.ok).map(r=>r.ok?r.data.amount:0).sort((a,b)=>a-b),[200,500,1000]);
});

test('广告按当日成功领取次序递增，重试不占次数，跨日回到200分',async()=>{
  const f=fixture();await f.ok('user.bootstrap');let balance=500;
  for(const amount of [200,500,1000]){
    assert.equal((await f.ok('user.bootstrap')).rewards.adNextAmount,amount);
    const s=await f.ok('ad.start');assert.equal(s.amount,amount);
    f.advance(6000);const reward=await f.ok('ad.claim',{sessionId:s.sessionId,completed:true,amount:99999});
    balance+=amount;assert.equal(reward.amount,amount);assert.equal(reward.wallet.balance,balance);
    const repeat=await f.ok('ad.claim',{sessionId:s.sessionId,completed:true});assert.equal(repeat.amount,amount);
    f.advance(10000);
  }
  assert.equal((await f.ok('user.bootstrap')).rewards.adNextAmount,0);
  f.advance(86400_000);assert.equal((await f.ok('user.bootstrap')).rewards.adNextAmount,200);
  const s=await f.ok('ad.start');f.advance(6000);assert.equal((await f.ok('ad.claim',{sessionId:s.sessionId,completed:true})).amount,200);
});
test('昵称更新同步显示到好友榜，版本冲突不覆盖',async()=>{
  const f=fixture();await f.ok('user.bootstrap');await f.ok('user.bootstrap',{},undefined,'player_0002');
  const invite=await f.ok('friend.createInvite',{},undefined,'player_0002');
  await f.ok('friend.acceptInvite',{token:invite.token});
  await f.ok('user.updateNickname',{nickname:'幸运小骰',profileVersion:1});
  const rows=(await f.ok('ranking.listFriends',{},undefined,'player_0002')).items;
  assert.equal(rows.find((v:any)=>v.userId==='player_0001').nickname,'幸运小骰');
  assert.equal((await f.call('user.updateNickname',{nickname:'旧的昵称',profileVersion:1})).ok,false);
});
test('邀请防自邀、过期、重复使用，接受和删除关系双向一致',async()=>{
  const f=fixture();for(const uid of ['player_0001','player_0002','player_0003'])await f.ok('user.bootstrap',{},undefined,uid);
  const invite=await f.ok('friend.createInvite');
  assert.equal((await f.call('friend.acceptInvite',{token:invite.token})).ok,false);
  await Promise.all(Array.from({length:8},()=>f.ok('friend.acceptInvite',{token:invite.token},undefined,'player_0002')));
  assert.equal((await f.ok('ranking.listFriends')).items.length,2);
  assert.equal((await f.call('friend.acceptInvite',{token:invite.token},undefined,'player_0003')).ok,false);
  await f.ok('friend.remove',{userId:'player_0002'});
  assert.equal((await f.ok('ranking.listFriends',{},undefined,'player_0002')).items.length,1);
  f.advance(20_000);const expired=await f.ok('friend.createInvite');f.advance(86400_001);assert.equal((await f.call('friend.acceptInvite',{token:expired.token},undefined,'player_0003')).ok,false);
});
test('其他用户查不到局记录，伪造 payload.userId 不改变调用身份',async()=>{
  const f=fixture();await f.ok('user.bootstrap');await f.ok('game.play',play,'private_round_12');
  assert.equal((await f.ok('game.getRound',{requestId:'private_round_12'},undefined,'player_0002')).round,null);
  const w=await f.ok('wallet.get',{userId:'player_0002'});assert.equal(w.wallet.userId,'player_0001');
});
test('积分流水使用稳定序号分页，无重复遗漏',async()=>{
  const f=fixture();await f.ok('user.bootstrap');await f.ok('wallet.claimDaily');await f.ok('game.play',play);
  const first=await f.ok('wallet.listLedgers',{limit:2});const second=await f.ok('wallet.listLedgers',{limit:2,before:first.nextCursor});
  assert.deepEqual([...first.items,...second.items].map(v=>v.seq),[3,2,1]);assert.equal(second.nextCursor,null);
});
test('CloudBase 适配器使用原始 set 对象，兼容 doc 数据形状与事务返回值',async()=>{
  const values:Record<string,any>={};
  const db:any={collection:()=>({doc:(id:string)=>({get:async()=>({data:values[id]?[{_id:id,...values[id]}]:[]}),set:async(v:any)=>{values[id]=v;return {updated:1};}})}),runTransaction:(fn:any)=>fn(db)};
  const cloud=new CloudStore(db);assert.equal(await cloud.get('users','missing'),null);
  const r=await cloud.transaction(async tx=>{await tx.set('users','test',{nickname:'原始字段'});return 7;});
  assert.equal(r,7);assert.deepEqual(values.test,{nickname:'原始字段'});assert.deepEqual(await cloud.get('users','test'),{nickname:'原始字段'});
});
test('连续签到覆盖前30天、66/88/100里程碑及101天后，预告与实际到账相同',async()=>{
  const f=fixture();await f.ok('user.bootstrap');let balance=500;
  const first30=[100,100,300,200,200,200,500,200,200,500,200,300,200,200,500,200,200,300,200,500,300,200,200,300,500,200,300,200,200,1000];
  for(let day=1;day<=102;day++){
    const expected=day<=30?first30[day-1]:day===66?666:day===88?888:day===100?1000:500;
    const before=(await f.ok('user.bootstrap')).rewards;
    assert.equal(before.dailyDay,day);assert.equal(before.dailyAmount,expected);assert.equal(before.signed,false);
    assert.equal(before.dailyPreview.find((v:any)=>v.day===day)?.amount,expected);
    const r=await f.ok('wallet.claimDaily',{amount:999999,streak:100});balance+=expected;
    assert.equal(r.streak,day);assert.equal(r.amount,expected);assert.equal(r.wallet.balance,balance);
    const again=await f.ok('wallet.claimDaily');assert.equal(again.alreadyClaimed,true);assert.equal(again.amount,expected);
    const after=(await f.ok('user.bootstrap')).rewards;assert.equal(after.signed,true);assert.equal(after.dailyAmount,expected);
    assert.equal(after.dailyPreview.find((v:any)=>v.day===day)?.claimed,true);
    f.advance(86400_000);
  }
  assert.equal((await f.ok('wallet.get')).wallet.balance,balance);
  const entries=Object.values(f.db.data.wallet_ledgers) as any[];assert.equal(entries.length,103);assert.equal(entries.reduce((sum,v)=>sum+v.delta,0),balance);
  f.advance(86400_000);const reset=(await f.ok('user.bootstrap')).rewards;
  assert.equal(reset.streak,0);assert.equal(reset.dailyDay,1);assert.equal(reset.dailyAmount,100);assert.equal((await f.ok('wallet.claimDaily')).amount,100);
});
test('奖励规则更新不重置旧余额或重发当日奖励，午夜后接续新规则',async()=>{
  const f=fixture();await f.ok('user.bootstrap');const old=await f.ok('wallet.claimDaily');
  await f.db.transaction(async tx=>{
    const w=await tx.get('wallets','player_0001');w.balance=1500;await tx.set('wallets','player_0001',w);
    await tx.set('daily_claims',`player_0001~${old.date}`,{...old,amount:500,wallet:w});
  });
  const snapshot=await f.ok('user.bootstrap');assert.equal(snapshot.wallet.balance,1500);assert.equal(snapshot.rewards.dailyAmount,500);
  const repeat=await f.ok('wallet.claimDaily');assert.equal(repeat.amount,500);assert.equal(repeat.alreadyClaimed,true);assert.equal((await f.ok('wallet.get')).wallet.balance,1500);
  f.advance(12*3600_000);const next=await f.ok('wallet.claimDaily');assert.equal(next.streak,2);assert.equal(next.amount,100);assert.equal(next.wallet.balance,1600);
  const preview=(await f.ok('user.bootstrap')).rewards.dailyPreview;
  assert.equal(preview.find((v:any)=>v.day===1)?.amount,500);
  assert.equal(preview.find((v:any)=>v.day===1)?.claimed,true);
});
