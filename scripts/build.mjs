import {build} from 'esbuild';
import {cp,mkdir,readdir,readFile,writeFile} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const src=path.join(root,'apps/miniprogram'),out=path.join(root,'dist/miniprogram');
await mkdir(out,{recursive:true});
async function copyAssets(from,to){
  await mkdir(to,{recursive:true});
  for(const entry of await readdir(from,{withFileTypes:true})){
    const a=path.join(from,entry.name),b=path.join(to,entry.name);
    if(entry.isDirectory())await copyAssets(a,b);
    else if(!/\.(ts|js|map)$/.test(entry.name))await cp(a,b);
  }
}
await copyAssets(src,out);
// 一个 API bundle 实例共享 Store，避免每个页面独立打包导致演示存储快照互相覆盖。
const shared=path.join(src,'services/api.ts');
const entries=['services/api.ts','app.ts','components/dice/index.ts',...['game','wallet','ranking','profile'].map(p=>`pages/${p}/index.ts`)];
for(const entry of entries){
  const entryPath=path.join(src,entry);
  await build({entryPoints:[entryPath],outfile:path.join(out,entry.replace(/\.ts$/,'.js')),bundle:true,platform:'browser',format:'cjs',target:'es2018',minify:false,
    plugins:entry==='services/api.ts'?[]:[{name:'shared-api',setup(builder){builder.onResolve({filter:/(?:^|\/)api$/},args=>{
      if(path.resolve(args.resolveDir,args.path+'.ts')!==shared)return;
      let relative=path.relative(path.dirname(entryPath),shared).replaceAll('\\','/').replace(/\.ts$/,'');
      if(!relative.startsWith('.'))relative='./'+relative;
      return {path:relative,external:true};
    });}}]
  });
}
const tdesign=path.join(root,'node_modules/tdesign-miniprogram/miniprogram_dist');
for(const dir of ['button','loading','icon','common'])await copyAssets(path.join(tdesign,dir),path.join(out,'miniprogram_npm/tdesign-miniprogram',dir));
for(const component of ['button','loading','icon'])await build({entryPoints:[path.join(tdesign,component,component+'.js')],outfile:path.join(out,'miniprogram_npm/tdesign-miniprogram',component,component+'.js'),bundle:true,platform:'browser',format:'cjs',target:'es2018',minify:true});
await cp(path.join(root,'node_modules/tdesign-miniprogram/LICENSE'),path.join(out,'miniprogram_npm/tdesign-miniprogram/LICENSE'));
const cloudOut=path.join(root,'dist/cloudfunctions/gameApi');
await mkdir(cloudOut,{recursive:true});
await build({entryPoints:[path.join(root,'services/game-api/src/entry.ts')],outfile:path.join(cloudOut,'index.js'),bundle:true,platform:'node',format:'cjs',target:'node22',external:['@cloudbase/node-sdk','wx-server-sdk']});
const version=async name=>JSON.parse(await readFile(path.join(root,'node_modules',name,'package.json'),'utf8')).version;
await writeFile(path.join(cloudOut,'package.json'),JSON.stringify({name:'game-api',version:'1.0.0',main:'index.js',dependencies:{'@cloudbase/node-sdk':await version('@cloudbase/node-sdk'),'wx-server-sdk':await version('wx-server-sdk')}},null,2));
await writeFile(path.join(cloudOut,'config.json'),JSON.stringify({permissions:{openapi:['security.msgSecCheck']}},null,2));
console.log('已生成 dist/miniprogram 和 dist/cloudfunctions/gameApi。未部署云资源。');
