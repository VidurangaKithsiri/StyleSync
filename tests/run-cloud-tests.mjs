import {spawnSync} from 'node:child_process';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
const root=path.resolve(import.meta.dirname,'..');
const temp=mkdtempSync(path.join(tmpdir(),'shoplink-cloud-test-'));
try{
 const env={...process.env,DATABASE_URL:'postgresql://test:test@localhost/test',SUPABASE_URL:'https://storage.example.test',SUPABASE_SERVICE_ROLE_KEY:'test-server-key',TEST_PG_DIR:path.join(temp,'pg'),TEST_STORAGE_DIR:path.join(temp,'images')};
 const preload=path.join(root,'tests/cloud-preload.mjs');
 // NODE_OPTIONS propagates the test adapters to the HTTP server subprocess too.
 env.NODE_OPTIONS=`--import=${JSON.stringify(preload)}`;
 for(const file of ['tests/integration.test.mjs','tests/cloud-persistence.test.mjs']){
  const r=spawnSync(process.execPath,['--test',file],{cwd:root,env,stdio:'inherit'});if(r.status!==0)process.exitCode=1;
 }
}finally{rmSync(temp,{recursive:true,force:true})}
