import { ensureSchema, getPool, withClient } from "../lib/db.mjs";
import { normalizeRows } from "../lib/claim-normalizers.mjs";

try {
  await ensureSchema();
  const result = await withClient(async (client) => {
    const { rows } = await client.query("SELECT * FROM claims ORDER BY id FOR UPDATE");
    let recovered = 0;
    let conflicts = 0;
    for (const row of rows) {
      const normalized = normalizeRows(row.source, [row.raw])[0];
      if (!normalized) continue;
      const other = await client.query("SELECT id FROM claims WHERE dedupe_key=$1 AND id<>$2", [normalized.dedupe_key, row.id]);
      if (other.rowCount) conflicts++;
      else await client.query("UPDATE claims SET dedupe_key=$1 WHERE id=$2", [normalized.dedupe_key, row.id]);
      for (const field of ["answered_at", "answered_by", "response", "action_log", "resolution_days", "internal_sla_status"]) {
        const value = normalized[field];
        if (value === undefined || value === null || value === "") continue;
        const updated = await client.query(
          `UPDATE claims SET ${field}=$2 WHERE id=$1 AND ${field} IS NULL
           AND NOT EXISTS (SELECT 1 FROM claim_history WHERE claim_id=$1 AND field_name=$3)`,
          [row.id, value, field]
        );
        recovered += updated.rowCount;
      }
      const table = row.source.includes("NPS") ? "nps_records" : row.source.includes("RMD") ? "rmd_records" : "bees_care_records";
      await client.query(
        `INSERT INTO ${table} (claim_id,import_batch_id,source,payload)
         SELECT $1,$2,$3,$4 WHERE NOT EXISTS (SELECT 1 FROM ${table} WHERE claim_id=$1)`,
        [row.id, row.last_import_batch_id, row.source, row.raw]
      );
    }
    const linked = await client.query("UPDATE claims SET customer_record_id=customers.id FROM customers WHERE claims.customer_id=customers.customer_id AND claims.customer_record_id IS DISTINCT FROM customers.id");
    return { claims: rows.length, recoveredFields: recovered, linkedCustomers: linked.rowCount, conflicts };
  });
  console.log(JSON.stringify(result));
} finally {
  await getPool().end();
}
