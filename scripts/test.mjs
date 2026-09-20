import {build} from 'esbuild';
import {readdir,mkdir} from 'node:fs/promises';
import {spawnSync} from 'node:child_process';
await mkdir('.test-build',{recursive:true});
const files=(await readdir('tests')).filter(f=>f.endsWith('.test.ts'));
for(const file of files)await build({entryPoints:['tests/'+file],outfile:'.test-build/'+file.replace(/\.ts$/,'.cjs'),bundle:true,platform:'node',format:'cjs',target:'node22',external:['@cloudbase/node-sdk','wx-server-sdk']});
const result=spawnSync(process.execPath,['--test',...files.map(f=>'.test-build/'+f.replace(/\.ts$/,'.cjs'))],{stdio:'inherit'});
process.exitCode=result.status??1;
