import {test} from 'node:test';
import assert from 'node:assert/strict';
import {normalizeBets,settle,dayKey,validNickname,RULES} from '../packages/domain';
test('216 种骰子组合的大小、豹子、出现次数准确',()=>{
  let small=0,big=0,triple=0,exact=0;const counts=[0,0,0,0];
  for(let a=1;a<=6;a++)for(let b=1;b<=6;b++)for(let c=1;c<=6;c++){
    const r=settle([{type:'SMALL',stake:10},{type:'BIG',stake:10},{type:'ANY_TRIPLE',stake:10},{type:'EXACT_TRIPLE',value:1,stake:10}],[a,b,c]);
    small+=r.items[0].payout>0?1:0;big+=r.items[1].payout>0?1:0;triple+=r.items[2].payout>0?1:0;exact+=r.items[3].payout>0?1:0;
    counts[[a,b,c].filter(v=>v===1).length]++;
  }
  assert.deepEqual([small,big,triple,exact],[105,105,6,1]);assert.deepEqual(counts,[125,75,15,1]);
});
test('净赢倍数与本金分开，独立玩法叠加结算',()=>{
  const r=settle(normalizeBets([{type:'BIG',stake:100},{type:'SINGLE',value:6,stake:50}]),[2,4,6]);
  assert.equal(r.stakeTotal,150);assert.equal(r.payoutTotal,300);assert.equal(r.netChange,150);
  assert.equal(settle([{type:'SINGLE',value:6,stake:10}],[6,6,6]).payoutTotal,40);
  assert.equal(settle([{type:'SUM',value:6,stake:10}],[2,2,2]).payoutTotal,180);
});
test('总点数规则每个可选值都有明确倍数',()=>{
  for(let sum=4;sum<=17;sum++)assert.ok(Number.isInteger(RULES.sums[sum]));
});
test('合并重复投注，拒绝小数、负数、非法点数、超限和额外字段',()=>{
  assert.deepEqual(normalizeBets([{type:'BIG',stake:10},{type:'BIG',stake:50}]),[{type:'BIG',stake:60}]);
  for(const raw of [[],[{type:'BIG',stake:1.2}],[{type:'BIG',stake:-10}],[{type:'SUM',value:18,stake:10}],[{type:'BIG',stake:510}],[{type:'BIG',stake:10,payout:100}],[{type:'BIG',value:1,stake:10}],[{type:'FAKE',stake:10}]])assert.throws(()=>normalizeBets(raw));
});
test('北京时间跨日边界与昵称校验',()=>{
  assert.equal(dayKey(Date.parse('2026-09-20T15:59:59Z')),'2026-09-20');
  assert.equal(dayKey(Date.parse('2026-09-20T16:00:00Z')),'2026-09-21');
  assert.equal(validNickname('  小幸运  '),'小幸运');
  for(const v of ['a','<script>','很'.repeat(13),'昵称\n换行'])assert.throws(()=>validNickname(v));
});
