// Research only: inspect TLS context inside our own empty native operation.
// Optional single DB-verified query runs only inside the matching native task.
// No message construction, download or application callback is scheduled.
const config = CONFIG, expected = EXPECTED, module = Process.getModuleByName('Weixin.dll');
const descriptorConfig = DESCRIPTOR_CONFIG;
if (Process.arch !== 'x64') throw Error('Unsupported architecture');
const sites = [0x19b9d10, 0x1949550, 0xf910, 0x7554c70, 0x19e5f00, 0x19e66c0, 0x49f2f0];
if (expected) sites.push(0x391a010);
if (descriptorConfig) sites.push(...descriptorConfig.sites);
if (Object.keys(config).length !== sites.length) throw Error('Unexpected fingerprint set');
for (const rva of sites) {
  const actual = Array.from(new Uint8Array(module.base.add(rva).readByteArray(16)), b => b.toString(16).padStart(2, '0')).join('');
  if (config[`0x${rva.toString(16)}`] !== actual) throw Error('Runtime fingerprint mismatch');
}
const native = (rva, ret, args) => new NativeFunction(module.base.add(rva), ret, args);
const make = native(0x19b9d10, 'pointer', ['pointer', 'pointer', 'pointer']);
const destroy = native(0x1949550, 'pointer', ['pointer', 'uint']);
const contextNew = native(0xf910, 'pointer', Array(6).fill('pointer'));
const release = native(0x7554c70, 'void', ['pointer']);
const execute = native(0x19e5f00, 'void', ['pointer', 'pointer']);
const currentContext = native(0x49f2f0, 'pointer', ['pointer']);
const zero = n => { const p = Memory.alloc(n); p.writeByteArray(new Uint8Array(n)); return p; };
const vector = zero(24), output = zero(0x58), context = zero(240);
const callbacks = [zero(64), zero(64), zero(64)], cancel = zero(16);
let hook = null, operation = null, contextBuilt = false, started = false, disposed = false;
let matched = false, completed = false, taskContext = null, failure = null;
const queryPair = zero(16), peer = zero(32);
let peerBytes = null, queryReturned = false;
let descriptorResult = null;
let phase = 'idle';
function queryReference() {
  phase = 'query';
  if (!taskContext?.present || taskContext.state !== 1) throw Error('Query requires native task context');
  peerBytes = Memory.allocUtf8String(expected.conversationId);
  peer.writePointer(peerBytes);
  peer.add(16).writeU64(expected.conversationId.length);
  peer.add(24).writeU64(expected.conversationId.length);
  const query = native(0x391a010, 'pointer', ['pointer', 'pointer', 'pointer', 'uint64', 'uint']);
  if (!query(ptr(0), queryPair, peer, uint64(expected.serverId), 0).equals(queryPair)) throw Error('Query ABI mismatch');
  queryReturned = true;
  phase = 'query-complete';
}
function describeReference() {
  if (!taskContext?.present || taskContext.state !== 1) throw Error('Descriptor requires native context');
  if (descriptorConfig) {
    phase = 'verify-photo';
    const checked = queryResult();
    if (!checked?.identityMatched || !checked.md5Matched) throw Error('Descriptor requires verified photo');
    const kind = checked.resources.find(r => r.kind === 3 && r.available)?.kind ??
      checked.resources.find(r => r.kind === 2 && r.available)?.kind;
    if (!kind) throw Error('No non-thumbnail photo resource');
    const model = queryState().add(0xb8).readPointer().add(8);
    phase = 'describe-photo';
    descriptorResult = buildQuotedDescriptor(model, kind, queryPair);
  }
  phase = 'descriptor-complete';
}
function queryState() {
  const state = queryPair.readPointer(), owner = queryPair.add(8).readPointer();
  if (state.isNull() || owner.isNull() || !state.equals(owner.add(16)) || !owner.readPointer().equals(module.base.add(0x8f52418))) throw Error('Query ownership mismatch');
  return state;
}
function exact(address, text) {
  const length = address.add(16).readU64().toNumber(), capacity = address.add(24).readU64().toNumber();
  return length === text.length && capacity >= length && capacity <= 32768 &&
    (capacity < 16 ? address : address.readPointer()).readUtf8String(length) === text;
}
function queryResult() {
  if (!queryReturned) return null;
  const state = queryState(), status = state.add(0xc4).readU32();
  if (status !== 1) return { complete: status !== 0, status, identityMatched: false };
  const wrapper = state.add(0xb8).readPointer();
  if (wrapper.isNull() || !wrapper.readPointer().equals(module.base.add(0x96e3318))) throw Error('Unexpected query result');
  const model = wrapper.add(8), present = model.add(0x2e8).readU8();
  if (present > 1) throw Error('Invalid optional message');
  if (!present) return { complete: true, status, found: false, identityMatched: false };
  const vtableMatched = model.readPointer().equals(module.base.add(0x8f71468));
  const typeMatched = model.add(12).readU32() === 3;
  const scopeMatched = [0x18, 0x38].some(o => exact(model.add(o), expected.conversationId));
  const senderMatched = [0x18, 0x38, 0x58].some(o => exact(model.add(o), expected.senderId));
  const serverMatched = model.add(0x148).readU64().compare(uint64(expected.serverId)) === 0;
  const localMatched = model.add(0x144).readU32() === expected.localId;
  const identityMatched = vtableMatched && typeMatched && scopeMatched && senderMatched && serverMatched && localMatched;
  const result = { complete: true, status, found: true, vtableMatched, typeMatched, scopeMatched, senderMatched, serverMatched, localMatched, identityMatched };
  if (identityMatched) {
    const metadata = model.add(0x288).readPointer(), metadataOwner = model.add(0x290).readPointer();
    result.metadataPresent = !metadata.isNull() && !metadataOwner.isNull();
    if (result.metadataPresent) {
      const vtable = metadata.readPointer();
      if (vtable.compare(module.base) < 0 || vtable.compare(module.base.add(module.size)) >= 0) throw Error('Metadata vtable outside module');
      result.metadataVtableRva = vtable.sub(module.base).toString();
      result.metadataClassMatched = vtable.equals(module.base.add(0x90a1f88));
      if (!result.metadataClassMatched) return result;
      result.md5Matched = exact(metadata.add(0x248), expected.md5);
      // XML parser 2303600 + download selector 37f4770 establish this map.
      // Read sizes only; never return URLs, AES keys or cache paths.
      result.resources = [
        { kind: 1, name: 'thumbnail', field: 0x2b8 },
        { kind: 2, name: 'normal', field: 0x290 },
        { kind: 3, name: 'original', field: 0x268 }
      ].map(({ kind, name, field }) => {
        const length = metadata.add(field + 16).readU64().toNumber(), capacity = metadata.add(field + 24).readU64().toNumber();
        if (!Number.isSafeInteger(length) || capacity < length || capacity > 32768) throw Error('Invalid photo resource layout');
        return { kind, name, available: length > 0 };
      });
    }
  }
  return result;
}
function inspectContext() {
  const pair = zero(16);
  let owned = false;
  try {
    if (!currentContext(pair).equals(pair)) throw Error('TLS getter ABI mismatch');
    const object = pair.readPointer(), owner = pair.add(8).readPointer();
    owned = !owner.isNull();
    if (object.isNull() !== owner.isNull()) throw Error('TLS ownership mismatch');
    const result = { present: !object.isNull(), owned };
    if (owned) {
      if (!object.equals(owner.add(16)) || !owner.readPointer().equals(module.base.add(0x8fe22e8))) throw Error('Unexpected coroutine ownership');
      result.state = object.add(0x388).readU32();
    }
    return result;
  } finally { if (owned) release(pair); }
}
function cleanup() {
  if (descriptorConfig?.startDownload) releaseQuotedTask();
  if (hook) { hook.detach(); hook = null; Interceptor.flush(); }
  if (queryReturned) { queryState(); release(queryPair); queryReturned = false; }
  if (operation) { destroy(operation, 1); operation = null; }
  if (contextBuilt) { release(context); contextBuilt = false; }
  disposed = true;
}
rpc.exports = {
  start() {
    if (started || disposed) throw Error('Single-use probe');
    started = true;
    const baseline = inspectContext();
    try {
      if (!make(ptr(0), output, vector).equals(output)) throw Error('Empty factory ABI mismatch');
      operation = output.add(0x38).readPointer();
      if (operation.isNull() || !operation.readPointer().equals(module.base.add(0x92ea088)) ||
          ![8, 16, 24].every(o => operation.add(o).readPointer().isNull())) throw Error('Operation is not empty');
      if (!contextNew(context, ...callbacks, cancel, ptr(0)).equals(context)) throw Error('Context ABI mismatch');
      contextBuilt = true;
      if (context.readPointer().isNull() || context.add(8).readPointer().isNull()) throw Error('Empty context unavailable');
      const expectedObject = context.readPointer(), expectedOwner = context.add(8).readPointer();
      hook = Interceptor.attach(module.base.add(0x19e66c0), {
        onEnter(args) {
          this.ours = false;
          if (matched) return;
          const task = args[0];
          try {
            if (!task.readPointer().equals(module.base.add(0x92ea168)) ||
                ![8, 16, 24].every(o => task.add(o).readPointer().isNull()) ||
                !task.add(0x20).readPointer().equals(expectedObject) ||
                !task.add(0x28).readPointer().equals(expectedOwner)) return;
            matched = true; this.ours = true;
            taskContext = inspectContext();
            if (phase === 'cancel-scheduled') { cancelQuotedTask(); phase = 'cancel-complete'; return; }
            if (expected) {
              if (queryReturned) describeReference(); else queryReference();
            }
          } catch (_) { failure = expected ? 'Native task query failed; no retry' : 'Context inspection failed'; }
        },
        onLeave() { if (this.ours) completed = true; }
      });
      Interceptor.flush();
      execute(operation, context);
      return { scheduled: true, baseline, messageCount: 0, downloads: 0, queryRequested: !!expected, sends: 0 };
    } catch (error) { cleanup(); throw error; }
  },
  describe() {
    if (!descriptorConfig || !completed || descriptorResult || phase !== 'query-complete') throw Error('Descriptor phase unavailable');
    const checked = queryResult();
    if (!checked?.identityMatched || !checked.md5Matched) throw Error('Photo not ready for descriptor');
    matched = false; completed = false; phase = 'descriptor-scheduled';
    execute(operation, context);
    return {scheduled: true, downloads: 0};
  },
  downloadStatus() { return quotedTaskStatus(); },
  cancelDownload() {
    const state = quotedTaskStatus();
    if (!state.started || state.complete) return {needed: false};
    if (!completed) throw Error('Cannot cancel while descriptor callback is executing');
    matched = false; completed = false; phase = 'cancel-scheduled';
    execute(operation, context);
    return {scheduled: true};
  },
  status() { return { matched, completed, taskContext, phase, query: completed ? queryResult() : null, descriptor: descriptorResult, failure }; },
  dispose() { cleanup(); return { disposed, hookRemoved: hook === null, operationReleased: operation === null, contextReleased: !contextBuilt, queryReleased: !queryReturned }; }
};
