import test from 'node:test';import assert from 'node:assert/strict';
import {renderDocx,renderXlsx,extractOffice,parseCsv,toCsv} from '../src/office.ts';
import {execFileSync} from 'node:child_process';import {writeFileSync,mkdtempSync} from 'node:fs';import {join} from 'node:path';import {tmpdir} from 'node:os';
const py=(code:string,file:string)=>execFileSync('.venv-docs/bin/python',['-I','-c',code,file]).toString();
test('csv parse/serialize round-trips quotes, commas, newlines and semicolon input',()=>{
 const rows=parseCsv('nome,città,note\n"Rahman, Amina",Bologna,"riga1\nriga2"\nLi,"Prato",\n');
 assert.deepEqual(rows,[['nome','città','note'],['Rahman, Amina','Bologna','riga1\nriga2'],['Li','Prato','']]);
 assert.deepEqual(parseCsv('a;b\n1;2'),[['a','b'],['1','2']],'semicolon (Italian Excel) is detected');
 assert.equal(toCsv(rows),'nome,città,note\r\n"Rahman, Amina",Bologna,"riga1\nriga2"\r\nLi,Prato,\r\n');
 assert.deepEqual(parseCsv(toCsv(rows)),rows);
});
test('xlsx render from CSV text is a real workbook the python side reads back; caps enforced',async()=>{
 const xlsx=await renderXlsx('tabella.xlsx','nome,ore\nAmina,38\n"Li, Wei",40');
 assert.equal(xlsx.subarray(0,2).toString(),'PK');
 const dir=mkdtempSync(join(tmpdir(),'nova-office-'));const f=join(dir,'t.xlsx');writeFileSync(f,xlsx);
 const back=py("import sys,openpyxl;wb=openpyxl.load_workbook(sys.argv[1],read_only=True);ws=wb.active;print(ws.title);[print(list(r)) for r in ws.iter_rows(values_only=True)]",f);
 assert.ok(back.includes("['nome', 'ore']"));assert.ok(back.includes("['Li, Wei', 40]"),back);
 await assert.rejects(renderXlsx('t.xlsx',Array.from({length:2001},()=>'a,b').join('\n')),/too_many_rows/);
 await assert.rejects(renderXlsx('t.xlsx','=HYPERLINK("http://x","y"),2'),/formula/);
});
test('docx render from markdown-ish text is a real document; headings, bullets, escaped text',async()=>{
 const docx=await renderDocx('lettera.docx','# Lettera di presentazione\n## Esperienza\nTesto con <tag> & simboli\n- punto uno\n- punto due');
 assert.equal(docx.subarray(0,2).toString(),'PK');
 const dir=mkdtempSync(join(tmpdir(),'nova-office-'));const f=join(dir,'l.docx');writeFileSync(f,docx);
 const back=py("import sys,docx;d=docx.Document(sys.argv[1]);[print(p.style.name,'|',p.text) for p in d.paragraphs]",f);
 assert.ok(/Title \| Lettera di presentazione|Heading 1 \| Lettera di presentazione/.test(back),back);assert.ok(back.includes('Heading 2 | Esperienza'));assert.ok(back.includes('List Bullet | punto uno'));assert.ok(back.includes('<tag> & simboli'));
});
test('extractOffice reads uploaded xlsx (first sheet → CSV) and docx (paragraph text), rejects non-office bytes',async()=>{
 const xlsx=await renderXlsx('t.xlsx','a,b\n1,"x,y"');const ex=await extractOffice('t.xlsx',xlsx);
 assert.equal(ex.status,'extracted');assert.equal(ex.method,'openpyxl');assert.equal(ex.text,'a,b\r\n1,"x,y"\r\n');assert.equal(ex.detectedType,'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
 const docx=await renderDocx('l.docx','# Titolo\nParagrafo uno\n- voce');const ed=await extractOffice('l.docx',docx);
 assert.equal(ed.status,'extracted');assert.equal(ed.method,'python-docx');assert.ok(ed.text!.includes('Titolo'));assert.ok(ed.text!.includes('Paragrafo uno'));assert.ok(ed.text!.includes('- voce'));
 const bad=await extractOffice('t.xlsx',Buffer.from('not a zip'));assert.equal(bad.status,'unsupported');
});
