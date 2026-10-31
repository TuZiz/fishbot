"""One native text test to the preselected self memo only. No production adapter or retries."""
import hashlib
import json
import os
import sys
import time
from pathlib import Path

sys.path.insert(0, os.path.abspath('../.tools/hook-research'))
import frida
import pefile

if sys.argv[1:] != ['--execute-self-test']:
    raise SystemExit('Disabled by default. Requires --execute-self-test and an observed synthetic warmup.')
root = Path('data/research/native')
meta = json.loads((root / 'process-metadata.json').read_text(encoding='utf-8-sig'))
target = json.loads((root / 'test-target.json').read_text(encoding='utf-8-sig'))
observed = json.loads((root / 'message-layout-observation.json').read_text())
if meta['version'] != '4.2.0.12' or not any(r.get('controllerTargetMatched') and r.get('targetOffsets') == [176] for r in observed.get('records', [])):
    raise RuntimeError('Version or recipient layout has not been verified')
with open(meta['module'], 'rb') as source:
    if hashlib.file_digest(source, 'sha256').hexdigest() != '2b3677c3f932daaa4ef84c8b2acd0aee12cbe5a779ff9e740c370761e5c291ce':
        raise RuntimeError('Unsupported module fingerprint')
warmup = 'FishBot_Warmup_I1031'
text = 'FishBot_Native_J1031'
pe = pefile.PE(meta['module'], fast_load=True)
sites = [0x27f80, 0x1adc0, 0x3ec5f70, 0x1c48c00, 0x3e863e0, 0x76ae350]
config = {'target': list(target['conversationId'].encode()), 'warmup': list(warmup.encode()), 'marker': list(text.encode()), 'text': text,
          'sites': [{'rva': rva, 'prologue': pe.get_data(rva, 16).hex()} for rva in sites]}
agent = Path('native/research/native-self-test.js').read_text().replace('CONFIG', json.dumps(config), 1)
session = None
script = None
result = {'attempted': False, 'deliveryVerified': False, 'oneAttemptOnly': True}
try:
    session = frida.attach(meta['pid'])
    script = session.create_script(agent)
    script.on('message', lambda message, data: print(json.dumps(message), flush=True))
    script.load()
    for _ in range(150):
        time.sleep(1)
        result.update(script.exports_sync.snapshot())
        if result['attempted'] or result.get('error'):
            time.sleep(2)
            result.update(script.exports_sync.snapshot())
            break
finally:
    if script:
        try:
            script.exports_sync.dispose()
            script.unload()
        except Exception as error:
            result['cleanupError'] = type(error).__name__
    if session:
        try:
            session.detach()
        except Exception as error:
            result['detachError'] = type(error).__name__
    (root / 'native-send-probe.json').write_text(json.dumps(result, indent=2), encoding='utf-8')
    print(json.dumps(result), flush=True)
