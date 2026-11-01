"""Fingerprint-bound 4.1 research probe. Discovery by default; one explicit filehelper send only."""
import os
import argparse
import base64
import hashlib
import json
import re
from pathlib import Path
import sys
import time

parser = argparse.ArgumentParser()
parser.add_argument('--root', required=True)
parser.add_argument('--dependencies', required=True)
parser.add_argument('--execute-filehelper-test', action='store_true')
parser.add_argument('--json-host', action='store_true')
parser.add_argument('--windowless', action='store_true')
parser.add_argument('--image-construction-probe', metavar='FILE')
parser.add_argument('--image-submit-test', metavar='FILE')
parser.add_argument('--enable-verified-images', action='store_true')
parser.add_argument('--profile', choices=['cloud-profile.json', 'cloud-friend-profile.json', 'cloud-railway-profile.json', 'cloud-all-profile.json'], default='cloud-profile.json')
args = parser.parse_args()
root = Path(args.root)
config = json.loads((root / args.profile).read_text(encoding='utf-8-sig'))
allowed = {target['id'] for target in config['agent']['targets']}
if not allowed or len(allowed)>500 or any(not isinstance(t,str) or not 1<=len(t)<=256 for t in allowed):
    raise RuntimeError('Invalid conversation catalog')
if args.profile!='cloud-all-profile.json' and not allowed.issubset({'filehelper', os.environ.get('FISHBOT_TEST_FRIEND_ID', ''), os.environ.get('FISHBOT_TEST_GROUP_ID', ''), os.environ.get('FISHBOT_TEST_GROUP_2_ID', '')} - {''}):
    raise RuntimeError('Outside authorized test scope')
if hashlib.sha256(Path(config['module']).read_bytes()).hexdigest() != config['sha256']:
    raise RuntimeError('DLL fingerprint changed')
if args.image_construction_probe or args.image_submit_test or args.enable_verified_images:
    if config['sha256'].lower() != 'e0428a7b691853de496532523c2c09aa095f90941c37c9f4cfb3f137f3c66556':
        raise RuntimeError('Image factory requires exact cloud DLL')
    config['agent']['imageFactory'] = {'rva': 0x5ddc8c0, 'vtable': 0x92b2a88, 'sendEnabled': bool(args.image_submit_test or args.enable_verified_images)}
    config['agent']['sites'].append({'rva': 0x5ddc8c0, 'prologue': '55415741565657534881ece802000048'})
sys.path.insert(0, args.dependencies)
import frida

source = (root / 'context-registry.js').read_text() + '\n' + (root / 'memo-agent.js').read_text()
mapping = config['mapping']
for old, new in mapping.items():
    source = source.replace(old, new)
start = source.index(' const getThread=')
end = source.index(' function targetOf', start)
source = source[:start] + '\n const uiThread=1432; if(!Process.enumerateThreads().some(t=>t.id===uiThread))throw Error("Observed UI thread no longer exists");\n' + source[end:]
source = source.replace('CONFIG', json.dumps(config['agent']), 1)
source += '\nrpc.exports.targetstatus=function(){return c.targets.map(t=>({id:t.id,ready:!!contexts.forTarget(t.id)}));};\n'
if args.windowless:
    source = (root / 'windowless-agent.js').read_text().replace('CONFIG', json.dumps(config['agent']), 1)
if args.enable_verified_images:
    source += '\n' + (root / 'cached-image-reader.js').read_text(encoding='utf-8-sig')
download_enabled = args.windowless and args.enable_verified_images and (root / 'quoted-image-download.js').is_file()
if download_enabled:
    if config['sha256'].lower() != 'e0428a7b691853de496532523c2c09aa095f90941c37c9f4cfb3f137f3c66556':
        raise RuntimeError('Quoted download requires exact cloud DLL')
    download_sites = json.loads((root / 'quoted-image-download-fingerprints.json').read_text(encoding='utf-8-sig'))
    source += '\n' + (root / 'quoted-image-task.js').read_text(encoding='utf-8-sig').replace('DOWNLOAD_CONFIG', json.dumps(download_sites), 1)
    source += '\n' + (root / 'quoted-image-download.js').read_text(encoding='utf-8-sig')
session = frida.attach(config['pid'])
script = None
initialized = False
attempted = False
closing = False
session.on('detached', lambda reason, crash: None if closing else print(json.dumps({'event': 'agent-error', 'reason': 'ClientDetached'}), flush=True))
try:
    script = session.create_script(source)
    def on_message(message, data):
        if message.get('type') == 'error':
            print(json.dumps({'event': 'agent-error', 'reason': 'AgentFailure'}), flush=True)
        elif not args.json_host:
            print(json.dumps({'agent': message}), flush=True)
    script.on('message', on_message)
    script.load()
    script.exports_sync.status()
    initialized = True
    if args.json_host:
        print(json.dumps({'event': 'ready'}), flush=True)
        for line in sys.stdin:
            request = json.loads(line)
            if request['op'] == 'stop':
                break
            try:
                if request['op'] == 'status':
                    result = script.exports_sync.status()
                    result['quotedDownloadsSupported'] = download_enabled
                elif request['op'] == 'start-quoted-download':
                    photo = request.get('photo')
                    if (not download_enabled or not isinstance(photo, dict)
                            or photo.get('conversationId') not in allowed
                            or not re.fullmatch(r'[a-f0-9-]{36}', str(photo.get('id', '')))
                            or not re.fullmatch(r'[A-Za-z0-9_@.-]{1,256}', str(photo.get('senderId', '')))
                            or not re.fullmatch(r'[1-9][0-9]{0,18}', str(photo.get('serverId', '')))
                            or int(photo['serverId']) > 9223372036854775807
                            or type(photo.get('localId')) is not int or not 0 < photo['localId'] <= 0xffffffff
                            or not re.fullmatch(r'[a-f0-9]{32}', str(photo.get('md5', '')))):
                        raise ValueError('Invalid verified photo download')
                    result = script.exports_sync.startquoteddownload(photo)
                elif request['op'] in {'quoted-download-status', 'cancel-quoted-download'}:
                    download_id = request.get('downloadId')
                    if not download_enabled or not isinstance(download_id, str) or not re.fullmatch(r'[a-f0-9-]{36}', download_id):
                        raise ValueError('Invalid download operation')
                    result = (script.exports_sync.quoteddownloadstatus(download_id) if request['op'] == 'quoted-download-status'
                              else script.exports_sync.cancelquoteddownload(download_id))
                elif request['op'] == 'send':
                    text = request.get('text')
                    if request.get('target') not in allowed or not isinstance(text, str) or not text.strip() or len(text) > 5000:
                        result = {'attempted': False, 'error': 'Outside explicit filehelper scope'}
                    else:
                        result = script.exports_sync.sendtext({'target': request['target'], 'text': text, 'bytes': list(text.encode())})
                elif request['op'] == 'read-cached-image':
                    result = {}
                    if args.enable_verified_images:
                        storage_value = __import__('os').environ.get('WECHAT_STORAGE_PATH') or Path('data/wechat/storage-path.txt').read_text(encoding='utf-8-sig').strip()
                        cache_root = (Path(storage_value).parent / 'msg' / 'attach').resolve(strict=True)
                        image = Path(request.get('path', '')).resolve(strict=True)
                        expected = request.get('md5', '')
                        if image.is_relative_to(cache_root) and image.suffix.lower()=='.dat' and not image.name.lower().endswith('_t.dat') and image.is_file() and 15<=image.stat().st_size<=20*1024*1024 and isinstance(expected,str) and len(expected)==32 and all(c in '0123456789abcdef' for c in expected):
                            decoded = script.exports_sync.readcachedimage(str(image))
                            if decoded and len(decoded)<=20*1024*1024 and hashlib.md5(decoded).hexdigest()==expected:
                                result = {'base64':base64.b64encode(decoded).decode('ascii')}
                elif request['op'] == 'send-image':
                    image = Path(request.get('path', '')).resolve(strict=True)
                    owned = Path('C:/wx/fishbot/data/generated').resolve()
                    if not args.enable_verified_images or request.get('target') not in allowed or not image.is_relative_to(owned) or not image.is_file():
                        result = {'attempted':False,'error':'Image feature or owned path unavailable'}
                    else:
                        size = image.stat().st_size
                        if not 0<size<=20*1024*1024 or size!=request.get('size') or hashlib.md5(image.read_bytes()).hexdigest()!=request.get('md5'):
                            result = {'attempted':False,'error':'Image file changed before dispatch'}
                        else:
                            result = script.exports_sync.sendimage({'target':request['target'],'imagePath':str(image),'bytes':list(str(image).encode()),'fileSize':size,'probeOnly':False})
                else:
                    raise ValueError('Unsupported operation')
                print(json.dumps({'id': request['id'], 'result': result}), flush=True)
            except Exception:
                print(json.dumps({'id': request['id'], 'error': 'Native outcome unavailable; do not retry'}), flush=True)
        sys.exit(0)
    status = None
    for _ in range(30):
        time.sleep(1)
        status = script.exports_sync.status()
        if status.get('state') != 'discovering':
            break
    print(json.dumps({'status': status, 'targetReadiness': script.exports_sync.targetstatus(), 'activeSendRequested': args.execute_filehelper_test}), flush=True)
    if args.image_construction_probe or args.image_submit_test:
        image = Path(args.image_construction_probe or args.image_submit_test).resolve(strict=True)
        project_data = Path('C:/wx/fishbot/data').resolve()
        if not image.is_relative_to(project_data) or image.stat().st_size > 20*1024*1024:
            raise RuntimeError('Image probe requires project-owned file under 20 MiB')
        result = script.exports_sync.sendimage({'target':'filehelper','imagePath':str(image),'bytes':list(str(image).encode()),'fileSize':image.stat().st_size,'probeOnly':not bool(args.image_submit_test)})
        print(json.dumps({'imageProbe':True,'nativeOutcome':result,'deliveryVerified':False}),flush=True)
        if args.image_submit_test:
            time.sleep(15)
    if args.execute_filehelper_test:
        if not status or not status.get('ready'):
            raise RuntimeError('Filehelper context not ready; no send attempted')
        text = 'FishBot_CloudNative_' + str(int(time.time()))
        attempted = True
        result = script.exports_sync.sendtext({'target': 'filehelper', 'text': text, 'bytes': list(text.encode())})
        print(json.dumps({'probeMarker': text, 'nativeOutcome': result, 'deliveryVerified': False}), flush=True)
finally:
    closing = True
    try:
        if script:
            try:
                if initialized:
                    cleanup = script.exports_sync.dispose()
                    deadline = time.monotonic() + 10
                    while isinstance(cleanup, dict) and not cleanup.get('disposed', True) and time.monotonic() < deadline:
                        time.sleep(0.1)
                        cleanup = script.exports_sync.dispose()
            finally:
                script.unload()
    finally:
        session.detach()
        print(json.dumps({'detached': True, 'sendRequestIssued': attempted}), flush=True)
