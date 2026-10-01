import sys,json,io,resource,html,re
resource.setrlimit(resource.RLIMIT_AS,(512*1024*1024,512*1024*1024));resource.setrlimit(resource.RLIMIT_CPU,(12,12))
from pypdf import PdfReader
from reportlab.platypus import SimpleDocTemplate,Paragraph,Spacer,KeepTogether
from reportlab.lib.styles import ParagraphStyle
from reportlab.lib import colors
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.lib.enums import TA_LEFT
mode=sys.argv[1]
try:
 if mode=='extract':
  raw=sys.stdin.buffer.read(4*1024*1024+1)
  if len(raw)>4*1024*1024 or not raw.startswith(b'%PDF-'):raise ValueError('invalid_pdf')
  reader=PdfReader(io.BytesIO(raw),strict=True)
  if reader.is_encrypted:raise ValueError('encrypted_pdf')
  if len(reader.pages)>30:raise ValueError('too_many_pages')
  parts=[];empty=[]
  for i,p in enumerate(reader.pages):
   t=p.extract_text() or ''
   if not t.strip():empty.append(i+1)
   parts.append(f'--- Pagina {i+1} ---\n{t.strip()}')
  if empty:raise ValueError('scanned_pdf_requires_ocr')
  text='\n\n'.join(parts)
  if len(text.encode())>15500:raise ValueError('pdf_text_too_large')
  print(json.dumps({'text':text,'pages':len(reader.pages),'method':'text-layer','coverage':'all-pages'}))
 elif mode in ('render-docx','render-xlsx'):
  sys.path.insert(0,__file__.rsplit('/',1)[0]);import office_formats
  data=json.loads(sys.stdin.buffer.read(120000))
  sys.stdout.buffer.write(office_formats.render_docx(data) if mode=='render-docx' else office_formats.render_xlsx(data))
 elif mode=='extract-office':
  sys.path.insert(0,__file__.rsplit('/',1)[0]);import office_formats
  raw=sys.stdin.buffer.read(4*1024*1024+1)
  if len(raw)>4*1024*1024:raise ValueError('file_too_large')
  name=sys.argv[2] if len(sys.argv)>2 else ''
  print(json.dumps(office_formats.extract_office(name,raw)))
 elif mode=='render-cv':
  data=json.loads(sys.stdin.buffer.read(120000));cv=data['cv'];template=data['template'];language=data['language']
  if template not in ('modern','classic','professional'):raise ValueError('invalid_template')
  if language not in ('it','en','bn'):raise ValueError('invalid_language')
  if 'photo' in cv or 'photo' in cv.get('identity',{}):raise ValueError('photo_not_supported')
  sys.path.insert(0,__file__.rsplit('/',1)[0]);import cv_layouts
  sys.stdout.buffer.write(cv_layouts.build(cv,template,language))
 elif mode=='render':
  data=json.loads(sys.stdin.buffer.read(90000));text=data['text'];title=data['title'];template=data['template']
  _bn=any('\u0980'<=ch<='\u09ff' for ch in (title+text));_nb=__file__.rsplit('/',1)[0]+'/../assets/fonts/NotoSansBengali-'
  if _bn and __import__('os').path.exists(_nb+'Regular.ttf'):pdfmetrics.registerFont(TTFont('Nova',_nb+'Regular.ttf'));pdfmetrics.registerFont(TTFont('NovaBold',_nb+'Bold.ttf'))
  else:pdfmetrics.registerFont(TTFont('Nova','/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf'));pdfmetrics.registerFont(TTFont('NovaBold','/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf'))
  accent=colors.HexColor('#245c43' if template=='modern' else '#263441')
  _shape=False
  if _bn:
   try:import uharfbuzz;_shape=True
   except Exception:_shape=False
  normal=ParagraphStyle('body',fontName='Nova',fontSize=10,leading=15,textColor=colors.HexColor('#303b40'),spaceAfter=7,shaping=_shape)
  heading=ParagraphStyle('heading',parent=normal,fontName='NovaBold',fontSize=11,leading=16,textColor=accent,spaceBefore=14,spaceAfter=8,keepWithNext=True)
  name=ParagraphStyle('name',parent=normal,fontName='NovaBold',fontSize=23,leading=28,textColor=accent,spaceAfter=13)
  story=[];lines=text.splitlines();first=True
  # The document title remains authoritative; only a single '# ' line overrides it.
  display_title=next((line[2:].strip() for line in lines if line.startswith('# ')),title)
  story.append(Paragraph(html.escape(display_title),name))
  for line in lines:
   line=line.strip()
   if not line:story.append(Spacer(1,5));continue
   clean=re.sub(r'\*\*(.*?)\*\*',r'\1',line);clean=re.sub(r'^#{1,6}\s*','',clean)
   safe=html.escape(clean)
   if line.startswith('# '):continue
   section=line.startswith('##') or (clean.isupper() and len(clean)<70)
   if line.startswith(('- ','• ')):story.append(Paragraph('• '+html.escape(clean[2:]),normal))
   else:story.append(Paragraph(safe,heading if section else normal))
  if not story:raise ValueError('empty_document')
  result=io.BytesIO();doc=SimpleDocTemplate(result,pagesize=(595.28,841.89),rightMargin=48,leftMargin=48,topMargin=44,bottomMargin=44,title=title,author='NOVA')
  def footer(c,d):
   c.setFont('Nova',8);c.setFillColor(colors.HexColor('#68736b'));c.drawRightString(547,24,f'{d.page}');c.setStrokeColor(accent);c.setLineWidth(.5);c.line(48,34,547,34)
  doc.build(story,onFirstPage=footer,onLaterPages=footer);sys.stdout.buffer.write(result.getvalue())
except Exception as e:
 print(json.dumps({'error':str(e) if isinstance(e,ValueError) else 'document_processing_failed'}),file=sys.stderr);sys.exit(1)
