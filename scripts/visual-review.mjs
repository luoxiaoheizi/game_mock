// 离线视觉检查：复用实际编译页面、WXML 与 WXSS；不是微信渲染器或可发布的 Web 版。
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import {pathToFileURL} from 'node:url';
const root=path.resolve('dist/miniprogram'), out=path.resolve('dist/visual-review');
fs.mkdirSync(out,{recursive:true});
const clone=v=>v===undefined?undefined:JSON.parse(JSON.stringify(v));
const storage=new Map(), timers=new Map(), modules=new Map();
let definition, timer=0;
const wx={getStorageSync:k=>clone(storage.get(k)),setStorageSync:(k,v)=>storage.set(k,clone(v)),removeStorageSync:k=>storage.delete(k),showToast:()=>{},showModal:async()=>({confirm:true}),vibrateShort:()=>{},stopPullDownRefresh:()=>{},setClipboardData:()=>{},switchTab:()=>{}};
const clock={now:Date.now()};
const context=vm.createContext({wx,console,clock,Page:v=>{definition=v;},setTimeout:f=>{queueMicrotask(f);return ++timer;},setInterval:f=>{timers.set(++timer,f);return timer;},clearTimeout:()=>{},clearInterval:id=>timers.delete(id)});
vm.runInContext('const RealDate = Date; Date = class extends RealDate { static now() { return clock.now; } };',context);
function load(file){
  file=path.resolve(file.endsWith('.js')?file:file+'.js');
  if(!file.startsWith(root+path.sep))throw Error('模块超出小程序目录');
  if(modules.has(file))return modules.get(file).exports;
  const module={exports:{}};modules.set(file,module);
  vm.runInContext(`(function(require,module,exports){${fs.readFileSync(file,'utf8')}\n})`,context,{filename:file})(p=>load(path.resolve(path.dirname(file),p)),module,module.exports);
  return module.exports;
}
async function page(name){load(path.join(root,'pages',name,'index.js'));const p={...definition,data:clone(definition.data),setData(v){Object.assign(this.data,clone(v));}};p.onLoad?.();await p.onShow();return p;}
const cases=[];
const capture=(name,page,p)=>cases.push({name,page,data:clone(p.data)});
const event=key=>({currentTarget:{dataset:{key}}});
const game=await page('game');capture('game','game',game);
game.add(event('SMALL_0'));game.add(event('SINGLE_2'));capture('game-selected','game',game);
game.setData({phase:'shaking',rolling:true});capture('game-shaking','game',game);game.setData({phase:'idle',rolling:false});
await game.play();capture('game-result','game',game);
game.toggleDetails();capture('game-details','game',game);
const wallet=await page('wallet');capture('wallet-before-sign','wallet',wallet);await wallet.sign();capture('wallet','wallet',wallet);
wallet.toggleSignRules();capture('wallet-sign-rules','wallet',wallet);wallet.toggleSignRules();
await wallet.watch();capture('wallet-ad','wallet',wallet);wallet.cancelDemo();
await wallet.onShareAppMessage().promise;await wallet.onShow();capture('wallet-share-pending','wallet',wallet);
await wallet.confirmShare();capture('wallet-share-claimed','wallet',wallet);
for(let count=1;count<=3;count++){
  clock.now+=16000;await wallet.watch();clock.now+=6000;for(const f of timers.values())f();
  capture(`wallet-ad-ready-${count}`,'wallet',wallet);await wallet.completeDemo();capture(`wallet-ad-claimed-${count}`,'wallet',wallet);
}
const ranking=await page('ranking');capture('ranking','ranking',ranking);ranking.manage();capture('ranking-manage','ranking',ranking);
ranking.changeBoard({currentTarget:{dataset:{board:'turnover'}}});capture('ranking-turnover-manage','ranking',ranking);ranking.manage();capture('ranking-turnover','ranking',ranking);
const originalBoards=clone(ranking.data.boards);
ranking.setData({boards:{...originalBoards,turnover:originalBoards.turnover.map(v=>({...v,nickname:'一二三四五六七八九十甲乙',totalStake:1234567890123}))}});ranking.renderBoard();capture('ranking-long-values','ranking',ranking);
ranking.setData({boards:originalBoards});ranking.changeBoard({currentTarget:{dataset:{board:'winRate'}}});
await ranking.onShareAppMessage().promise;await ranking.onShow();capture('ranking-share-pending','ranking',ranking);
ranking.input({detail:{value:'invalid-invite'}});await ranking.accept();capture('ranking-error','ranking',ranking);
const profile=await page('profile');capture('profile','profile',profile);profile.edit();profile.input({detail:{value:'x'}});await profile.save();capture('profile-error','profile',profile);
profile.setData({editing:false,nickname:'一二三四五六七八九十甲乙'});capture('profile-long-name','profile',profile);
for(let day=2;day<=101;day++){
  clock.now+=86400_000;
  await wallet.load();
  if([30,66,88,100,101].includes(day))capture(`wallet-day-${day}`,'wallet',wallet);
  await wallet.sign();
}
const read=file=>fs.readFileSync(path.join(root,file),'utf8');
const base=read('styles/tokens.wxss')+'\n'+read('app.wxss').replace(/@import[^;]+;/g,'')+'\n'+read('components/dice/index.wxss');
let diceDefinition;vm.runInNewContext(read('components/dice/index.js'),{Component:v=>{diceDefinition=v;}});
const diceStates={};for(let value=1;value<=6;value++){const state={data:{},setData(v){Object.assign(this.data,v);}};diceDefinition.observers.value.call(state,value);diceStates[value]=clone(state.data);}
const payload={cases,diceStates,templates:Object.fromEntries(['game','wallet','ranking','profile'].map(p=>[p,read(`pages/${p}/index.wxml`)])),dice:read('components/dice/index.wxml')};
const renderScript=String.raw`
const fixture=fixtures.cases.find(v=>v.name===location.hash.slice(1))||fixtures.cases[0];
const evaluate=(v,s)=>Function(...Object.keys(s),'return ('+v+');')(...Object.values(s));
const value=(v,s)=>/^{{[\s\S]*}}$/.test(v)&&v.indexOf('}}')===v.length-2?evaluate(v.slice(2,-2),s):v.replace(/{{([\s\S]*?)}}/g,(_,e)=>evaluate(e,s)??'');
function parse(xml){
  xml=xml.replace(/wx:/g,'wx-').replace(/{{[\s\S]*?}}/g,v=>v.replace(/</g,'&lt;').replace(/>/g,'&gt;')).replace(/\s(selectable|wx-else)(?=[\s>])/g,' $1="true"');
  const doc=new DOMParser().parseFromString('<root>'+xml+'</root>','text/xml');
  if(doc.querySelector('parsererror'))throw Error(doc.querySelector('parsererror').textContent);
  return doc.documentElement;
}
const diceTemplate=parse(fixtures.dice);
function children(source,target,scope){
  let branch=false;
  for(const n of source.childNodes){
    if(n.nodeType===3){target.append(document.createTextNode(String(value(n.textContent,scope))));continue;}
    if(n.nodeType!==1)continue;
    if(n.hasAttribute('wx-if')){branch=!!value(n.getAttribute('wx-if'),scope);if(!branch)continue;}
    else if(n.hasAttribute('wx-elif')){if(branch)continue;branch=!!value(n.getAttribute('wx-elif'),scope);if(!branch)continue;}
    else if(n.hasAttribute('wx-else')){if(branch)continue;branch=true;}
    if(n.hasAttribute('wx-for')){
      const items=value(n.getAttribute('wx-for'),scope)||[];
      items.forEach((item,index)=>{const sub={...scope,[n.getAttribute('wx-for-item')||'item']:item,[n.getAttribute('wx-for-index')||'index']:index};const copy=n.cloneNode(true);copy.removeAttribute('wx-for');element(copy,target,sub);});
    }else element(n,target,scope);
  }
}
function element(n,target,scope){
  if(n.tagName==='block'){children(n,target,scope);return;}
  if(n.tagName==='dice-face'){
    const die=Number(value(n.getAttribute('value'),scope));
    const host=document.createElement('dice-face');target.append(host);children(diceTemplate,host,{...fixtures.diceStates[die],value:die,rolling:n.hasAttribute('rolling')&&value(n.getAttribute('rolling'),scope),spatial:n.hasAttribute('spatial')&&value(n.getAttribute('spatial'),scope)});return;
  }
  const el=document.createElement(({view:'div',text:'span',switch:'input'})[n.tagName]||n.tagName);
  for(const a of n.attributes){
    if(a.name.startsWith('wx-')||a.name.startsWith('bind')||a.name.startsWith('catch'))continue;
    const v=value(a.value,scope);
    if(['disabled','checked'].includes(a.name)){if(v)el.setAttribute(a.name,'');continue;}
    if(a.name==='focus'||a.name==='loading')continue;
    el.setAttribute(a.name,String(v??''));
  }
  if(n.tagName==='switch'){el.type='checkbox';el.className='preview-switch';}
  if(n.tagName==='button')el.type='button';
  children(n,el,scope);target.append(el);
}
children(parse(fixtures.templates[fixture.page]),document.querySelector('main'),fixture.data);
document.title='静态布局检查 / '+fixture.name;
document.querySelectorAll('[data-page]').forEach(el=>el.classList.toggle('active',el.dataset.page===fixture.page));
document.documentElement.dataset.ready='true';
`;
const escapeJson=v=>JSON.stringify(v).replace(/</g,'\\u003c');
for(const c of cases){
  const css=(base+'\n'+read(`pages/${c.page}/index.wxss`)).replace(/(-?[\d.]+)rpx/g,(_,n)=>`calc(${n} * 100vw / 750)`).replace(/(?<![-.\w])page(?=[\s,:{])/g,'body').replace(/\bview\b/g,'div').replace(/\btext(?=[\s,:.{>+#\[])/g,'span');
  const html=`<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>html,body{margin:0}body{--page-bottom-inset:54px;padding-bottom:54px}button,input{border:0}button{width:auto}dice-face{display:inline-block}header{height:44px;display:flex;align-items:center;justify-content:space-between;padding:0 16px;background:#f3f5ef;font:12px sans-serif;color:#5b7066}.preview-nav{position:fixed;bottom:0;left:0;right:0;height:54px;display:flex;background:white;border-top:1px solid #d9e2d6;z-index:30}.preview-nav span{flex:1;display:flex;align-items:center;justify-content:center;font-size:12px;color:#5b7066}.preview-nav .active{color:#205c48;font-weight:bold}.preview-switch{appearance:none;width:45px;height:26px;border-radius:20px;background:#c4cec5;position:relative}.preview-switch:checked{background:#205c48}.preview-switch:before{content:'';position:absolute;left:3px;top:3px;width:20px;height:20px;border-radius:50%;background:white}.preview-switch:checked:before{left:22px}${css}</style><header><span>骰趣 · 静态布局检查</span><span>•••　◉</span></header><main></main><nav class="preview-nav"><span data-page="game">骰宝</span><span data-page="wallet">钱包</span><span data-page="ranking">好友排行</span><span data-page="profile">我的</span></nav><script>const fixtures=${escapeJson(payload)};location.hash=${JSON.stringify(c.name)};${renderScript}</script></html>`;
  fs.writeFileSync(path.join(out,c.name+'.html'),html);
}
const modulePath=process.env.VISUAL_PLAYWRIGHT;
if(!modulePath){console.log('已生成静态布局检查 HTML。设置 VISUAL_PLAYWRIGHT 为 Playwright 模块路径可自动截图。');process.exit(0);}
const {chromium}=await import(pathToFileURL(modulePath));
const browser=await chromium.launch({headless:true,...(process.env.VISUAL_BROWSER?{executablePath:process.env.VISUAL_BROWSER}:{})});
const findings=[];
try{
  for(const width of [390,320]){
    const p=await browser.newPage({viewport:{width,height:844},deviceScaleFactor:1,reducedMotion:'reduce'});
    for(const c of cases){
      const errors=[];const onError=e=>errors.push(e.message);p.on('pageerror',onError);
      await p.goto(pathToFileURL(path.join(out,c.name+'.html')).href);
      await p.waitForSelector('html[data-ready="true"]',{timeout:5000}).catch(e=>{throw Error(`${c.name}: ${errors.join('; ')||e.message}`);});
      const overflow=await p.evaluate(()=>document.documentElement.scrollWidth>innerWidth+1);
      await p.screenshot({path:path.join(out,`${c.name}-${width}.png`)});
      await p.screenshot({path:path.join(out,`${c.name}-${width}-full.png`),fullPage:true});
      findings.push({fixture:c.name,width,horizontalOverflow:overflow,errors});p.off('pageerror',onError);
    }
    await p.close();
  }
}finally{await browser.close();}
fs.writeFileSync(path.join(out,'report.json'),JSON.stringify({renderer:'Chromium CSS proxy, not WeChat',findings},null,2));
console.log(JSON.stringify({screenshots:findings.length,failures:findings.filter(v=>v.horizontalOverflow||v.errors.length)},null,2));
if(findings.some(v=>v.horizontalOverflow||v.errors.length))process.exitCode=1;
