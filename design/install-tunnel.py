from pathlib import Path
import urllib.request,hashlib
url='https://github.com/cloudflare/cloudflared/releases/download/2026.9.3/cloudflared-linux-amd64'
expected='77e26d8d900e0b8469f416239d14b5f296525fdf79fee6f511ef55609e3fbac2'
p=Path('/home/azureuser/.local/bin/cloudflared-nova-trial')
b=urllib.request.urlopen(url,timeout=90).read();assert hashlib.sha256(b).hexdigest()==expected
p.write_bytes(b);p.chmod(0o755);print('Verified cloudflared SHA256',expected)
