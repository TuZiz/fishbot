"""Test the production downloader in a read/download-only isolated research script.

No send endpoint or paid provider. Requires the already verified private photo
identity and cache candidates. Reports booleans, status and image dimensions only.
"""
import os
import argparse
import hashlib
import json
from pathlib import Path
import re
import subprocess
import sys
import time

p = argparse.ArgumentParser(description=__doc__)
p.add_argument('--root', required=True)
p.add_argument('--output', required=True)
p.add_argument('--start-download', action='store_true')
args = p.parse_args()
root = Path(args.root)
profile = json.loads((root / 'cloud-profile.json').read_text(encoding='utf-8-sig'))
if hashlib.sha256(Path(profile['module']).read_bytes()).hexdigest() != 'e0428a7b691853de496532523c2c09aa095f90941c37c9f4cfb3f137f3c66556':
    raise RuntimeError('Unsupported download verification DLL')
photo = json.loads(Path('data/research/native/quoted-image-identity-input.json').read_text(encoding='utf-8-sig'))
if photo.get('conversationId') not in ({os.environ.get('FISHBOT_TEST_GROUP_ID', ''), os.environ.get('FISHBOT_TEST_GROUP_2_ID', '')} - {''}) or not re.fullmatch('[a-f0-9]{32}', photo.get('md5', '')):
    raise RuntimeError('Unauthorized photo verification')
sites = json.loads(Path('native/quoted-image-download-fingerprints.json').read_text())
source = 'rpc.exports.dispose=function(){};\n' + Path('native/quoted-image-task.js').read_text().replace('DOWNLOAD_CONFIG', json.dumps(sites), 1)
source += '\n' + Path('native/quoted-image-download.js').read_text()
source += '\n' + (root / 'cached-image-reader.js').read_text(encoding='utf-8-sig')
sys.path.insert(0, str(root))
import frida

report = {'downloads': 0, 'sends': 0, 'paidRequests': 0, 'automaticDownloadVerified': False}
session = frida.attach(profile['pid'])
script = None
try:
    script = session.create_script(source)
    script.load()
    if args.start_download:
        import uuid
        photo['id'] = str(uuid.uuid4())
        report['start'] = script.exports_sync.startquoteddownload(photo)
        deadline = time.monotonic() + 48
        while True:
            state = script.exports_sync.quoteddownloadstatus(photo['id'])
            if state['state'] != 'pending' or time.monotonic() >= deadline:
                break
            time.sleep(0.2)
        # UUID is internal correlation only; not needed in the report.
        report['task'] = {k: v for k, v in state.items() if k != 'id'}
        report['start'] = {k: v for k, v in report['start'].items() if k != 'id'}
        report['downloads'] = 1
    private = json.loads(Path('data/research/native/quoted-cache-private.json').read_text())
    if private['md5'] != photo['md5']:
        raise RuntimeError('Prepared cache identity differs')
    storage = __import__('os').environ.get('WECHAT_STORAGE_PATH') or Path('data/wechat/storage-path.txt').read_text(encoding='utf-8-sig').strip()
    cache_root = (Path(storage).parent / 'msg' / 'attach').resolve(strict=True)
    for candidate in private['candidates']:
        path = Path(candidate).resolve(strict=True)
        if not path.is_relative_to(cache_root) or path.suffix.lower() != '.dat' or path.name.lower().endswith('_t.dat') or not 15 <= path.stat().st_size <= 20*1024*1024:
            continue
        decoded = script.exports_sync.readcachedimage(str(path))
        if not decoded or hashlib.md5(decoded).hexdigest() != photo['md5']:
            continue
        result = subprocess.run(['C:/wx/tools/node/node.exe', 'scripts/validate-downloaded-photo.mjs'], input=bytes(decoded), capture_output=True, timeout=25, check=True)
        report['image'] = json.loads(result.stdout)
        report['decodedMd5Matched'] = True
        break
    report['passed'] = bool(report.get('decodedMd5Matched')) and (not args.start_download or report.get('task', {}).get('state') == 'complete')
except Exception as error:
    report['passed'] = False
    report['errorType'] = type(error).__name__
finally:
    try:
        if script:
            cleanup = script.exports_sync.dispose()
            deadline = time.monotonic() + 10
            while not cleanup.get('disposed') and time.monotonic() < deadline:
                time.sleep(0.1)
                cleanup = script.exports_sync.dispose()
            report['cleanup'] = cleanup
            script.unload()
    finally:
        session.detach()
        Path(args.output).write_text(json.dumps(report, indent=2)+'\n')
        print(json.dumps(report))
if not report.get('passed'):
    raise SystemExit(1)
