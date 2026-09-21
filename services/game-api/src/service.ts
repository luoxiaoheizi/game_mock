import {BusinessError,check,dayKey,normalizeBets,RULES,settle,signInReward,validNickname} from '../../../packages/domain';
import type {Request,Response,Wallet,User} from '../../../packages/contracts';
import type {Store,Tx} from './store';

export interface Options {
  now:()=>number; dice:()=>number[]; token:()=>string;
  mode:'demo'|'cloud'; minPlayMs:number; adEnabled:boolean; adMinSeconds:number; adCooldownMs:number; adUnitId:string;
  moderate:(nickname:string,userId:string)=>Promise<void>;
}
const id=(...parts:string[])=>parts.join('~'); // 所有外部 ID 均经过字符白名单验证，不含分隔符。
const requiredId=(v:unknown)=>{check(typeof v==='string'&&/^[a-zA-Z0-9_-]{8,100}$/.test(v),'INVALID_ARGUMENT','请求标识无效');return v;};
export class GameService {
  constructor(public db:Store,public options:Options) {}
  async handle(userId:string,request:Request):Promise<Response> {
    const now=this.options.now(),traceId=this.options.token();
    try {
      check(/^[a-zA-Z0-9_-]{3,100}$/.test(userId),'UNAUTHENTICATED','请重新进入小程序');
      check(request && typeof request.action==='string','INVALID_ARGUMENT','请求无效');
      requiredId(request.requestId);
      check(request.requestId.length<=48,'INVALID_ARGUMENT','请求标识过长');
      check(request.payload && typeof request.payload==='object' && !Array.isArray(request.payload),'INVALID_ARGUMENT','请求参数无效');
      const data=await this.dispatch(userId,request,now);
      return {ok:true,data,traceId,serverTime:now};
    } catch(e) {
      const known=e instanceof BusinessError;
      if(!known && this.options.mode==='cloud') console.error(JSON.stringify({traceId,action:request?.action,code:(e as any)?.code||'INTERNAL_ERROR'}));
      return {ok:false,error:{code:known?e.code:'INTERNAL_ERROR',message:known?e.message:'服务暂时不可用，请稍后重试',retryable:known?e.retryable:true},traceId,serverTime:now};
    }
  }
  private async wallet(tx:Tx,uid:string):Promise<Wallet> {
    const w=await tx.get<Wallet>('wallets',uid); check(w,'UNAUTHENTICATED','请先初始化用户'); return w;
  }
  private async ledger(tx:Tx,w:Wallet,kind:string,delta:number,businessId:string,now:number) {
    const balance=w.balance+delta;
    check(Number.isSafeInteger(balance)&&balance>=0&&balance<=RULES.maxBalance,'BALANCE_LIMIT','积分余额超出允许范围');
    w.balance=balance; w.ledgerSeq++;
    await tx.set('wallet_ledgers',id(w.userId,String(w.ledgerSeq)),{userId:w.userId,seq:w.ledgerSeq,kind,delta,balanceAfter:balance,businessId,createdAt:now});
  }
  private async dispatch(uid:string,r:Request,now:number):Promise<any> {
    const p=r.payload, date=dayKey(now);
    switch(r.action) {
      case 'user.bootstrap': {
        await this.db.transaction(async tx=>{
          if(await tx.get('users',uid)) return;
          await tx.set('users',uid,{userId:uid,nickname:`玩家${uid.slice(-4)}`,createdAt:now,profileVersion:1});
          const w:Wallet={userId:uid,balance:0,version:1,ledgerSeq:0,rounds:0,wins:0,totalStake:0,totalPayout:0,lastPlayAt:0};
          await this.ledger(tx,w,'WELCOME',RULES.initial,'welcome',now);
          await tx.set('wallets',uid,w);
          await tx.set('friend_lists',uid,{ids:[],lastInviteAt:0});
        });
        return this.bootstrap(uid,date,now);
      }
      case 'user.updateNickname': {
        const nickname=validNickname(p.nickname);
        await this.options.moderate(nickname,uid);
        return this.db.transaction(async tx=>{
          const u=await tx.get<User>('users',uid);check(u,'UNAUTHENTICATED','请先初始化用户');
          check(p.profileVersion===u.profileVersion,'PROFILE_CONFLICT','昵称已在其他设备更新，请刷新后重试');
          u.nickname=nickname;u.profileVersion++;
          await tx.set('users',uid,u);return {user:u};
        });
      }
      case 'user.getStats': case 'wallet.get': return {wallet:await this.wallet(this.db,uid)};
      case 'game.getRules': return RULES;
      case 'game.play': {
        const bets=normalizeBets(p.bets), key=id(uid,r.requestId);
        const fingerprint=JSON.stringify({ruleVersion:p.ruleVersion,bets});
        const replay=(old:any)=>{check(old.fingerprint===fingerprint,'IDEMPOTENCY_CONFLICT','同一请求不能更改投注内容');return old;};
        const old=await this.db.get('rounds',key);if(old)return replay(old);
        check(p.ruleVersion===RULES.version,'RULE_VERSION_EXPIRED','玩法规则已更新，请刷新');
        const result=settle(bets,this.options.dice());
        return this.db.transaction(async tx=>{
          const old=await tx.get('rounds',key);if(old)return replay(old);
          const w=await this.wallet(tx,uid);
          check(w.balance>=result.stakeTotal,'INSUFFICIENT_POINTS','积分不足，可前往钱包签到');
          check(!w.lastPlayAt||now-w.lastPlayAt>=this.options.minPlayMs,'RATE_LIMITED','稍等一下，再投下一局');
          check(w.balance+result.netChange<=RULES.maxBalance,'BALANCE_LIMIT','本局可能超出积分上限');
          await this.ledger(tx,w,'BET_DEBIT',-result.stakeTotal,key,now);
          if(result.payoutTotal>0) await this.ledger(tx,w,'BET_PAYOUT',result.payoutTotal,key,now);
          w.version++;w.rounds++;w.wins+=result.payoutTotal>0?1:0;w.totalStake+=result.stakeTotal;w.totalPayout+=result.payoutTotal;w.lastPlayAt=now;
          await tx.set('wallets',uid,w);
          const round={...result,roundId:key,requestId:r.requestId,userId:uid,ruleVersion:RULES.version,fingerprint,createdAt:now,seq:w.rounds,wallet:w};
          await tx.set('rounds',key,round);return round;
        });
      }
      case 'game.getRound': return {round:await this.db.get('rounds',id(uid,requiredId(p.requestId)))};
      case 'game.listRounds': case 'wallet.listLedgers': {
        const size=p.limit??20, before=p.before;
        check(Number.isInteger(size)&&size>=1&&size<=50&&(before===undefined||(Number.isSafeInteger(before)&&before>0)),'INVALID_ARGUMENT','分页参数无效');
        const items=await this.db.list(r.action==='game.listRounds'?'rounds':'wallet_ledgers',{userId:uid},'seq',size+1,before);
        return {items:items.slice(0,size),nextCursor:items.length>size?items[size-1].seq:null};
      }
      case 'wallet.claimDaily': return this.db.transaction(async tx=>{
        const key=id(uid,date), old=await tx.get('daily_claims',key);if(old)return {...old,alreadyClaimed:true};
        const w=await this.wallet(tx,uid),previous=await tx.get('daily_claims',id(uid,dayKey(now-86400_000)));
        const streak=(previous?.streak??0)+1,amount=signInReward(streak);
        await this.ledger(tx,w,'SIGN_IN',amount,key,now); w.version++;
        const reward={date,streak,amount,ruleVersion:RULES.signIn.version,wallet:w,alreadyClaimed:false};
        await tx.set('wallets',uid,w);await tx.set('daily_claims',key,reward);return reward;
      });
      case 'ad.start': {
        check(this.options.adEnabled,'ADS_DISABLED','激励视频尚未配置，请稍后再来');
        return this.db.transaction(async tx=>{
          await this.wallet(tx,uid);
          const key=id(uid,r.requestId), old=await tx.get('ad_sessions',key);if(old)return old;
          const usage=await tx.get('ad_usage',id(uid,date))??{count:0,lastStartAt:0};
          check(usage.count<RULES.adDailyLimit,'AD_LIMIT','今日广告奖励次数已用完');
          check(!usage.lastStartAt||now-usage.lastStartAt>=this.options.adCooldownMs,'RATE_LIMITED','请稍后再观看广告');
          const session={sessionId:r.requestId,userId:uid,date,amount:RULES.adRewards[usage.count],startedAt:now,expiresAt:now+600_000,claimed:false};
          usage.lastStartAt=now;
          await tx.set('ad_usage',id(uid,date),usage);await tx.set('ad_sessions',key,session);return session;
        });
      }
      case 'ad.claim': {
        check(this.options.adEnabled,'ADS_DISABLED','激励视频尚未配置');
        const sid=requiredId(p.sessionId);
        return this.db.transaction(async tx=>{
          const key=id(uid,sid), session=await tx.get('ad_sessions',key);
          check(session,'NOT_FOUND','广告会话不存在');
          if(session.claimed)return session.result;
          check(p.completed===true,'AD_INCOMPLETE','完整观看后才能领取奖励');
          check(session.date===date&&now<=session.expiresAt,'AD_EXPIRED','广告会话已过期，请重新观看');
          check(now-session.startedAt>=this.options.adMinSeconds*1000,'AD_TOO_EARLY','观看时间不足，暂不能领取');
          const usage=await tx.get('ad_usage',id(uid,date))??{count:0,lastStartAt:0};
          check(usage.count<RULES.adDailyLimit,'AD_LIMIT','今日广告奖励次数已用完');
          const amount=RULES.adRewards[usage.count];
          const w=await this.wallet(tx,uid);await this.ledger(tx,w,'AD_REWARD',amount,key,now);w.version++;usage.count++;
          const result={amount,wallet:w,count:usage.count};
          await tx.set('wallets',uid,w);await tx.set('ad_usage',id(uid,date),usage);await tx.set('ad_sessions',key,{...session,claimed:true,result});
          return result;
        });
      }
      case 'share.start': return this.db.transaction(async tx=>{
        await this.wallet(tx,uid);
        const key=id(uid,r.requestId),old=await tx.get('share_sessions',key);if(old)return old;
        const session={sessionId:r.requestId,userId:uid,createdAt:now,claimed:false};
        await tx.set('share_sessions',key,session);return session;
      });
      case 'share.claim': return this.db.transaction(async tx=>{
        const key=id(uid,requiredId(p.sessionId)),session=await tx.get('share_sessions',key);
        check(session,'NOT_FOUND','分享记录不存在，请重新发起分享');
        if(session.claimed)return session.result;
        // 用户选择自报确认；不将转发面板打开或客户端确认当成微信送达证明。
        check(p.confirmed===true,'SHARE_UNCONFIRMED','请先确认已分享');
        const w=await this.wallet(tx,uid);await this.ledger(tx,w,'SHARE_REWARD',RULES.shareReward,key,now);w.version++;
        const result={amount:RULES.shareReward,wallet:w,confirmation:'self-reported'};
        await tx.set('wallets',uid,w);await tx.set('share_sessions',key,{...session,claimed:true,confirmedAt:now,result});return result;
      });
      case 'friend.createInvite': {
        const token=this.options.token();
        return this.db.transaction(async tx=>{
          const list=await tx.get('friend_lists',uid);check(list,'UNAUTHENTICATED','请先初始化用户');
          const previous=await tx.get('invite_requests',id(uid,r.requestId));if(previous)return previous;
          check(!list.lastInviteAt||now-list.lastInviteAt>=10_000,'RATE_LIMITED','邀请创建过于频繁，请稍后再试');
          check(list.ids.length<50,'FRIEND_LIMIT','好友数量已达上限');
          const result={token,expiresAt:now+86400_000};
          await tx.set('friend_invites',token,{...result,owner:uid,acceptedBy:''});
          await tx.set('invite_requests',id(uid,r.requestId),result);
          await tx.set('friend_lists',uid,{...list,lastInviteAt:now});return result;
        });
      }
      case 'friend.acceptInvite': {
        const token=requiredId(p.token);
        return this.db.transaction(async tx=>{
          const invite=await tx.get('friend_invites',token);check(invite,'NOT_FOUND','邀请码不存在');
          check(invite.owner!==uid,'INVALID_ARGUMENT','不能添加自己');
          if(invite.acceptedBy){check(invite.acceptedBy===uid,'INVITE_USED','邀请已被使用');return {added:false};}
          check(invite.expiresAt>now,'INVITE_EXPIRED','邀请已过期');
          const a=await tx.get('friend_lists',uid),b=await tx.get('friend_lists',invite.owner);
          check(a&&b,'NOT_FOUND','用户不存在');
          const exists=a.ids.includes(invite.owner);
          if(!exists){check(a.ids.length<50&&b.ids.length<50,'FRIEND_LIMIT','好友数量已达上限');a.ids.push(invite.owner);b.ids.push(uid);}
          await tx.set('friend_lists',uid,a);await tx.set('friend_lists',invite.owner,b);
          await tx.set('friend_invites',token,{...invite,acceptedBy:uid});return {added:!exists};
        });
      }
      case 'friend.remove': {
        const other=requiredId(p.userId);
        check(other!==uid,'INVALID_ARGUMENT','不能移除自己');
        return this.db.transaction(async tx=>{
          const a=await tx.get('friend_lists',uid),b=await tx.get('friend_lists',other);
          check(a,'UNAUTHENTICATED','请先初始化用户');
          a.ids=a.ids.filter((v:string)=>v!==other);await tx.set('friend_lists',uid,a);
          if(b){b.ids=b.ids.filter((v:string)=>v!==uid);await tx.set('friend_lists',other,b);}return {removed:true};
        });
      }
      case 'ranking.listFriends': {
        const list=await this.db.get('friend_lists',uid);check(list,'UNAUTHENTICATED','请先初始化用户');
        const rows=[];
        // 小规模榜单分批读取，限制并发和最大好友数量。
        const ids=[uid,...list.ids].slice(0,51);
        for(let i=0;i<ids.length;i+=8) rows.push(...await Promise.all(ids.slice(i,i+8).map(async (friendId:string)=>{
          const u=await this.db.get<User>('users',friendId),w=await this.wallet(this.db,friendId);
          return {userId:friendId,nickname:u?.nickname??'玩家',balance:w.balance,isMe:friendId===uid};
        })));
        rows.sort((a,b)=>b.balance-a.balance||a.userId.localeCompare(b.userId));
        return {items:rows.map((v,i)=>({...v,rank:i+1})),asOf:now};
      }
      default: throw new BusinessError('INVALID_ACTION','接口不存在');
    }
  }
  private async bootstrap(uid:string,date:string,now:number) {
    const daily=await this.db.get('daily_claims',id(uid,date));
    const previous=await this.db.get('daily_claims',id(uid,dayKey(now-86400_000)));
    const usage=await this.db.get('ad_usage',id(uid,date));
    const streak=daily?.streak??previous?.streak??0,dailyDay=daily?streak:streak+1;
    const dailyAmount=daily?.amount??signInReward(dailyDay),start=Math.floor((dailyDay-1)/7)*7+1;
    const dailyPreview=await Promise.all(Array.from({length:7},async(_,i)=>{
      const day=start+i,claimed=day<=streak,daysAgo=dailyDay-day;
      const record=!claimed?null:daysAgo===0?daily:daysAgo===1?previous:
        await this.db.get('daily_claims',id(uid,dayKey(now-daysAgo*86400_000)));
      return {day,amount:record?.amount??signInReward(day),claimed};
    }));
    return {user:await this.db.get('users',uid),wallet:await this.wallet(this.db,uid),rules:RULES,mode:this.options.mode,rewards:{signed:!!daily,streak,dailyDay,dailyAmount,nextDailyAmount:signInReward(dailyDay+1),dailyPreview,adCount:usage?.count??0,adNextAmount:RULES.adRewards[usage?.count??0]??0,adEnabled:this.options.adEnabled,adMinSeconds:this.options.adMinSeconds,adUnitId:this.options.adUnitId}};
  }
}
