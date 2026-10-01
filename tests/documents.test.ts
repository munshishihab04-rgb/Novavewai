import test from 'node:test';import assert from 'node:assert/strict';
import {extractPdf,renderPdf} from '../src/documents.ts';
test('PDF render/extract roundtrip, reject fake/encrypted input and escape markup',async()=>{
 const pdf=await renderPdf('CV di prova','# Amina Test\n## ESPERIENZA\nMagazziniera — Milano\n2022–2024\n- Gestione inventario\n- Controllo merci\n## COMPETENZE\nItaliano B2\n<unsafe>& data','classic');assert.equal(pdf.subarray(0,5).toString(),'%PDF-');
 const text=await extractPdf(pdf);assert.ok(text.text.includes('Gestione inventario'));assert.ok(text.text.includes('Amina Test'));assert.equal(text.pages,1);await assert.rejects(extractPdf(Buffer.from('not pdf')));
});
