"""Inspect one empty native task; optional single verified reference query, no download.

No queued JS/NativeCallback is created. The temporary interceptor only matches
the empty vector and context pair created by this probe. Timeout detaches it;
the remaining native task owns its native context without script callbacks.
"""
import os
import argparse
import hashlib
import json
import re
from pathlib import Path
import sys
import time

p = argparse.ArgumentParser(description=__doc__)
p.add_argument('--root', required=True)
p.add_argument('--dependencies', required=True)
p.add_argument('--fingerprints', required=True)
p.add_argument('--output', required=True)
p.add_argument('--agent', required=True)
p.add_argument('--query-reference', metavar='IDENTITY_JSON', help='Query one verified photo only inside the matched native task, never RPC')
p.add_argument('--descriptor-agent', help='Construct and release a description only; no task or download')
p.add_argument('--construct-task', action='store_true', help='Construct/release one task without starting it')
p.add_argument('--start-download', action='store_true', help='Start only the one verified photo task, never send or call image API')
args = p.parse_args()
expected = None
if args.query_reference:
    expected = json.loads(Path(args.query_reference).read_text(encoding='utf-8-sig'))
    if (expected.get('conversationId') not in ({os.environ.get('FISHBOT_TEST_GROUP_ID', ''), os.environ.get('FISHBOT_TEST_GROUP_2_ID', '')} - {''})
            or not re.fullmatch(r'[1-9][0-9]{0,18}', str(expected.get('serverId', '')))
            or int(expected['serverId']) > 9223372036854775807
            or type(expected.get('localId')) is not int or not 0 < expected['localId'] <= 0xffffffff
            or not isinstance(expected.get('senderId'), str)
            or not re.fullmatch(r'[A-Za-z0-9_@.-]{1,256}', expected['senderId'])
            or not isinstance(expected.get('md5'), str) or not re.fullmatch(r'[a-f0-9]{32}', expected['md5'])):
        raise RuntimeError('Invalid verified quoted photo identity')
profile = json.loads((Path(args.root) / 'cloud-profile.json').read_text(encoding='utf-8-sig'))
if hashlib.sha256(Path(profile['module']).read_bytes()).hexdigest() != 'e0428a7b691853de496532523c2c09aa095f90941c37c9f4cfb3f137f3c66556':
    raise RuntimeError('Unsupported task context DLL fingerprint')
fingerprints = json.loads(Path(args.fingerprints).read_text(encoding='utf-8-sig'))
descriptor_config = None
descriptor_source = ''
if args.construct_task and not args.descriptor_agent:
    raise RuntimeError('Task construction requires descriptor agent')
if args.start_download and not args.construct_task:
    raise RuntimeError('Download requires explicit task construction')
if args.descriptor_agent:
    if not expected:
        raise RuntimeError('Descriptor requires verified photo identity')
    descriptor_config = {'sites': [0x3a5e910, 0x181d480, 0x37f7650, 0x186c330, 0x181df70, 0x16639c0, 0x7554cc0]}
    descriptor_config['constructTask'] = args.construct_task
    descriptor_config['startDownload'] = args.start_download
    if args.construct_task:
        descriptor_config['sites'].append(0x3a5cf00)
    if args.start_download:
        descriptor_config['sites'].extend([0x2a5ad80, 0x2a5b560])
    descriptor_source = Path(args.descriptor_agent).read_text(encoding='utf-8')
source = Path(args.agent).read_text(encoding='utf-8').replace('DESCRIPTOR_CONFIG', json.dumps(descriptor_config)).replace('CONFIG', json.dumps(fingerprints)).replace('EXPECTED', json.dumps(expected)) + '\n' + descriptor_source
sys.path.insert(0, args.dependencies)
import frida

report = {'mode': 'empty-task-context', 'queries': 0, 'downloads': 0, 'sends': 0, 'paidRequests': 0, 'automaticDownloadVerified': False}
if expected:
    report['mode'] = 'task-quoted-query'
session = frida.attach(profile['pid'])
script = None
failed = False
try:
    script = session.create_script(source)
    script.load()
    report['start'] = script.exports_sync.start()
    deadline = time.monotonic() + 15
    descriptor_scheduled = False
    while True:
        report['result'] = script.exports_sync.status()
        query_done = not expected or bool(report['result']['query'] and report['result']['query']['complete'])
        if descriptor_config and not descriptor_scheduled and report['result']['completed'] and query_done and not report['result']['failure']:
            report['descriptorStart'] = script.exports_sync.describe()
            descriptor_scheduled = True
            continue
        if (report['result']['completed'] and query_done) or report['result']['failure'] or time.monotonic() >= deadline:
            break
        time.sleep(0.1)
    failed = not report['result']['completed'] or bool(report['result']['failure'])
    task_context = report['result'].get('taskContext') or {}
    failed = failed or not (task_context.get('present') and task_context.get('owned') and task_context.get('state') == 1)
    if expected:
        report['queries'] = int(report['result']['matched'])
        failed = failed or not bool(report['result']['query'] and report['result']['query'].get('identityMatched') and report['result']['query'].get('md5Matched'))
    if descriptor_config:
        descriptor = report['result'].get('descriptor') or {}
        failed = failed or bool(descriptor.get('failed')) or not (descriptor.get('imagePresent') and descriptor.get('descriptorPresent') and descriptor.get('released'))
        if args.construct_task:
            failed = failed or not (descriptor.get('taskConstructed') and descriptor.get('taskIdentityMatched'))
    if args.start_download and not failed:
        download_deadline = time.monotonic() + 35
        while True:
            report['download'] = script.exports_sync.download_status()
            if report['download'].get('complete') or time.monotonic() >= download_deadline:
                break
            time.sleep(0.2)
        report['downloads'] = int(bool(report['download'].get('started')))
        failed = not report['download'].get('complete') or report['download'].get('resultCode') != 0
except Exception as error:
    failed = True
    report['failure'] = 'Native task context probe failed; no retry'
    # Only the exception class and agent line numbers, never its raw message
    # (Frida errors can include process addresses or sensitive arguments).
    report['errorType'] = type(error).__name__
    report['agentLines'] = re.findall(r'/script\d*\.js:(\d+)', str(error))[:8]
finally:
    try:
        if script is not None:
            try:
                if args.start_download:
                    report['cancel'] = script.exports_sync.cancel_download()
                    cancel_deadline = time.monotonic() + 8
                    while not script.exports_sync.status()['completed'] and time.monotonic() < cancel_deadline:
                        time.sleep(0.1)
                report['cleanup'] = script.exports_sync.dispose()
            except Exception:
                failed = True
                report['cleanup'] = {'failed': True}
            script.unload()
    finally:
        session.detach()
        report['failed'] = failed
        Path(args.output).write_text(json.dumps(report, indent=2) + '\n', encoding='utf-8')
        print(json.dumps(report), flush=True)
if failed:
    raise SystemExit(1)
