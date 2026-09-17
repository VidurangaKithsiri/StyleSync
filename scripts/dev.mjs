import {spawn} from 'node:child_process';
const children=[spawn(process.execPath,['server/index.mjs'],{stdio:'inherit'}),spawn(process.execPath,['node_modules/vite/bin/vite.js','--host','127.0.0.1'],{stdio:'inherit'})];
let closing=false;const stop=()=>{if(closing)return;closing=true;for(const c of children)c.kill()};
for(const c of children)c.on('exit',stop);
process.on('SIGINT',stop);process.on('SIGTERM',stop);
