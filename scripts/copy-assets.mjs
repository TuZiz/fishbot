import {cp,mkdir} from 'node:fs/promises';
await mkdir('dist/admin',{recursive:true});
for(const name of ['index.html','admin.js','admin.css'])await cp(`src/admin/${name}`,`dist/admin/${name}`);
