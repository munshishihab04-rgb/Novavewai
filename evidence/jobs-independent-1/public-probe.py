"""Bounded GETs of named public pages only; no auth, no redirects/retries.
One-shot reviewer aid, not a production discovered-URL adapter.
"""
import sys, json, datetime, urllib.request, urllib.error, re
from html.parser import HTMLParser
from urllib.parse import urljoin, urlsplit
from pathlib import Path
ROOT=Path(__file__).parent
class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self,*args,**kwargs): return None
class Visible(HTMLParser):
    def __init__(self): super().__init__(); self.skip=0; self.parts=[]; self.links=[]; self.anchor=None
    def handle_starttag(self,tag,attrs):
        if tag in ('script','style'): self.skip+=1
        if tag=='a': self.anchor={'url':dict(attrs).get('href',''),'text':''}
    def handle_endtag(self,tag):
        if tag in ('script','style'): self.skip=max(0,self.skip-1)
        if tag=='a' and self.anchor: self.links.append(self.anchor); self.anchor=None
    def handle_data(self,data):
        if not self.skip:
            self.parts.append(data)
            if self.anchor: self.anchor['text']+=data
opener=urllib.request.build_opener(NoRedirect())
path=ROOT/'live-pages.json'
rows=json.loads(path.read_text()) if path.exists() else []
for url in sys.argv[1:]:
    assert urlsplit(url).scheme=='https' and urlsplit(url).hostname in ('miscusi.com','jobs.miscusi.com','www.eataly.net','careers.eataly.net')
    row: dict={'url':url,'checked_at':datetime.datetime.now(datetime.timezone.utc).isoformat()}
    try:
        with opener.open(urllib.request.Request(url,headers={'User-Agent':'NovaJobsReview/1.0 (bounded public feasibility review)'}),timeout=20) as r:
            raw=r.read(1000001); row.update(status=r.status,content_type=r.headers.get('Content-Type'),bytes_read=len(raw),truncated=len(raw)>1000000)
            p=Visible(); p.feed(raw[:1000000].decode('utf8','replace'))
            text=re.sub(r'\s+',' ',' '.join(p.parts)).strip()
            if row['content_type'] and 'text/plain' in row['content_type']: row['policy_text']=text
            row['title']=(re.findall(r'<title[^>]*>(.*?)</title>',raw.decode('utf8','replace'),re.S) or [''])[0]
            row['excerpts']=[text[max(0,m.start()-110):m.end()+220] for m in list(re.finditer('Milano|Bologna|candidatur|lavora|career|posizioni|ristorant|termini|spontane',text,re.I))[:20]]
            row['links']=[{'url':urljoin(url,a['url']),'text':re.sub(r'\s+',' ',a['text']).strip()[:100]} for a in p.links if re.search('lavora|career|jobs|milano|bologna|ristorant|termini|legal|spontane|posizioni|candid',a['url']+' '+a['text'],re.I)][:50]
    except urllib.error.HTTPError as e: row.update(status=e.code,location=e.headers.get('Location'),error=str(e))
    except Exception as e: row['error']=str(e)
    rows.append(row)
    path.write_text(json.dumps(rows,ensure_ascii=False,indent=2))
    print(json.dumps(row,ensure_ascii=False,indent=2))
