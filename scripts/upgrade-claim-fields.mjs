import { ensureSchema, withClient, getPool } from '../lib/db.mjs';
try {
  await ensureSchema();
  await withClient(async client=>{
    const candidates=await client.query(`SELECT c.id,c.response FROM claims c
      WHERE c.response IS NOT NULL AND (c.response=c.raw->>'Fecha respuesta' OR c.response=c.raw->>'FECHA RTA')
      AND NOT EXISTS(SELECT 1 FROM claim_history h WHERE h.claim_id=c.id AND h.field_name='response')
      AND coalesce(c.raw->>'Respuesta',c.raw->>'OBSERVACIONES DEL RESPONSABLE','')=''`);
    if(candidates.rowCount){
      await client.query('INSERT INTO claims_migration_backups(payload) VALUES($1)',[JSON.stringify({repair:'response-date',rows:candidates.rows})]);
      await client.query('UPDATE claims SET response=NULL WHERE id=ANY($1::bigint[])',[candidates.rows.map(r=>r.id)]);
    }
    console.log(JSON.stringify({repaired:candidates.rowCount}));
  });
}finally{await getPool().end();}
