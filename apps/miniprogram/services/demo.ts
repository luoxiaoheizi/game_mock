import {MemoryStore} from '../../../services/game-api/src/store';
import {GameService} from '../../../services/game-api/src/service';
import type {Request} from '../../../packages/contracts';
const KEY='dice-club-demo-v1';
const store=new MemoryStore(wx.getStorageSync(KEY)||{},snapshot=>wx.setStorageSync(KEY,snapshot));
const service=new GameService(store,{
  now:Date.now,dice:()=>[1,2,3].map(()=>Math.floor(Math.random()*6)+1),
  token:()=>`demo_${Date.now().toString(36)}_${Math.random().toString(36).slice(2,12)}`,
  mode:'demo',minPlayMs:1500,adEnabled:true,adMinSeconds:6,adCooldownMs:15_000,adUnitId:'',moderate:async()=>{}
});
const me='demo_player_0001';
let ready:Promise<void>|undefined;
async function seed() {
  const call=(uid:string,action:string,requestId:string,payload:Record<string,any>={})=>service.handle(uid,{action,requestId,payload});
  await call(me,'user.bootstrap','seed_bootstrap');
  if(await store.get('demo_meta','seeded'))return;
  for(const [uid,name] of [['demo_friend_0002','小满'],['demo_friend_0003','阿骰']]) {
    await call(uid,'user.bootstrap','seed_bootstrap');
    await call(uid,'user.updateNickname','seed_nickname',{nickname:name,profileVersion:1});
    const invite=await call(uid,'friend.createInvite','seed_invitation');
    if(invite.ok)await call(me,'friend.acceptInvite',`seed_accept_${uid}`,{token:invite.data.token});
    if(uid.endsWith('2'))await call(uid,'wallet.claimDaily','seed_daily_sign');
  }
  await store.transaction(tx=>tx.set('demo_meta','seeded',{done:true}));
}
export async function demoCall(request:Request) {
  ready??=seed().catch(e=>{ready=undefined;throw e;});
  await ready;
  return service.handle(me,request);
}
