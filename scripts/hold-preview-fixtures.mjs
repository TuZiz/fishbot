// Temporarily hide only our synthetic originals so preview must read WeChat's cached copy.
import {rename,access} from 'node:fs/promises';
import {resolve,dirname} from 'node:path';
const root=resolve('data'),restore=process.argv.includes('--restore');let count=0;
for(const name of ['native-gradient-test.png','windowless-gradient-test.png']){
 const path=resolve(root,name),held=path+'.probe-hold';if(dirname(path)!==root)throw Error('Invalid fixture path');
 const from=restore?held:path,to=restore?path:held;
 if(!await access(from).then(()=>true,()=>false))continue;
 if(await access(to).then(()=>true,()=>false))throw Error('Fixture destination already exists');
 await rename(from,to);count++;
}
console.log(JSON.stringify({syntheticOnly:true,restored:restore,count}));
