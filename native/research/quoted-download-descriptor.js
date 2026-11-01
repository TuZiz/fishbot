// Research-only allocation/copy/destruction. Does not create or start a task.
// Call only in our matched native coroutine after exact message/MD5 checks.
let quotedTaskLease = null;
function buildQuotedDescriptor(model, kind, futurePair) {
  if (kind !== 2 && kind !== 3) throw Error('Thumbnail downloads prohibited');
  const image = zero(0x348), transfer = zero(0xe8), descriptor = zero(0x178), metadata = zero(16);
  const options = zero(0x30);
  // 181d480 consumes only the tag for mode 1, deriving the destination from
  // the real model. Mode 2 would require a caller-owned path object; never use.
  options.writeU32(1);
  let imageBuilt = false, transferBuilt = false, descriptorBuilt = false;
  const modelPair = zero(16), taskPair = zero(16);
  let modelOwned = false, taskOwned = false;
  const report = {kind, phase: 'metadata-copy', imagePresent: false, descriptorPresent: false, released: false, downloads: 0};
  try {
    // 3a5e910 takes shared_ptr BY VALUE and destroys that argument. Never pass
    // the borrowed model field: use native atomic shared_ptr assignment first.
    const copy = native(0x7554cc0, 'pointer', ['pointer', 'pointer']);
    if (!copy(metadata, model.add(0x288)).equals(metadata)) throw Error('Metadata copy ABI mismatch');
    report.phase = 'select-resource';
    const select = native(0x3a5e910, 'pointer', ['pointer', 'pointer', 'uint']);
    if (!select(image, metadata, kind).equals(image)) throw Error('Photo selector ABI mismatch');
    imageBuilt = image.add(0x340).readU8() === 1;
    report.imagePresent = imageBuilt;
    if (!imageBuilt) return report;
    report.phase = 'transfer-context';
    const context = native(0x181d480, 'pointer', ['pointer', 'pointer', 'uint', 'pointer']);
    if (!context(transfer, model, kind, options).equals(transfer)) throw Error('Transfer context ABI mismatch');
    transferBuilt = true;
    report.phase = 'description';
    const describe = native(0x37f7650, 'pointer', ['pointer', 'pointer', 'uint', 'pointer']);
    if (!describe(descriptor, transfer, kind, image).equals(descriptor)) throw Error('Descriptor ABI mismatch');
    descriptorBuilt = descriptor.add(0x170).readU8() === 1;
    report.descriptorPresent = descriptorBuilt;
    if (descriptorBuilt && descriptorConfig.constructTask) {
      report.phase = 'task-construction';
      // Native aliasing shared_ptr: retain the future which owns wrapper+model,
      // then use its interior model as the alias. No invented control block.
      copy(modelPair, futurePair); modelOwned = true;
      modelPair.writePointer(model);
      const makeTask = native(0x3a5cf00, 'pointer', ['pointer', 'pointer', 'pointer', 'uint', 'uint', 'pointer']);
      if (!makeTask(taskPair, descriptor, modelPair, kind, 1, options).equals(taskPair)) throw Error('Task constructor ABI mismatch');
      taskOwned = !taskPair.add(8).readPointer().isNull();
      const task = taskPair.readPointer(), owner = taskPair.add(8).readPointer();
      if (!taskOwned || !task.equals(owner.add(16)) || !owner.readPointer().equals(module.base.add(0x96fe348)) ||
          !task.readPointer().equals(module.base.add(0x9ad0278))) throw Error('Task class mismatch');
      report.taskIdentityMatched = task.add(0x248).readPointer().equals(model) &&
        task.add(0x250).readPointer().equals(futurePair.add(8).readPointer()) &&
        task.add(0x258).readU32() === kind &&
        task.add(0x2f0).readU64().compare(uint64(expected.serverId)) === 0;
      if (!report.taskIdentityMatched) throw Error('Task identity mismatch');
      report.taskConstructed = true;
      if (descriptorConfig.startDownload) {
        // Only the normal virtual start path. Never call the resume/CDN layer.
        if (quotedTaskLease) throw Error('Single-download lease already occupied');
        quotedTaskLease = {pair: taskPair, started: false, canceled: false};
        taskOwned = false;
        report.phase = 'start-task';
        native(0x2a5ad80, 'void', ['pointer'])(task);
        quotedTaskLease.started = true;
        report.downloads = 1;
      }
    }
    report.phase = 'complete';
    return report;
  } catch (_) {
    report.failed = true;
    return report;
  } finally {
    if (taskOwned) release(taskPair);
    if (modelOwned) release(modelPair);
    if (descriptorBuilt) native(0x186c330, 'void', ['pointer'])(descriptor);
    if (transferBuilt) native(0x181df70, 'void', ['pointer'])(transfer);
    if (imageBuilt) native(0x16639c0, 'void', ['pointer'])(image);
    report.released = true;
  }
}
function quotedTaskStatus() {
  if (!quotedTaskLease) return {started: false, complete: false};
  const task = quotedTaskLease.pair.readPointer();
  return {started: quotedTaskLease.started, canceled: quotedTaskLease.canceled,
    active: task.add(0x128).readU8() === 1,
    complete: task.add(0x129).readU8() === 1,
    resultCode: task.add(0x210).readS32()};
}
function cancelQuotedTask() {
  if (!quotedTaskLease || quotedTaskStatus().complete) return;
  native(0x2a5b560, 'void', ['pointer'])(quotedTaskLease.pair.readPointer());
  quotedTaskLease.canceled = true;
}
function releaseQuotedTask() {
  if (!quotedTaskLease) return;
  const state = quotedTaskStatus();
  if (state.started && !state.complete && !state.canceled) throw Error('Active download must be canceled in native context');
  release(quotedTaskLease.pair);
  quotedTaskLease = null;
}
