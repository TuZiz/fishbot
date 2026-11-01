"""Download only public format reference sources. Never execute downloaded code."""
import urllib.request,zipfile,io,pathlib
proxy=urllib.request.ProxyHandler({'https':'http://127.0.0.1:7890'})
response=urllib.request.build_opener(proxy).open('https://codeload.github.com/sjzar/chatlog/zip/refs/tags/v0.0.26',timeout=25)
archive=zipfile.ZipFile(io.BytesIO(response.read(20*1024*1024)))
print('Archive entries:',len(archive.namelist()))
print('\n'.join(archive.namelist()[:12]))
folder=pathlib.Path('C:/wx/fishbot/data/research/images/wxgf-reference');folder.mkdir(exist_ok=True)
for name in archive.namelist():
    if not name.endswith('/') and (name.endswith('.go') or name.endswith('LICENSE')) and (b'wxgf' in archive.read(name).lower() or name.endswith('LICENSE')):
        (folder/pathlib.PurePosixPath(name).name).write_bytes(archive.read(name))
        print(pathlib.PurePosixPath(name).name)
