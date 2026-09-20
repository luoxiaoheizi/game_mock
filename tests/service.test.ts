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
test('并发建档只发一份初始积分与流水',async()=>{
  const f=fixture();await Promise.all(Array.from({length:20},()=>f.ok('user.bootstrap')));
  assert.equal((await f.ok('wallet.get')).wallet.balance,1000);
  assert.equal((await f.ok('wallet.listLedgers')).items.length,1);
});
test('相同请求并发结算只扣一次，响应丢失后查到同一结果',async()=>{
  const f=fixture();await f.ok('user.bootstrap');
  const rounds=await Promise.all(Array.from({length:20},()=>f.ok('game.play',play,'same_round_123')));
  assert.ok(rounds.every(r=>r.roundId===rounds[0].roundId));
  assert.equal((await f.ok('wallet.get')).wallet.balance,900);
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
  assert.equal(result.filter(v=>v.ok).length,2);assert.equal((await f.ok('wallet.get')).wallet.balance,0);
});
test('结算中途存储失败完整回滚',async()=>{
  const f=fixture();await f.ok('user.bootstrap');const previous=JSON.stringify(f.db.data);
  const transaction=f.db.transaction.bind(f.db);
  f.db.transaction=fn=>transaction(tx=>fn({get:tx.get.bind(tx),set:async(c,id,v)=>{if(c==='rounds')throw Error('injected');await tx.set(c,id,v);}}));
  const r=await f.call('game.play',play);assert.equal(r.ok,false);assert.equal(JSON.stringify(f.db.data),previous);
});
test('签到重复请求只领一次，跨日连续、断签重置',async()=>{
  const f=fixture();await f.ok('user.bootstrap');await Promise.all(Array.from({length:10},()=>f.ok('wallet.claimDaily')));
  assert.equal((await f.ok('wallet.get')).wallet.balance,1500);
  f.advance(86400_000);assert.equal((await f.ok('wallet.claimDaily')).streak,2);
  f.advance(2*86400_000);assert.equal((await f.ok('wallet.claimDaily')).streak,1);
});
test('账本之和等于余额，投入和返还不重复返本金',async()=>{
  const f=fixture();await f.ok('user.bootstrap');f.dice([2,4,6]);await f.ok('game.play',{ruleVersion:RULES.version,bets:[{type:'BIG',stake:100},{type:'SINGLE',value:6,stake:50}]});await f.ok('wallet.claimDaily');
  const w=(await f.ok('wallet.get')).wallet,rows=(await f.ok('wallet.listLedgers')).items;
  assert.equal(w.balance,1650);assert.equal(rows.reduce((s:number,v:any)=>s+v.delta,0),w.balance);
  assert.deepEqual(rows.map((v:any)=>v.seq),[4,3,2,1]);
});
test('广告过早、跳过不能领，完整观看只发一份奖励',async()=>{
  const f=fixture();await f.ok('user.bootstrap');const s=await f.ok('ad.start');
  assert.equal((await f.call('ad.claim',{sessionId:s.sessionId,completed:false})).ok,false);
  assert.equal((await f.call('ad.claim',{sessionId:s.sessionId,completed:true})).ok,false);
  f.advance(6000);await Promise.all(Array.from({length:10},()=>f.ok('ad.claim',{sessionId:s.sessionId,completed:true})));
  assert.equal((await f.ok('wallet.get')).wallet.balance,1200);
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
  assert.equal(rewards.filter(r=>r.ok).length,3);assert.equal((await f.ok('wallet.get')).wallet.balance,1600);
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
