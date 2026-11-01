// Read-only, content-free inspection of the two authorized test conversations.
import 'dotenv/config';
import {DatabaseSync} from 'node:sqlite';
import {imageIntent} from '../dist/images/intent.js';
const db=new DatabaseSync(process.env.NATIVE_DB_PATH??'data/fishbot-native.sqlite',{readOnly:true});
try{
 const records=[];
 for(const group of [process.env.FISHBOT_TEST_GROUP_ID,process.env.FISHBOT_TEST_GROUP_2_ID].filter(Boolean)){
  const scope=JSON.stringify(['group',group]);
  for(const row of db.prepare("SELECT body FROM messages WHERE scope=? AND json_type(body,'$.quote')='object' ORDER BY rowid DESC LIMIT 3").all(scope)){
   const m=JSON.parse(row.body);
   const outgoing=db.prepare('SELECT kind,status,attempts FROM outbox WHERE scope=? AND incoming IN (?,?,?)').all(scope,m.id,m.id+':image-wait',m.id+':image');
   records.push({incomingId:m.id,timestamp:m.timestamp,quoteType:m.quote?.type,mentioned:!!m.mentionedBot,editingRecognized:imageIntent(m.text,m.quote?.type===3||!!m.quote?.image)?.edit===true,outgoing});
  }
 }
 console.log(JSON.stringify({readOnly:true,records}));
}finally{db.close();}
