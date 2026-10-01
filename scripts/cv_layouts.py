"""CV v1 PDF layouts for the sandboxed document worker (reportlab only, DejaVu fonts, A4, no photo).

Templates: modern (accent #245c43 left sidebar + headline band), classic (serif, centered header, thin rules),
professional (two-column header, grey rules). Input is validated JSON from the server; everything is escaped.
"""
import html,io
from reportlab.platypus import BaseDocTemplate,PageTemplate,Frame,Paragraph,Spacer,Table,TableStyle,KeepTogether,FrameBreak,NextPageTemplate
from reportlab.lib.styles import ParagraphStyle
from reportlab.lib import colors
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.lib.enums import TA_LEFT,TA_CENTER,TA_RIGHT
import os
A4=(595.28,841.89)
FONTS='/usr/share/fonts/truetype/dejavu/'
LABELS={
 'it':{'profile':'Profilo','experience':'Esperienza professionale','education':'Istruzione e formazione','skills':'Competenze','languages':'Lingue','certifications':'Certificazioni','contact':'Contatti','present':'oggi','page':'Pagina','footer':'CV generato con Nova · dati forniti dall’utente'},
 'en':{'profile':'Profile','experience':'Experience','education':'Education','skills':'Skills','languages':'Languages','certifications':'Certifications','contact':'Contact','present':'present','page':'Page','footer':'CV generated with Nova · data supplied by the user'},
 'bn':{'profile':'প্রোফাইল / Profile','experience':'অভিজ্ঞতা / Experience','education':'শিক্ষা / Education','skills':'দক্ষতা / Skills','languages':'ভাষা / Languages','certifications':'সার্টিফিকেট / Certifications','contact':'যোগাযোগ / Contact','present':'বর্তমান','page':'পৃষ্ঠা','footer':'Nova দিয়ে তৈরি CV · ব্যবহারকারীর দেওয়া তথ্য'},
}
BN_FONTS=os.path.join(os.path.dirname(os.path.abspath(__file__)),'..','assets','fonts')
def _hb():
 try:import uharfbuzz;return True
 except Exception:return False
def has_bengali(text):return any('\u0980'<=ch<='\u09ff' for ch in text)
def register(serif,bengali=False):
 fams={'sans':('DejaVuSans.ttf','DejaVuSans-Bold.ttf'),'serif':('DejaVuSerif.ttf','DejaVuSerif-Bold.ttf')}
 reg,bold=fams['serif' if serif and os.path.exists(FONTS+'DejaVuSerif.ttf') else 'sans']
 nb_r=os.path.join(BN_FONTS,'NotoSansBengali-Regular.ttf');nb_b=os.path.join(BN_FONTS,'NotoSansBengali-Bold.ttf')
 # Bengali script needs Noto Sans Bengali (OFL, bundled); DejaVu has no Bengali glyphs. Noto also covers Latin, so a
 # document containing any Bengali uses it throughout (reportlab cannot fall back per glyph).
 if bengali and os.path.exists(nb_r) and os.path.exists(nb_b):
  pdfmetrics.registerFont(TTFont('CvR',nb_r));pdfmetrics.registerFont(TTFont('CvB',nb_b));pdfmetrics.registerFont(TTFont('CvSans',nb_r));pdfmetrics.registerFont(TTFont('CvSansB',nb_b));return
 pdfmetrics.registerFont(TTFont('CvR',FONTS+reg));pdfmetrics.registerFont(TTFont('CvB',FONTS+bold))
 pdfmetrics.registerFont(TTFont('CvSans',FONTS+'DejaVuSans.ttf'));pdfmetrics.registerFont(TTFont('CvSansB',FONTS+'DejaVuSans-Bold.ttf'))
E=lambda s:html.escape(str(s or ''))
def month(m,present):
 if not m:return present
 return m[5:7]+'/'+m[0:4]
def period(start,end,present,empty_ok=False):
 if empty_ok and not start and not end:return ''
 if empty_ok:return ' – '.join([x for x in [month(start,'') if start else '',month(end,'') if end else ''] if x])
 return f"{month(start,present)} – {month(end,present)}"
SHAPE=False  # set per document by build(): HarfBuzz shaping (uharfbuzz) for Bengali vowel-sign reordering
def styles(accent,ink,muted,base='CvR',bold='CvB'):
 body=ParagraphStyle('b',fontName=base,fontSize=9.6,leading=13.5,textColor=ink,shaping=SHAPE)
 return {
  'body':body,
  'name':ParagraphStyle('n',parent=body,fontName=bold,fontSize=22,leading=26,textColor=ink),
  'headline':ParagraphStyle('h',parent=body,fontName=base,fontSize=11.5,leading=15,textColor=accent),
  'contact':ParagraphStyle('c',parent=body,fontSize=8.8,leading=12,textColor=muted),
  'section':ParagraphStyle('s',parent=body,fontName=bold,fontSize=10.5,leading=14,textColor=accent,spaceBefore=11,spaceAfter=4),
  'role':ParagraphStyle('r',parent=body,fontName=bold,fontSize=10,leading=13.5),
  'sub':ParagraphStyle('u',parent=body,fontSize=9,leading=12.5,textColor=muted),
  'date':ParagraphStyle('d',parent=body,fontSize=8.8,leading=12.5,textColor=muted,alignment=TA_RIGHT),
  'bullet':ParagraphStyle('bl',parent=body,leftIndent=11,bulletIndent=1,spaceAfter=1.5),
  'side':ParagraphStyle('sd',parent=body,fontName='CvSans',fontSize=8.8,leading=12.5,textColor=colors.white),
  'sidehead':ParagraphStyle('sh',parent=body,fontName='CvSansB',fontSize=9.4,leading=13,textColor=colors.white,spaceBefore=12,spaceAfter=4),
  'center':ParagraphStyle('ce',parent=body,alignment=TA_CENTER),
  'centername':ParagraphStyle('cn',parent=body,fontName=bold,fontSize=22,leading=27,alignment=TA_CENTER,textColor=ink),
  'centerhead':ParagraphStyle('ch',parent=body,fontSize=11.5,leading=15,alignment=TA_CENTER,textColor=accent),
  'centercontact':ParagraphStyle('cc',parent=body,fontSize=8.8,leading=12,alignment=TA_CENTER,textColor=muted),
 }
def dated_block(st,title,sub,dates,width):
 dw=132 if SHAPE else 92
 t=Table([[Paragraph(title,st['role']),Paragraph(E(dates),st['date'])]],colWidths=[width-dw,dw])
 t.setStyle(TableStyle([('VALIGN',(0,0),(-1,-1),'TOP'),('LEFTPADDING',(0,0),(-1,-1),0),('RIGHTPADDING',(0,0),(-1,-1),0),('TOPPADDING',(0,0),(-1,-1),0),('BOTTOMPADDING',(0,0),(-1,-1),0)]))
 out=[t]
 if sub:out.append(Paragraph(sub,st['sub']))
 return out
def main_sections(cv,L,st,width,include=('summary','experiences','education','certifications','skills','languages')):
 story=[];present=L['present']
 order=[s for s in (cv['presentation'].get('section_order') or []) if s in include]+[s for s in include if s not in (cv['presentation'].get('section_order') or [])]
 for s in order:
  if s=='summary' and cv.get('summary'):story+= [Paragraph(L['profile'],st['section']),Paragraph(E(cv['summary']),st['body'])]
  elif s=='experiences' and cv['experiences']:
   story.append(Paragraph(L['experience'],st['section']))
   for e in cv['experiences']:
    block=dated_block(st,E(e['role']),E(' · '.join([x for x in [e['employer'],e['city']] if x])),period(e['start'],e['end'],present),width)
    block+=[Paragraph(E(b),st['bullet'],bulletText='•') for b in e['bullets']]
    story.append(KeepTogether(block));story.append(Spacer(1,5))
  elif s=='education' and cv['education']:
   story.append(Paragraph(L['education'],st['section']))
   for e in cv['education']:
    story.append(KeepTogether(dated_block(st,E(e['title']),E(' · '.join([x for x in [e['institution'],e['city']] if x])),period(e['start'],e['end'],present,True),width)));story.append(Spacer(1,4))
  elif s=='certifications' and cv['certifications']:
   story.append(Paragraph(L['certifications'],st['section']))
   for c in cv['certifications']:story.append(Paragraph(E(' — '.join([x for x in [c['name'],c['issuer'],c['year']] if x])),st['body']))
  elif s=='skills' and cv['skills']:
   story+= [Paragraph(L['skills'],st['section']),Paragraph(E(' · '.join([f"{x['name']} ({x['level']})" if x['level'] else x['name'] for x in cv['skills']])),st['body'])]
  elif s=='languages' and cv['languages']:
   story+= [Paragraph(L['languages'],st['section']),Paragraph(E(' · '.join([f"{x['name']} ({x['level']})" if x['level'] else x['name'] for x in cv['languages']])),st['body'])]
 return story
def consent(cv,st):
 if not cv.get('consent_line'):return []
 return [Spacer(1,14),Paragraph(E(cv['consent_line']),ParagraphStyle('cons',parent=st['sub'],fontSize=7.8,leading=10.5,shaping=SHAPE))]
def build(cv,template,language):
 L=LABELS.get(language,LABELS['it']);ident=cv['identity']
 import json as _j;bengali=language=='bn' or has_bengali(_j.dumps(cv,ensure_ascii=False))
 global SHAPE;SHAPE=bengali and _hb()
 result=io.BytesIO()
 def footer_factory(accent,muted,left=48,right=A4[0]-48):
  def footer(c,d):
   c.saveState();c.setFont('CvSans',7.5);c.setFillColor(muted);c.drawString(left,24,L['footer']);c.drawRightString(right,24,f"{L['page']} {d.page}");c.setStrokeColor(accent);c.setLineWidth(.5);c.line(left,34,right,34);c.restoreState()
  return footer
 contact_bits=[x for x in [ident.get('city'),ident.get('email'),ident.get('phone')] if x]
 if template=='modern':
  register(False,bengali);accent=colors.HexColor('#245c43');ink=colors.HexColor('#1d2a25');muted=colors.HexColor('#5f6d66');st=styles(accent,ink,muted)
  side_w=168;gap=22;main_w=A4[0]-side_w-gap-44
  doc=BaseDocTemplate(result,pagesize=A4,title=ident['full_name'],author='NOVA',leftMargin=0,rightMargin=0,topMargin=0,bottomMargin=0)
  def bg(c,d):
   c.saveState();c.setFillColor(accent);c.rect(0,0,side_w,A4[1],stroke=0,fill=1);c.restoreState();footer_factory(accent,muted,side_w+gap)(c,d)
  side=Frame(18,46,side_w-36,A4[1]-80,id='side',leftPadding=0,rightPadding=0,topPadding=0,bottomPadding=0)
  main=Frame(side_w+gap,46,main_w,A4[1]-92,id='main',leftPadding=0,rightPadding=0,topPadding=0,bottomPadding=0)
  main_only=Frame(side_w+gap,46,main_w,A4[1]-92,id='main2',leftPadding=0,rightPadding=0,topPadding=0,bottomPadding=0)
  doc.addPageTemplates([PageTemplate(id='first',frames=[side,main],onPage=bg),PageTemplate(id='later',frames=[main_only],onPage=bg)])
  story=[Spacer(1,18)]
  if contact_bits:story.append(Paragraph(L['contact'],st['sidehead']));story+= [Paragraph(E(x),st['side']) for x in contact_bits]
  if cv['skills']:story.append(Paragraph(L['skills'],st['sidehead']));story+= [Paragraph(E(f"{x['name']} · {x['level']}" if x['level'] else x['name']),st['side']) for x in cv['skills']]
  if cv['languages']:story.append(Paragraph(L['languages'],st['sidehead']));story+= [Paragraph(E(f"{x['name']} · {x['level']}" if x['level'] else x['name']),st['side']) for x in cv['languages']]
  if cv['certifications']:story.append(Paragraph(L['certifications'],st['sidehead']));story+= [Paragraph(E(' — '.join([y for y in [x['name'],x['year']] if y])),st['side']) for x in cv['certifications']]
  story.append(NextPageTemplate('later'));story.append(FrameBreak())
  story+= [Spacer(1,22),Paragraph(E(ident['full_name']),st['name'])]
  if ident.get('headline'):story.append(Paragraph(E(ident['headline']),st['headline']))
  story.append(Spacer(1,6))
  story+=main_sections(cv,L,st,main_w,include=('summary','experiences','education'))
  story+=consent(cv,st)
  doc.build(story)
 elif template=='classic':
  register(True,bengali);accent=colors.HexColor('#263441');ink=colors.HexColor('#1f262b');muted=colors.HexColor('#616b73');st=styles(accent,ink,muted)
  width=A4[0]-116
  doc=BaseDocTemplate(result,pagesize=A4,title=ident['full_name'],author='NOVA',leftMargin=58,rightMargin=58,topMargin=50,bottomMargin=48)
  frame=Frame(58,48,width,A4[1]-98,id='f',leftPadding=0,rightPadding=0,topPadding=0,bottomPadding=0)
  doc.addPageTemplates([PageTemplate(id='p',frames=[frame],onPage=footer_factory(accent,muted,58,A4[0]-58))])
  rule=Table([['']],colWidths=[width],rowHeights=[4]);rule.setStyle(TableStyle([('LINEBELOW',(0,0),(-1,-1),.8,accent)]))
  story=[Paragraph(E(ident['full_name']),st['centername'])]
  if ident.get('headline'):story.append(Paragraph(E(ident['headline']),st['centerhead']))
  if contact_bits:story.append(Paragraph(E('  ·  '.join(contact_bits)),st['centercontact']))
  story+= [Spacer(1,6),rule,Spacer(1,4)]
  story+=main_sections(cv,L,st,width)
  story+=consent(cv,st)
  doc.build(story)
 elif template=='professional':
  register(False,bengali);accent=colors.HexColor('#2b3a46');ink=colors.HexColor('#1c2328');muted=colors.HexColor('#6a7680');grey=colors.HexColor('#c9d0d6');st=styles(accent,ink,muted)
  width=A4[0]-96
  doc=BaseDocTemplate(result,pagesize=A4,title=ident['full_name'],author='NOVA',leftMargin=48,rightMargin=48,topMargin=46,bottomMargin=48)
  frame=Frame(48,48,width,A4[1]-94,id='f',leftPadding=0,rightPadding=0,topPadding=0,bottomPadding=0)
  doc.addPageTemplates([PageTemplate(id='p',frames=[frame],onPage=footer_factory(grey,muted))])
  left=[Paragraph(E(ident['full_name']),st['name'])]
  if ident.get('headline'):left.append(Paragraph(E(ident['headline']),st['headline']))
  right=[Paragraph(E(x),ParagraphStyle('rc',parent=st['contact'],alignment=TA_RIGHT,shaping=SHAPE)) for x in contact_bits] or [Paragraph('',st['contact'])]
  head=Table([[left,right]],colWidths=[width*.62,width*.38])
  head.setStyle(TableStyle([('VALIGN',(0,0),(-1,-1),'TOP'),('LEFTPADDING',(0,0),(-1,-1),0),('RIGHTPADDING',(0,0),(-1,-1),0),('TOPPADDING',(0,0),(-1,-1),0),('BOTTOMPADDING',(0,0),(-1,-1),8),('LINEBELOW',(0,0),(-1,-1),1.2,grey)]))
  st['section']=ParagraphStyle('s2',parent=st['section'],borderPadding=(0,0,3,0))
  story=[head,Spacer(1,6)]
  def ruled(items):
   out=[]
   for it in items:
    out.append(it)
    if isinstance(it,Paragraph) and it.style.name=='s2':
     r=Table([['']],colWidths=[width],rowHeights=[2]);r.setStyle(TableStyle([('LINEABOVE',(0,0),(-1,-1),.6,grey)]));out.append(r);out.append(Spacer(1,3))
   return out
  story+=ruled(main_sections(cv,L,st,width))
  story+=consent(cv,st)
  doc.build(story)
 else:
  raise ValueError('invalid_template')
 return result.getvalue()
