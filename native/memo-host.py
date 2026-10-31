"""Local JSON-lines Frida host. Experimental memo only; stdout never contains chat text or keys."""
import hashlib
import json
import os
import subprocess
import sys
from pathlib import Path

sys.stdin.reconfigure(encoding='utf-8')
sys.stdout.reconfigure(encoding='utf-8')

root = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(root.parent / '.tools/hook-research'))
import frida
import pefile

EXPECTED = '2b3677c3f932daaa4ef84c8b2acd0aee12cbe5a779ff9e740c370761e5c291ce'

def emit(value):
    print(json.dumps(value), flush=True)


def diagnostic(value):
    # Local ignored diagnostic file: no request text, target ID, keys or raw messages.
    with (root / 'data/research/native/memo-bridge-events.jsonl').open('a', encoding='utf-8') as output:
        output.write(json.dumps(value) + '\n')

def main():
    if sys.argv[1:] != ['--enable-native-memo-test']:
        raise RuntimeError('Explicit memo-test flag required')
    discovery = subprocess.run(['powershell.exe', '-NoProfile', '-NonInteractive', '-File', str(root / 'native/discover-client.ps1')], capture_output=True, check=True, timeout=15)
    discovered = json.loads(discovery.stdout.decode('utf-8-sig'))
    if discovered.get('status') != 'found':
        raise RuntimeError('ClientUnavailable')
    meta = discovered['client']
    target = json.loads((root / 'data/research/native/test-target.json').read_text(encoding='utf-8-sig'))['conversationId']
    if meta['version'] != '4.2.0.12' or not target or target.endswith('@chatroom'):
        raise RuntimeError('Unsupported client or test target')
    with open(meta['module'], 'rb') as source:
        if hashlib.file_digest(source, 'sha256').hexdigest() != EXPECTED:
            raise RuntimeError('Unsupported module fingerprint')
    (root / 'data/research/native/process-metadata.json').write_text(json.dumps(meta, indent=2), encoding='utf-8')
    pe = pefile.PE(meta['module'], fast_load=True)
    sites = [0x27f80, 0x1adc0, 0x3ec5f70, 0x1c48c00, 0x3e863e0, 0x76ae350]
    config = {'target': target, 'targetBytes': list(target.encode()), 'warmupBytes': list('FishBot_CONNECT_1031'.encode()), 'ttlMs': 300000,
              'sites': [{'rva': rva, 'prologue': pe.get_data(rva, 16).hex()} for rva in sites]}
    session = frida.attach(meta['pid'])
    script = None
    try:
        script = session.create_script((root / 'native/memo-agent.js').read_text().replace('CONFIG', json.dumps(config), 1))
        def on_message(message, data):
            if message['type'] == 'send':
                if message['payload'].get('event') == 'lifetime-evidence':
                    diagnostic(message['payload'])
                    return
                emit(message['payload'])
            else:
                diagnostic({'event': 'agent-error', 'description': message.get('description'), 'line': message.get('lineNumber'), 'column': message.get('columnNumber')})
                emit({'event': 'agent-error'})
        script.on('message', on_message)
        script.load()
        emit({'event': 'ready', 'experimental': True, 'backend': 'native-memo', 'warmupRequired': True})
        for line in sys.stdin:
            request_id = None
            try:
                request = json.loads(line)
                request_id = request['id']
                if request['op'] == 'stop':
                    break
                if request['op'] == 'status':
                    result = script.exports_sync.status()
                elif request['op'] == 'send':
                    text = request['text']
                    if request.get('target') != target or not isinstance(text, str) or not text.strip() or len(text) > 5000:
                        result = {'attempted': False, 'error': 'Invalid test target or text'}
                    else:
                        result = script.exports_sync.sendtext({'target': target, 'text': text, 'bytes': list(text.encode())})
                else:
                    result = {'attempted': False, 'error': 'Unknown operation'}
                emit({'id': request_id, 'result': result})
            except Exception as error:
                # IPC or process failure after dispatch must be reconciled as unknown by the caller.
                detail = str(error)
                for private in (target, locals().get('text', '')):
                    if private:
                        detail = detail.replace(private, '[redacted]')
                diagnostic({'event': 'command-error', 'type': type(error).__name__, 'detail': detail[:2000]})
                emit({'id': request_id, 'error': 'Native command failed; reconcile before retry'})
    finally:
        if script:
            try:
                script.exports_sync.dispose()
                script.unload()
            finally:
                session.detach()
        else:
            session.detach()

if __name__ == '__main__':
    try:
        main()
    except Exception as error:
        diagnostic({'event': 'fatal', 'type': type(error).__name__})
        emit({'event': 'fatal', 'reason': type(error).__name__})
        sys.exit(1)
