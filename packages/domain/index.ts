export type BetType = 'BIG' | 'SMALL' | 'ANY_TRIPLE' | 'EXACT_TRIPLE' | 'SUM' | 'SINGLE';
export interface Bet { type: BetType; value?: number; stake: number }
export class BusinessError extends Error {
  constructor(public code: string, message: string, public retryable = false) { super(message); }
}
export function check(ok: unknown, code: string, message: string): asserts ok {
  if (!ok) throw new BusinessError(code, message);
}
export const RULES = {
  version:'sicbo-v1', initial:1000, daily:500, adReward:200, adDailyLimit:3,
  chips:[10,50,100], maxStake:500, maxBalance:1_000_000_000,
  // 净赢倍数：命中时另返该项本金。项目娱乐规则，不代表任何场所赔率。
  big:1, small:1, anyTriple:24, exactTriple:150,
  sums:{4:60,5:30,6:17,7:12,8:8,9:6,10:6,11:6,12:6,13:8,14:12,15:17,16:30,17:60} as Record<number,number>,
  single:[0,1,2,3]
};
export const TYPES: BetType[] = ['SMALL','BIG','ANY_TRIPLE','EXACT_TRIPLE','SUM','SINGLE'];
export function normalizeBets(raw: unknown): Bet[] {
  check(Array.isArray(raw) && raw.length > 0 && raw.length <= 40,'INVALID_ARGUMENT','请选择玩法，最多 40 个选项');
  const merged = new Map<string,Bet>();
  for (const b of raw) {
    check(b && typeof b === 'object' && TYPES.includes(b.type),'INVALID_ARGUMENT','玩法不合法');
    check(Object.keys(b).every(k=>['type','value','stake'].includes(k)),'INVALID_ARGUMENT','含有不支持的投注字段');
    check(Number.isSafeInteger(b.stake) && b.stake > 0 && b.stake % 10 === 0,'INVALID_ARGUMENT','投入须为 10 的正整数倍');
    const valued = ['EXACT_TRIPLE','SUM','SINGLE'].includes(b.type);
    check(valued ? Number.isInteger(b.value) && (b.type === 'SUM' ? b.value >= 4 && b.value <= 17 : b.value >= 1 && b.value <= 6) : b.value === undefined,'INVALID_ARGUMENT','点数不合法');
    const key = `${b.type}:${b.value ?? ''}`;
    const old = merged.get(key);
    merged.set(key,{type:b.type,...(valued ? {value:b.value} : {}),stake:(old?.stake ?? 0)+b.stake});
  }
  const result = [...merged.values()].sort((a,b)=>`${a.type}:${a.value ?? ''}`.localeCompare(`${b.type}:${b.value ?? ''}`));
  check(result.reduce((s,b)=>s+b.stake,0)<=RULES.maxStake,'INVALID_ARGUMENT',`每局最多投入 ${RULES.maxStake} 积分`);
  return result;
}
export function label(b: Pick<Bet,'type'|'value'>): string {
  return ({BIG:'大',SMALL:'小',ANY_TRIPLE:'任意豹子',EXACT_TRIPLE:`${b.value} 豹子`,SUM:`总点数 ${b.value}`,SINGLE:`出现 ${b.value}`} as Record<BetType,string>)[b.type];
}
export function settle(bets: Bet[], dice: number[]) {
  check(dice.length===3 && dice.every(n=>Number.isInteger(n)&&n>=1&&n<=6),'INVALID_DICE','骰子结果无效');
  const sum = dice.reduce((a,b)=>a+b,0), triple = dice.every(n=>n===dice[0]);
  const items = bets.map(b=>{
    const count = dice.filter(n=>n===b.value).length;
    let multiplier = -1;
    if(b.type==='BIG' && !triple && sum>=11 && sum<=17) multiplier=RULES.big;
    if(b.type==='SMALL' && !triple && sum>=4 && sum<=10) multiplier=RULES.small;
    if(b.type==='ANY_TRIPLE' && triple) multiplier=RULES.anyTriple;
    if(b.type==='EXACT_TRIPLE' && triple && dice[0]===b.value) multiplier=RULES.exactTriple;
    if(b.type==='SUM' && sum===b.value) multiplier=RULES.sums[sum];
    if(b.type==='SINGLE' && count>0) multiplier=RULES.single[count];
    return {...b,label:label(b),payout:multiplier<0 ? 0 : b.stake*(1+multiplier),count};
  });
  const stakeTotal=bets.reduce((a,b)=>a+b.stake,0), payoutTotal=items.reduce((a,b)=>a+b.payout,0);
  return {dice,sum,triple,items,stakeTotal,payoutTotal,netChange:payoutTotal-stakeTotal};
}
export function dayKey(time: number): string { return new Date(time+8*3600_000).toISOString().slice(0,10); }
export function validNickname(value: unknown): string {
  check(typeof value==='string','INVALID_ARGUMENT','请输入昵称');
  const name=value.trim();
  check([...name].length>=2 && [...name].length<=12 && /^[\p{L}\p{N}_· -]+$/u.test(name),'INVALID_ARGUMENT','昵称须为 2～12 个文字、数字或常用分隔符');
  return name;
}
