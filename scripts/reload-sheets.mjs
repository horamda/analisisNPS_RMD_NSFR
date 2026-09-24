import { ensureSchema, withClient, getPool } from "../lib/db.mjs";
import { SHEET_IMPORT_SOURCES } from "../lib/claims-config.mjs";
import { readCsvRows, normalizeRows } from "../lib/claim-normalizers.mjs";
import { importSource } from "../lib/source-importer.mjs";

try {
  const sources=[];
  for(const s of SHEET_IMPORT_SOURCES){
    const response=await fetch(s.url,{signal:AbortSignal.timeout(120000)});
    if(!response.ok)throw new Error(`${s.label}: HTTP ${response.status}`);
    const rows=readCsvRows(await response.text());
    const count=normalizeRows(s.source,rows).length;
    if(!count)throw new Error(`${s.label}: no se reconocieron registros`);
    console.log(JSON.stringify({sheet:s.label,rows:rows.length,records:count}));
    sources.push({...s,rows});
  }
  await ensureSchema();
  const reports=await withClient(async client=>{
    await client.query("SELECT pg_advisory_xact_lock(846219)");
    const imported=await client.query("SELECT count(*)::int n FROM source_imports");
    if(imported.rows[0].n)throw new Error("Ya existe una carga nueva. Usar Importaciones para actualizar sin reemplazar.");
    const history=await client.query("SELECT count(*)::int n FROM claim_history");
    if(history.rows[0].n)throw new Error("Hay gestion manual registrada; no se reemplazan los reclamos.");
    await client.query(`INSERT INTO claims_migration_backups(payload) SELECT jsonb_build_object(
      'claims',(SELECT coalesce(jsonb_agg(c),'[]') FROM claims c),
      'nps_records',(SELECT coalesce(jsonb_agg(c),'[]') FROM nps_records c),
      'rmd_records',(SELECT coalesce(jsonb_agg(c),'[]') FROM rmd_records c),
      'bees_care_records',(SELECT coalesce(jsonb_agg(c),'[]') FROM bees_care_records c))`);
    for(const table of ['nps_records','rmd_records','bees_care_records','claims'])await client.query(`DELETE FROM ${table}`);
    const reports=[];
    for(const s of sources)reports.push({sheet:s.label,...await importSource({source:s.source,fileName:s.url,rows:s.rows,client})});
    return reports;
  });
  console.log(JSON.stringify({committed:true,reports}));
}catch(error){console.error(error.message);process.exitCode=1;}finally{await getPool().end();}
