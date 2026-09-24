import crypto from "node:crypto";
import { identityResolver } from './claim-identity.mjs';
import { linkCustomers } from "./customer-links.mjs";
import { withClient } from "./db.mjs";
import { inspectRows } from "./claim-normalizers.mjs";
import { mergeClaimRows } from './claim-merge.mjs';

export async function importSource({ source, fileName, rows, userId = null, client: supplied }) {
  if (!["NPS", "RMD", "BEES_CARE", "SHEET_NPS2", "SHEET_RMD2", "SHEET_BEES_CARE", "SHEET_TICKETS_BEES_CARE"].includes(source)) throw new Error("Origen invalido");
  const run = async client => {
    await client.query("SELECT pg_advisory_xact_lock(846219)");
    const payload = JSON.stringify(rows);
    const digest = crypto.createHash("sha256").update("mapping-v4:" + payload).digest("hex");
    const archive = await client.query("INSERT INTO source_imports(source,file_name,digest,payload) VALUES($1,$2,$3,$4) ON CONFLICT DO NOTHING RETURNING id", [source,fileName,digest,payload]);
    if (!archive.rowCount) return {total:rows.length,inserted:0,updated:0,skipped:rows.length,alreadyImported:true};
    const {claims: normalized, issues} = inspectRows(source, rows);
    const importedOwners=[...new Set(normalized.map(c=>c.owner_name?.trim()).filter(Boolean))];
    if(importedOwners.length)await client.query("INSERT INTO claim_owners(name) SELECT unnest($1::text[]) ON CONFLICT DO NOTHING",[importedOwners]);
    const statusMap=(await client.query("SELECT name,import_name FROM claim_statuses WHERE import_name IS NOT NULL")).rows;
    for(const claim of normalized)claim.status=statusMap.find(s=>s.import_name===claim.status)?.name||claim.status;
    const unique = new Map();
    let ambiguous = 0;
    let duplicateRows=0;
    const existing=(await client.query('SELECT id,dedupe_key,source,external_id,customer_id,opened_at FROM claims')).rows;
    const resolve=identityResolver(existing);
    const conflicts=[];
    for (const c of normalized.filter(c=>c.requires_management)) {
      const match=resolve(c);
      if(match.conflict){ambiguous++;conflicts.push({reason:match.conflict,candidate_ids:match.candidates.map(x=>x.id).filter(Boolean),payload:c.raw});continue;}
      c.dedupe_key=match.key;
      if(unique.has(c.dedupe_key)){
        const first=unique.get(c.dedupe_key);
        if(first.score!==c.score || first.internal_sla_status && c.internal_sla_status && first.internal_sla_status!==c.internal_sla_status || first.status!==c.status){
          ambiguous++;conflicts.push({reason:'Mismo caso con puntaje, estado o SLA diferente; revisar antes de combinar',candidate_ids:[],payload:c.raw});continue;
        }
        duplicateRows++;unique.set(c.dedupe_key,mergeClaimRows(first,c));continue;
      }
      unique.set(c.dedupe_key,c);
    }
    if(conflicts.length)await client.query(`INSERT INTO import_conflicts(source_import_id,reason,candidate_ids,payload)
      SELECT $2,reason,candidate_ids,payload FROM jsonb_to_recordset($1::jsonb) AS x(reason text,candidate_ids jsonb,payload jsonb)`,[JSON.stringify(conflicts),archive.rows[0].id]);
    const claims = [...unique.values()].filter(c => c.requires_management);
    const batch = await client.query("INSERT INTO import_batches(source,file_name,imported_by,total_rows) VALUES($1,$2,$3,$4) RETURNING id",[source,fileName,userId,rows.length]);
    const batchId = batch.rows[0].id;
    let inserted=0, updated=0;
    const manual = ["status","owner_name","answered_at","answered_by","response","action_log","closed_at","internal_sla_status","resolution_days"];
    for (let offset=0; offset<claims.length; offset+=500) {
      const chunk=claims.slice(offset,offset+500).map(c=>Object.fromEntries(Object.entries(c).map(([k,v])=>[k,v===""?null:v])));
      const fields=["dedupe_key","source","source_label","external_id","customer_id","customer_name","subject","driver_primary","driver_secondary","comment","score","category","opened_at","source_resolved_at","source_sla_status","sla_hours","requires_management","raw",...manual];
      const recovered=manual.filter(f=>f!=="status").map(f=>`${f}=CASE WHEN claims.${f} IS NULL AND NOT EXISTS (SELECT 1 FROM claim_history h WHERE h.claim_id=claims.id AND h.field_name='${f}') THEN EXCLUDED.${f} ELSE claims.${f} END`);
      // Refresh source descriptions; manual_data overrides remain untouched.
      for(const f of ['subject','driver_primary','driver_secondary','comment','raw'])recovered.push(`${f}=COALESCE(EXCLUDED.${f},claims.${f})`);
      recovered.push(`status=CASE WHEN claims.status=(SELECT name FROM claim_statuses WHERE import_name='Nuevo' LIMIT 1)
        AND EXCLUDED.status=(SELECT name FROM claim_statuses WHERE import_name='En gestion' LIMIT 1)
        AND NOT EXISTS (SELECT 1 FROM claim_history h WHERE h.claim_id=claims.id AND h.field_name='status')
        THEN EXCLUDED.status ELSE claims.status END`);
      recovered.push("customer_name=COALESCE(NULLIF(claims.customer_name,''),EXCLUDED.customer_name)");
      const result=await client.query(`INSERT INTO claims(${fields.join(",")},first_import_batch_id,last_import_batch_id)
        SELECT ${fields.join(",")},$2,$2 FROM jsonb_populate_recordset(NULL::claims,$1::jsonb)
        ON CONFLICT(dedupe_key) DO UPDATE SET ${recovered.join(",")},last_import_batch_id=$2
        RETURNING id,dedupe_key,(xmax=0) AS inserted`,[JSON.stringify(chunk),batchId]);
      inserted+=result.rows.filter(r=>r.inserted).length;
      updated+=result.rows.filter(r=>!r.inserted).length;
      const table=source.includes("NPS")?"nps_records":source.includes("RMD")?"rmd_records":"bees_care_records";
      await client.query(`INSERT INTO ${table}(claim_id,import_batch_id,source,payload)
        SELECT c.id,$2,$3,x.raw FROM jsonb_to_recordset($1::jsonb) AS x(dedupe_key text,raw jsonb)
        JOIN claims c USING(dedupe_key)`,[JSON.stringify(chunk),batchId,source]);
    }
    await linkCustomers(client);
    const report={batchId,total:rows.length,records:normalized.length,inserted,updated,duplicateRows,skipped:rows.length-normalized.length,issues,withoutSla:claims.filter(c=>!c.internal_sla_status).length,withoutManagement:normalized.filter(c=>!c.requires_management).length,ambiguous};
    await client.query("UPDATE import_batches SET inserted_rows=$1,updated_rows=$2,skipped_rows=$3 WHERE id=$4",[inserted,updated,report.skipped,batchId]);
    await client.query("UPDATE source_imports SET report=$1 WHERE id=$2",[report,archive.rows[0].id]);
    return report;
  };
  return supplied ? run(supplied) : withClient(run);
}
