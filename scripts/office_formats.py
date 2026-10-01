# Office (DOCX/XLSX) render + extract for the sandboxed document worker. Libraries: python-docx (MIT), openpyxl (MIT).
# Input/output are JSON or raw bytes on stdin/stdout; every text value is treated as data (no formulas, no macros).
import io,json,csv,re,zipfile
MAX_ROWS=2000;MAX_COLS=64;MAX_CELL=1000;MAX_TEXT=60000
def _rows_from_csv(text):
 sample=text[:4096];delim=';' if sample.count(';')>sample.count(',') else ','
 rows=list(csv.reader(io.StringIO(text),delimiter=delim))
 if len(rows)>MAX_ROWS:raise ValueError('too_many_rows')
 for r in rows:
  if len(r)>MAX_COLS:raise ValueError('too_many_columns')
  for c in r:
   if len(c)>MAX_CELL:raise ValueError('cell_too_long')
   if c[:1] in ('=','+','-','@') and re.match(r'^[=+\-@]\s*[A-Za-z(]',c):raise ValueError('formula_not_allowed')
 return rows
def _num(c):
 if re.fullmatch(r'-?\d{1,15}',c):return int(c)
 if re.fullmatch(r'-?\d{1,15}[.,]\d{1,6}',c):return float(c.replace(',','.'))
 return c
def render_xlsx(data):
 from openpyxl import Workbook
 rows=_rows_from_csv(data['text']);wb=Workbook();ws=wb.active;ws.title=(data.get('sheet') or 'Foglio1')[:31]
 for r in rows:ws.append([_num(c) for c in r])
 if rows:
  from openpyxl.styles import Font
  for cell in ws[1]:cell.font=Font(bold=True)
  for i,col in enumerate(zip(*rows)):ws.column_dimensions[ws.cell(1,i+1).column_letter].width=min(60,max(8,max(len(str(c)) for c in col)+2))
 out=io.BytesIO();wb.save(out);return out.getvalue()
def render_docx(data):
 import docx
 d=docx.Document();lines=data['text'].splitlines();first=True
 if any('\u0980'<=ch<='\u09ff' for ch in data['text']):
  from docx.oxml.ns import qn
  for st in ('Normal','Title','Heading 1','Heading 2','Heading 3','List Bullet','List Number'):
   try:
    rpr=d.styles[st].element.get_or_add_rPr();rf=rpr.find(qn('w:rFonts'))
    if rf is None:rf=rpr.makeelement(qn('w:rFonts'),{});rpr.append(rf)
    rf.set(qn('w:cs'),'Noto Sans Bengali');rf.set(qn('w:ascii'),'Noto Sans Bengali');rf.set(qn('w:hAnsi'),'Noto Sans Bengali')
   except KeyError:pass
 for line in lines:
  s=line.rstrip()
  if not s:continue
  if s.startswith('# '):d.add_heading(s[2:].strip(),0 if first else 1)
  elif s.startswith('## '):d.add_heading(s[3:].strip(),2)
  elif s.startswith('### '):d.add_heading(s[4:].strip(),3)
  elif s.startswith(('- ','• ','* ')):d.add_paragraph(s[2:].strip(),style='List Bullet')
  elif re.match(r'^\d+[.)] ',s):d.add_paragraph(re.sub(r'^\d+[.)] ','',s),style='List Number')
  else:d.add_paragraph(re.sub(r'\*\*(.*?)\*\*',r'\1',s))
  first=False
 if not d.paragraphs:raise ValueError('empty_document')
 out=io.BytesIO();d.save(out);return out.getvalue()
def extract_office(name,raw):
 if not raw.startswith(b'PK'):raise ValueError('not_office')
 with zipfile.ZipFile(io.BytesIO(raw)) as z:
  names=z.namelist()
  if any(n.startswith('xl/') for n in names):kind='xlsx'
  elif any(n.startswith('word/') for n in names):kind='docx'
  else:raise ValueError('not_office')
  if any(n.lower().endswith('.bin') and 'vba' in n.lower() for n in names):raise ValueError('macros_not_allowed')
 if kind=='xlsx':
  from openpyxl import load_workbook
  wb=load_workbook(io.BytesIO(raw),read_only=True,data_only=True);ws=wb.worksheets[0];out=io.StringIO();w=csv.writer(out,lineterminator='\r\n');n=0
  for r in ws.iter_rows(values_only=True):
   n+=1
   if n>MAX_ROWS:raise ValueError('too_many_rows')
   w.writerow(['' if c is None else (str(c) if not isinstance(c,float) or not c.is_integer() else str(int(c))) for c in r[:MAX_COLS]])
  text=out.getvalue()
  if len(text.encode())>MAX_TEXT:raise ValueError('text_too_large')
  return {'text':text,'method':'openpyxl','detectedType':'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet','sheets':[s.title for s in wb.worksheets],'coverage':'first-sheet'}
 import docx
 d=docx.Document(io.BytesIO(raw));parts=[]
 for p in d.paragraphs:
  t=p.text.strip()
  if not t:continue
  st=(p.style.name or '').lower()
  if st.startswith('title'):parts.append('# '+t)
  elif st.startswith('heading'):parts.append('## '+t)
  elif 'list' in st:parts.append('- '+t)
  else:parts.append(t)
 for tb in d.tables:
  for row in tb.rows:parts.append(' | '.join(c.text.strip() for c in row.cells))
 text='\n'.join(parts)
 if len(text.encode())>MAX_TEXT:raise ValueError('text_too_large')
 return {'text':text,'method':'python-docx','detectedType':'application/vnd.openxmlformats-officedocument.wordprocessingml.document','coverage':'paragraphs-and-tables'}
