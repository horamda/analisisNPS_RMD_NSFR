import test from "node:test";
import assert from "node:assert/strict";
import { normalizeRows, readCsvRows, unifiedStatus, inspectRows } from "./claim-normalizers.mjs";

test("RMD identity survives comment and score corrections", () => {
  const original = { Rmd_rating_id: "123", Comentario: "A", Puntuacion: 1 };
  assert.equal(normalizeRows("RMD", [original])[0].dedupe_key,
    normalizeRows("RMD", [{ ...original, Comentario: "B", Puntuacion: 2 }])[0].dedupe_key);
});
test("ticket identity is shared between Sheet and Excel", () => {
  assert.equal(normalizeRows("BEES_CARE", [{ "ID Ticket": "123" }])[0].dedupe_key,
    normalizeRows("SHEET_BEES_CARE", [{ "ID Ticket": "123" }])[0].dedupe_key);
});
test("empty CSV is accepted", () => assert.deepEqual(readCsvRows(""), []));

test('all claim sources exclude 2024 and include January 1, 2025',()=>{
  const fixtures=[
    ['NPS',{'COD CLIENTE DIST':'123',SCORE:2},'FECHA ENC'],
    ['RMD',{Rmd_rating_id:'123',Puntuacion:2},'Fecha Puntuacion'],
    ['BEES_CARE',{'ID Ticket':'123'},'FECHA CREACION'],
    ['SHEET_TICKETS_BEES_CARE',{'ID Ticket':'123'},'Fecha de ingreso de ticket'],
  ];
  for(const [source,row,key] of fixtures){
    const result=inspectRows(source,[{...row,[key]:'31/12/2024'},{...row,[key]:'01/01/2025'},{...row,[key]:'01/01/2026'}]);
    assert.equal(result.claims.length,2,source);
    assert.equal(result.issues['Fecha de ingreso anterior a 2025'],1,source);
  }
});

test('semicolon CSV and quoted comments keep their columns',()=>{
  assert.deepEqual(readCsvRows('ID Ticket;Respuesta\n123;"Texto, con coma"'),[{'ID Ticket':'123',Respuesta:'Texto, con coma'}]);
  assert.deepEqual(readCsvRows('ID Ticket,Respuesta\n123,"Texto; con punto y coma"'),[{'ID Ticket':'123',Respuesta:'Texto; con punto y coma'}]);
  assert.throws(()=>readCsvRows('<html>Error</html>'),/HTML/);
});
test('reply date is never imported as response text',()=>{
 const [c]=normalizeRows('SHEET_NPS2',[{FECHA:'01/09/2026',COD_CLIENTE_DISTRIBUIDOR:'123',SCORE:2,CATEGORIA:'Detractor','Fecha respuesta':'02/09/2026'}]);
 assert.equal(c.response,'');assert.ok(c.answered_at);
});

test("historical completed states normalize to closed", () => {
  for (const value of ["COMPLETO", "COMPLETADO", "Cerrado fuera del SLA"]) assert.equal(unifiedStatus(value), "Cerrado");
});
test("NPS history maps management fields without assuming closure from a reply", () => {
  const [c] = normalizeRows("SHEET_NPS2", [{FECHA:"01/09/2026",COD_CLIENTE_DISTRIBUIDOR:"123",SCORE:2,CATEGORIA:"Detractor",PRIMARY_DRIVER:"Entrega","Fecha respuesta":"02/09/2026","PLAN DE ACCION":"Llamar"}]);
  assert.equal(c.requires_management,true);
  assert.equal(c.status,"En gestion");
  assert.equal(c.raw["PLAN DE ACCION"],"Llamar");
  assert.ok(c.answered_at);
});

test('Bees Care maps exact reply headers and never confuses responder with ticket ID', () => {
  const [c] = normalizeRows('SHEET_BEES_CARE', [{
    'Forma de ingreso':'Manual','N° Cliente':'123','Fecha de ingreso de ticket':'04/05/2025',
    'Comentario del cliente':'Consulta','Fecha de contestacion':'04/05/2025',
    'Quien contesto el ticket':'Responsable','Respuesta':'Respuesta registrada','Dias resolucion':0,'Cumplimiento SLA':'OK',
  }]);
  assert.equal(c.external_id,'');
  assert.equal(c.answered_by,'Responsable');
  assert.equal(c.answered_at,'2025-05-04T00:00:00.000Z');
  assert.equal(c.resolution_days,0);
  assert.equal(c.internal_sla_status,'OK');
  assert.equal(c.status,'En gestion');
  assert.equal(c.closed_at,null);
});

test('RMD delivery date is not a claim closure date', () => {
  const [c] = normalizeRows('RMD',[{Rmd_rating_id:'123',Puntuacion:2,'Fecha Entrega':'01/09/2026',STATUS:'COMPLETO','FECHA RTA':'03/09/2026'}]);
  assert.equal(c.closed_at,'2026-09-03T00:00:00.000Z');
  assert.equal(c.source_resolved_at,null);
});

test('source mismatch fails before importing a wrong worksheet', () => {
  assert.throws(()=>normalizeRows('NPS',[{Rmd_rating_id:'123','#SCORE':2}]),/contiene datos RMD/);
});

test('low NPS score requires management even without category', () => {
  const [c]=normalizeRows('NPS',[{'COD CLIENTE DIST':'123','FECHA ENC':'01/09/2026',SCORE:2}]);
  assert.equal(c.requires_management,true);
});
test("RMD auxiliary rows are not claims and promoters remain classified", () => {
  assert.equal(normalizeRows("SHEET_RMD2", [{STATUS:"COMPLETO"}]).length,0);
  const [c]=normalizeRows("SHEET_RMD2", [{Rmd_rating_id:"99","#SCORE":5,STATUS:"COMPLETO"}]);
  assert.equal(c.requires_management,false);
  assert.equal(c.status,"Cerrado");
});
