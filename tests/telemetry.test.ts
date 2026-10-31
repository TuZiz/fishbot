import test from 'node:test';
import assert from 'node:assert/strict';
import { Store } from '../src/storage/store.js';
import { Telemetry } from '../src/monitoring/telemetry.js';
test('telemetry aggregates returned usage without persisting arbitrary error payloads',()=>{
 const s=new Store(':memory:'),t=new Telemetry(s);t.usage({total_tokens:15});t.usage({total_tokens:20});t.error(new Error('secret arbitrary response'),'test');const data=t.snapshot();assert.equal(data.totals!.tokens,35);assert.equal(data.errors[0]!.message,'Error');s.close();
});
