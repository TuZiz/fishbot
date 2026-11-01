"""Offline controller vtable references/bounds; no process or chat access."""
import bisect
import json
import re
import struct
import sys
from pathlib import Path

root = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(root.parent / '.tools/hook-research'))
import pefile

meta = json.loads((root / 'data/research/native/process-metadata.json').read_text())
pe = pefile.PE(meta['module'], fast_load=True)
directory = pe.OPTIONAL_HEADER.DATA_DIRECTORY[pefile.DIRECTORY_ENTRY['IMAGE_DIRECTORY_ENTRY_EXCEPTION']]
functions = sorted((a, b) for a, b, _ in struct.iter_unpack('<III', pe.get_data(directory.VirtualAddress, directory.Size)) if a < b)
starts = [a for a, _ in functions]

def enclosing(rva):
    i = bisect.bisect_right(starts, rva) - 1
    return functions[i] if i >= 0 and rva < functions[i][1] else None

vtable = 0x9881d28
entries = struct.unpack('<8Q', pe.get_data(vtable, 64))
targets = {enclosing(p - pe.OPTIONAL_HEADER.ImageBase) for p in entries}
refs = []
for section in pe.sections:
    if not section.Characteristics & 0x20000000:
        continue
    for match in re.finditer(rb'[\x48-\x4f]\x8d[\x05\x0d\x15\x1d\x25\x2d\x35\x3d][\s\S]{4}', section.get_data()):
        at = section.VirtualAddress + match.start()
        if at + 7 + struct.unpack_from('<i', match.group(), 3)[0] == vtable:
            function = enclosing(at)
            refs.append({'rva': hex(at), 'function': function})
            targets.add(function)
targets.discard(None)
folder = root / 'data/research/native'
(folder / 'decompile-lifetime.tsv').write_text(''.join(f'{a:x}\t{b:x}\n' for a, b in sorted(targets)))
(folder / 'controller-lifetime-static.json').write_text(json.dumps({'vtableRva': hex(vtable), 'entries': [hex(p - pe.OPTIONAL_HEADER.ImageBase) for p in entries], 'references': refs}, indent=2))
print(json.dumps({'functions': len(targets), 'references': refs}))
