// 复用视觉夹具检查实际 CSS 动画、减少动态偏好和结果布局，不替代微信真机。
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
if(!process.env.VISUAL_PLAYWRIGHT)throw Error('请设置 VISUAL_PLAYWRIGHT 为已安装 Playwright 的 index.mjs 路径');
const {chromium}=await import(pathToFileURL(process.env.VISUAL_PLAYWRIGHT));
const out=path.resolve('dist/visual-review');
const browser=await chromium.launch({headless:true,...(process.env.VISUAL_BROWSER?{executablePath:process.env.VISUAL_BROWSER}:{})});
const checks=[];
try{
  const page=await browser.newPage({viewport:{width:390,height:844},reducedMotion:'no-preference'});
  await page.goto(pathToFileURL(path.join(out,'game-shaking.html')).href);await page.waitForSelector('html[data-ready="true"]');
  assert.equal(await page.locator('.dice-cube').count(),3);
  async function frame(time){return page.evaluate(time=>{
    document.getAnimations().forEach(a=>{a.pause();a.currentTime=time;});
    return ['.cup-group','.seat-0','.seat-1','.seat-2','.dice-cube'].map(s=>getComputedStyle(document.querySelector(s)).transform);
  },time);}
  const first=await frame(80);await page.screenshot({path:path.join(out,'cup-motion-a.png')});
  const second=await frame(230);await page.screenshot({path:path.join(out,'cup-motion-b.png')});
  for(let i=0;i<first.length;i++)assert.notEqual(first[i],second[i],`动画对象 ${i} 必须发生位移或旋转`);
  checks.push('骰盅、三颗骰子轨迹和骰子立体面旋转均随时间变化');
  assert.equal(await page.locator('.dice-enclosure').evaluate(e=>getComputedStyle(e).overflow),'hidden');
  checks.push('骰子位于有边界的透明盅内，翻滚不会跨出盅体');
  await page.emulateMedia({reducedMotion:'reduce'});
  const reduced=await page.locator('.cup-group,.die-seat,.dice-cube').evaluateAll(es=>es.every(e=>getComputedStyle(e).animationName==='none'));
  assert.ok(reduced);checks.push('减少动态偏好关闭摇盅、弹跳和翻滚');
  await page.goto(pathToFileURL(path.join(out,'game-result.html')).href);await page.waitForSelector('html[data-ready="true"]');
  assert.equal(await page.locator('.modal-mask').count(),0);assert.equal(await page.locator('.round-banner').count(),1);
  const resultStops=await page.locator('.cup-group,.die-seat,.dice-cube').evaluateAll(es=>es.every(e=>getComputedStyle(e).animationName==='none'));
  assert.ok(resultStops);checks.push('开奖后骰盅与骰子停止，结果留在桌面且不弹窗');
  await page.close();
}finally{await browser.close();}
fs.writeFileSync(path.join(out,'motion-report.json'),JSON.stringify({checks,renderer:'Chromium proxy of actual WXML/WXSS'},null,2));
console.log(JSON.stringify({passed:checks.length,checks},null,2));
