import cloud from 'wx-server-sdk';
import cloudbase from '@cloudbase/node-sdk';
import {createHash,randomInt,randomBytes} from 'node:crypto';
import {GameService} from './service';
import {CloudStore} from './cloud-store';
import {BusinessError} from '../../../packages/domain';
import type {Request} from '../../../packages/contracts';
cloud.init({env:cloud.DYNAMIC_CURRENT_ENV});
const backend=cloudbase.init({env:cloudbase.SYMBOL_CURRENT_ENV});
export async function main(event:Request) {
  const {OPENID,APPID}=cloud.getWXContext();
  if(!OPENID||!APPID)return {ok:false,error:{code:'UNAUTHENTICATED',message:'请从微信小程序访问',retryable:false},traceId:randomBytes(12).toString('hex'),serverTime:Date.now()};
  const uid=createHash('sha256').update(JSON.stringify([APPID,OPENID])).digest('hex');
  const unit=process.env.REWARDED_AD_UNIT_ID??'';
  const service=new GameService(new CloudStore(backend.database()),{
    now:Date.now,dice:()=>[randomInt(1,7),randomInt(1,7),randomInt(1,7)],token:()=>randomBytes(16).toString('hex'),
    mode:'cloud',minPlayMs:2000,adEnabled:process.env.AD_REWARDS_ENABLED==='true'&&/^adunit-/.test(unit),adUnitId:unit,adMinSeconds:15,adCooldownMs:60_000,
    moderate:async nickname=>{
      const response=await cloud.openapi.security.msgSecCheck({content:nickname,version:2,scene:1,openid:OPENID});
      if(response.errCode!==0 || response.result?.suggest!=='pass')throw new BusinessError('NICKNAME_REJECTED','昵称未通过内容检查，请换一个');
    }
  });
  return service.handle(uid,event);
}
