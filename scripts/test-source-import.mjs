import assert from "node:assert/strict";
import { ensureSchema, withClient, getPool } from "../lib/db.mjs";
import { importSource } from "../lib/source-importer.mjs";
try {
  await ensureSchema();
  try { await withClient(async client=>{
    const ticket=`test-${Date.now()}`;
    const rows=[{Rmd_rating_id:ticket,Puntuacion:2,Comentario:"original",STATUS:"COMPLETO",RESPONSABLE:"historico"}];
    const first=await importSource({source:"RMD",fileName:"test",rows,client});
    assert.equal(first.inserted,1);
    const c=(await client.query("SELECT * FROM claims WHERE external_id=$1",[ticket])).rows[0];
    assert.equal(c.status,"Cerrado");
    assert.equal(c.owner_name,"historico");
    await client.query("UPDATE claims SET response='manual',status='En gestion' WHERE id=$1",[c.id]);
    const repeated=await importSource({source:"RMD",fileName:"test",rows,client});
    assert.equal(repeated.alreadyImported,true);
    await importSource({source:"RMD",fileName:"test2",rows:[{...rows[0],Comentario:"corregido",Respuesta:"externa"}],client});
    const after=(await client.query("SELECT * FROM claims WHERE id=$1",[c.id])).rows[0];
    assert.equal(after.response,"manual");assert.equal(after.status,"En gestion");
    const positive=await importSource({source:"RMD",fileName:"positive",rows:[{Rmd_rating_id:ticket+'p',Puntuacion:5}],client});
    assert.equal(positive.inserted,0);assert.equal(positive.withoutManagement,1);
    const beesTicket=String(Date.now());
    const bees=await importSource({source:'BEES_CARE',fileName:'bees-excel',rows:[{'ID Ticket':beesTicket,'ID CLIENTE':'999999'}],client});
    assert.equal(bees.inserted,1);
    const sheet=await importSource({source:'SHEET_TICKETS_BEES_CARE',fileName:'bees-sheet',rows:[{'ID Ticket':beesTicket,'ID CLIENTE':'999999',Respuesta:'historica'}],client});
    assert.equal(sheet.inserted,0);assert.equal(sheet.updated,1);
    const npsRow={'COD CLIENTE DIST':'999999','FECHA ENC':'2200-01-01T12:00:00Z',SCORE:1,CATEGORIA:'Detractor'};
    const nps=await importSource({source:'NPS',fileName:'repeated-nps',rows:[{...npsRow,COMENTARIO:'a',PRIMARY_DRIVER:'Entrega'},{...npsRow,COMENTARIO:'b',PRIMARY_DRIVER:'Precio'}],client});
    assert.equal(nps.inserted,1);assert.equal(nps.duplicateRows,1);
    const merged=(await client.query("SELECT * FROM claims WHERE customer_id='999999' AND source='NPS' AND opened_at=$1",[npsRow['FECHA ENC']])).rows[0];
    assert.equal(merged.driver_primary,'Entrega\nPrecio');
    assert.equal(merged.raw._source_rows.length,2);
    const unresolved=await importSource({source:'RMD',fileName:'missing-score',rows:[{Rmd_rating_id:ticket+'missing','#COMMENT':'Revisar entrega'}],client});
    assert.equal(unresolved.inserted,0);
    assert.equal(unresolved.issues['RMD sin puntaje válido'],1);
    const reply={'ID Ticket':beesTicket,'ID CLIENTE':'999999','Fecha de contestacion':'04/05/2025','Quien contesto el ticket':'Operador',Respuesta:'Contestada'};
    await importSource({source:'SHEET_TICKETS_BEES_CARE',fileName:'bees-reply',rows:[reply],client});
    const answered=(await client.query('SELECT * FROM claims WHERE external_id=$1',[beesTicket])).rows[0];
    assert.equal(answered.status,'En gestion');
    assert.equal(answered.answered_by,'Operador');
    assert.ok(answered.answered_at);
    assert.equal(answered.closed_at,null);
    throw new Error("TEST_ROLLBACK");
  }); }catch(e){if(e.message!=="TEST_ROLLBACK")throw e;}
  console.log("PASS: estados, reimportacion, gestion manual y archivo sin reclamo; pruebas revertidas");
}finally{await getPool().end();}
