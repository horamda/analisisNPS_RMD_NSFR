import bcrypt from "bcryptjs";
import { linkCustomers } from "./customer-links.mjs";
import { query, withClient } from "./db.mjs";
import { CLAIMS_START_DATE } from './claims-config.mjs';

const IMPORT_FIELDS = [
  "source", "source_label", "external_id", "customer_id", "customer_name", "requester_name",
  "subject", "driver_primary", "driver_secondary", "comment", "score", "category", "order_number",
  "distributor_code", "distributor_name", "location", "segment_sales", "segment_market", "opened_at",
  "source_resolved_at", "sla_hours", "source_sla_status", "requires_management", "raw",
];

const MANUAL_FIELDS = ["status", "owner_user_id", "owner_name", "answered_at", "answered_by", "response", "action_log", "closed_at", "internal_sla_status", "resolution_days", "manual_data"];

export async function ensureAdminUser() {
  const username = process.env.ADMIN_USERNAME || "admin";
  const password = process.env.ADMIN_PASSWORD || "admin1234";
  const exists = await query("SELECT id FROM users WHERE username = $1", [username]);
  if (exists.rowCount) return;
  const hash = await bcrypt.hash(password, 10);
  await query(
    "INSERT INTO users (username, password_hash, display_name, role) VALUES ($1,$2,$3,'admin')",
    [username, hash, "Administrador"]
  );
}

export async function importClaims({ source, fileName, claims, userId }) {
  return withClient(async (client) => {
    const batch = await client.query(
      "INSERT INTO import_batches (source, file_name, imported_by, total_rows) VALUES ($1,$2,$3,$4) RETURNING id",
      [source, fileName || null, userId || null, claims.length]
    );
    const batchId = batch.rows[0].id;
    let inserted = 0;
    let updated = 0;
    let skipped = 0;

    for (const claim of claims) {
      if (!claim.dedupe_key) {
        skipped += 1;
        continue;
      }
      if (claim.legacy_dedupe_key && claim.legacy_dedupe_key !== claim.dedupe_key) {
        const existing = await client.query("SELECT id FROM claims WHERE dedupe_key=$1", [claim.dedupe_key]);
        const legacy = await client.query("SELECT id FROM claims WHERE dedupe_key=$1", [claim.legacy_dedupe_key]);
        if (existing.rowCount && legacy.rowCount && existing.rows[0].id !== legacy.rows[0].id) {
          throw new Error("Existen reclamos historicos coincidentes que requieren conciliacion antes de importar.");
        }
        if (!existing.rowCount && legacy.rowCount) {
          await client.query("UPDATE claims SET dedupe_key=$1 WHERE id=$2", [claim.dedupe_key, legacy.rows[0].id]);
        }
      }
      const columns = ["dedupe_key", ...IMPORT_FIELDS, ...MANUAL_FIELDS, "first_import_batch_id", "last_import_batch_id"];
      const values = columns.map((col) => {
        if (col === "first_import_batch_id" || col === "last_import_batch_id") return batchId;
        return claim[col] === "" ? null : claim[col] ?? null;
      });
      const placeholders = columns.map((_, i) => `$${i + 1}`).join(",");
      const updateSet = IMPORT_FIELDS
        .map((field) => `${field} = COALESCE(EXCLUDED.${field}, claims.${field})`)
        .concat(["last_import_batch_id = EXCLUDED.last_import_batch_id", "updated_at = now()"])
        .join(", ");
      const result = await client.query(
        `INSERT INTO claims (${columns.join(",")}) VALUES (${placeholders})
         ON CONFLICT (dedupe_key) DO UPDATE SET ${updateSet}
         RETURNING (xmax = 0) AS inserted, id`,
        values
      );
      if (result.rows[0]?.inserted) inserted += 1;
      else updated += 1;
      const claimId = result.rows[0].id;
      // Recover historical fields only when nobody has edited them in the app.
      for (const field of MANUAL_FIELDS.filter((name) => name !== "status")) {
        if (claim[field] === undefined || claim[field] === null || claim[field] === "") continue;
        await client.query(
          `UPDATE claims SET ${field}=$2 WHERE id=$1 AND ${field} IS NULL
           AND NOT EXISTS (SELECT 1 FROM claim_history WHERE claim_id=$1 AND field_name=$3)`,
          [claimId, claim[field], field]
        );
      }
      const table = source.includes("NPS") ? "nps_records" : source.includes("RMD") ? "rmd_records" : "bees_care_records";
      await client.query(
        `INSERT INTO ${table} (claim_id, import_batch_id, source, payload) VALUES ($1,$2,$3,$4)`,
        [claimId, batchId, source, claim.raw || {}]
      );
      await client.query(
        "UPDATE claims SET customer_record_id=customers.id FROM customers WHERE claims.id=$1 AND claims.customer_id=customers.customer_id",
        [claimId]
      );
    }

    await client.query(
      "UPDATE import_batches SET inserted_rows=$1, updated_rows=$2, skipped_rows=$3 WHERE id=$4",
      [inserted, updated, skipped, batchId]
    );
    return { batchId, total: claims.length, inserted, updated, skipped };
  });
}

export async function listClaims(filters = {}) {
  if(filters.from&&filters.to&&filters.from>filters.to)throw Object.assign(new Error('El rango de fechas es invalido'),{status:400});
  for(const k of ['from','to'])if(filters[k]&&!/^\d{4}-\d{2}-\d{2}$/.test(filters[k]))throw Object.assign(new Error('Fecha invalida'),{status:400});
  const where = ['c.opened_at >= $1::timestamptz'];
  const params = [CLAIMS_START_DATE];
  const add = (sql, value) => {
    params.push(value);
    where.push(sql.replace("?", `$${params.length}`));
  };
  if (filters.status) add("status = ?", filters.status);
  if (filters.source) add("source = ?", filters.source);
  if (filters.owner === '__unassigned') where.push("coalesce(owner_name,'')=''");
  else if(filters.owner) add("owner_name = ?",filters.owner);
  if(filters.from) add("opened_at >= ?::date",filters.from);
  if(filters.to) add("opened_at < ?::date + interval '1 day'",filters.to);
  if(filters.score) add("score = ?::numeric",filters.score);
  if(filters.sla) add("internal_sla_status = ?",filters.sla);
  if(filters.locality) add("coalesce(nullif(c.manual_data->>'LOCALIDAD',''),nullif(c.raw->>'LOCALIDAD',''),customer.locality_name) = ?",filters.locality);
  if(filters.visited) add("upper(coalesce(c.manual_data->>'VISITADO',c.raw->>'VISITADO','')) = ?",filters.visited);
  if (filters.q) {
    const term = `%${filters.q}%`;
    params.push(term);
    const p=`$${params.length}`;
    where.push(`(c.customer_name ILIKE ${p} OR c.customer_id ILIKE ${p} OR c.external_id ILIKE ${p} OR c.subject ILIKE ${p} OR c.comment ILIKE ${p} OR customer.legal_name ILIKE ${p} OR customer.customer_id ILIKE ${p})`);
  }
  const result = await query(
    `SELECT c.*, u.username AS owner_username, count(*) OVER()::int AS filtered_total,
       CASE WHEN customer.id IS NULL THEN NULL ELSE jsonb_build_object('customer_id',customer.customer_id,'legal_name',customer.legal_name,'trade_name',customer.trade_name,'locality_name',customer.locality_name,'address',customer.address,'phone',coalesce(nullif(customer.phone,''),customer.mobile),'email',customer.email) END AS customer
     FROM claims c
     LEFT JOIN users u ON u.id = c.owner_user_id
     LEFT JOIN customers customer ON customer.id=c.customer_record_id
     ${where.length ? `WHERE ${where.join(" AND ")}` : ""}
     ORDER BY COALESCE(c.opened_at, c.created_at) DESC, c.id DESC
     LIMIT 50 OFFSET ${Math.max(0, Math.min(1000000, Math.floor(Number(filters.offset)||0)))}`,
    params
  );
  return result.rows;
}

export async function getClaimsSummary() {
  const result = await query(`
    SELECT
      count(*)::int AS total,
      count(*) FILTER (WHERE NOT EXISTS (SELECT 1 FROM claim_statuses s WHERE s.name=claims.status AND s.terminal))::int AS abiertos,
      count(*) FILTER (WHERE requires_management)::int AS requiere_gestion,
      count(*) FILTER (WHERE EXISTS (SELECT 1 FROM claim_statuses s WHERE s.name=claims.status AND s.terminal))::int AS cerrados
    FROM claims WHERE opened_at >= $1::timestamptz
  `, [CLAIMS_START_DATE]);
  const bySource = await query("SELECT source, count(*)::int total FROM claims WHERE opened_at >= $1::timestamptz GROUP BY source ORDER BY total DESC", [CLAIMS_START_DATE]);
  return { ...result.rows[0], bySource: bySource.rows };
}

export async function updateClaim(id, patch, user) {
  if (patch.manual_data !== undefined && (!patch.manual_data || typeof patch.manual_data !== "object" || Array.isArray(patch.manual_data))) throw new Error("Datos manuales invalidos");
  if(patch.status !== undefined){
    const state=await query("SELECT terminal FROM claim_statuses WHERE name=$1 AND active",[patch.status]);
    if(!state.rowCount)throw Object.assign(new Error('Estado invalido o inactivo'),{status:400});
    if(!Object.hasOwn(patch,'closed_at'))patch.closed_at=state.rows[0].terminal?new Date().toISOString():null;
  }
  if(patch.owner_name && !(await query("SELECT 1 FROM claim_owners WHERE name=$1 AND active",[patch.owner_name])).rowCount)throw Object.assign(new Error('Responsable invalido o inactivo'),{status:400});
  const allowed = MANUAL_FIELDS.filter((field) => Object.prototype.hasOwnProperty.call(patch, field));
  if (!allowed.length) return null;
  return withClient(async (client) => {
    const current = await client.query("SELECT * FROM claims WHERE id=$1", [id]);
    if (!current.rowCount) return null;
    const sets = allowed.map((field, i) => field === "manual_data" ? `manual_data=manual_data || $${i + 2}::jsonb` : `${field}=$${i + 2}`);
    const values = allowed.map((field) => patch[field] === "" ? null : patch[field] ?? null);
    const updated = await client.query(
      `UPDATE claims SET ${sets.join(",")}, updated_at=now() WHERE id=$1 RETURNING *`,
      [id, ...values]
    );
    for (const field of allowed) {
      const oldValue = current.rows[0][field] == null ? "" : typeof current.rows[0][field] === "object" ? JSON.stringify(current.rows[0][field]) : String(current.rows[0][field]);
      const newValue = patch[field] == null ? "" : typeof patch[field] === "object" ? JSON.stringify(patch[field]) : String(patch[field]);
      if (oldValue !== newValue) {
        await client.query(
          "INSERT INTO claim_history (claim_id,user_id,event_type,field_name,old_value,new_value) VALUES ($1,$2,'update',$3,$4,$5)",
          [id, user.id, field, oldValue, newValue]
        );
      }
    }
    return updated.rows[0];
  });
}

function clean(value) {
  if (value === null || value === undefined) return "";
  return String(value).replace(/\s+/g, " ").trim();
}

function pick(row, names) {
  const entries = Object.entries(row);
  const norm = (v) => clean(v).normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
  for (const name of names) {
    const found = entries.find(([key]) => norm(key) === norm(name));
    if (found) return found[1];
  }
  return "";
}

export function normalizeCustomers(rows) {
  return rows.map((row) => {
    const customerId = clean(pick(row, ["Cliente"]));
    if (!customerId) return null;
    return {
      customer_id: customerId,
      branch: clean(pick(row, ["Sucursal"])),
      legal_name: clean(pick(row, ["Razon social", "Razón social"])),
      trade_name: clean(pick(row, ["Nombre de fantasia", "Nombre de fantasía"])),
      phone: clean(pick(row, ["Telefonos", "Teléfonos"])),
      mobile: clean(pick(row, ["Movil", "Móvil"])),
      email: clean(pick(row, ["e-Mail"])),
      address: clean(pick(row, ["Domicilio"])),
      locality_code: clean(pick(row, ["Localidad"])),
      locality_name: clean(pick(row, ["Descripcion localidad", "Descripción localidad"])),
      province_code: clean(pick(row, ["Provincia"])),
      province_name: clean(pick(row, ["Descripcion provincia", "Descripción provincia"])),
      department_code: clean(pick(row, ["Departamento"])),
      department_name: clean(pick(row, ["Descripcion departamento", "Descripción departamento"])),
      grouping_code: clean(pick(row, ["Agrupacion", "Agrupación"])),
      grouping_name: clean(pick(row, ["Descripcion agrupacion", "Descripción agrupación"])),
      area_code: clean(pick(row, ["Area", "Área"])),
      area_name: clean(pick(row, ["Descripcion area", "Descripción área"])),
      subchannel_code: clean(pick(row, ["Subcanal"])),
      subchannel_name: clean(pick(row, ["Descripcion subcanal", "Descripción subcanal"])),
      route_sales_code: clean(pick(row, ["Fuerza de venta 1 Ruta de venta"])),
      route_sales_name: clean(pick(row, ["Fuerza de venta 1 Descripcion ruta de venta"])),
      sales_rep_code: clean(pick(row, ["Fuerza de venta 1 Personal comercial"])),
      sales_rep_name: clean(pick(row, ["Fuerza de venta 1 Descripcion personal comercial"])),
      delivery_route_code: clean(pick(row, ["Fuerza de venta 1 Ruta de distribucion"])),
      delivery_route_name: clean(pick(row, ["Fuerza de venta 1 Descripcion ruta de distribucion"])),
      delivery_days: clean(pick(row, ["Fuerza de venta 1 Dias de entrega"])),
      visit_days: clean(pick(row, ["Fuerza de venta 1 Dias de visita"])),
      active: !["si", "yes", "true"].includes(clean(pick(row, ["Anulado"])).toLowerCase()),
      raw: row,
    };
  }).filter(Boolean);
}

export async function importCustomers({ customers, fileName, userId }) {
  return withClient(async (client) => {
    const batch = await client.query(
      "INSERT INTO import_batches (source, file_name, imported_by, total_rows) VALUES ('CUSTOMERS',$1,$2,$3) RETURNING id",
      [fileName || null, userId || null, customers.length]
    );
    const batchId = batch.rows[0].id;
    const fields = ["branch","legal_name","trade_name","phone","mobile","email","address","locality_code","locality_name","province_code","province_name","department_code","department_name","grouping_code","grouping_name","area_code","area_name","subchannel_code","subchannel_name","route_sales_code","route_sales_name","sales_rep_code","sales_rep_name","delivery_route_code","delivery_route_name","delivery_days","visit_days","active","raw"];
    const columns = ["customer_id", ...fields, "first_import_batch_id", "last_import_batch_id"];
    let inserted = 0;
    let updated = 0;
    const chunkSize = 250;
    for (let offset = 0; offset < customers.length; offset += chunkSize) {
      const chunk = customers.slice(offset, offset + chunkSize);
      const values = [];
      const rowsSql = chunk.map((customer) => {
        const rowValues = columns.map((col) => {
          if (col === "first_import_batch_id" || col === "last_import_batch_id") return batchId;
          return customer[col] ?? null;
        });
        const placeholders = rowValues.map((value) => {
          values.push(value);
          return `$${values.length}`;
        });
        return `(${placeholders.join(",")})`;
      });
      const result = await client.query(
        `INSERT INTO customers (${columns.join(",")}) VALUES ${rowsSql.join(",")}
         ON CONFLICT (customer_id) DO UPDATE SET ${fields.map((f) => `${f}=${f === "active" || f === "raw" ? `EXCLUDED.${f}` : `COALESCE(NULLIF(EXCLUDED.${f}, ''), customers.${f})`}`).join(",")}, last_import_batch_id=EXCLUDED.last_import_batch_id, updated_at=now()
         RETURNING (xmax = 0) AS inserted`,
        values
      );
      inserted += result.rows.filter((row) => row.inserted).length;
      updated += result.rows.filter((row) => !row.inserted).length;
    }
    await client.query("UPDATE claims SET customer_record_id=customers.id FROM customers WHERE claims.customer_id=customers.customer_id AND claims.customer_record_id IS DISTINCT FROM customers.id");
    await linkCustomers(client);
    await client.query("UPDATE import_batches SET inserted_rows=$1, updated_rows=$2 WHERE id=$3", [inserted, updated, batchId]);
    return { batchId, total: customers.length, inserted, updated, skipped: 0 };
  });
}

export async function getCustomersSummary() {
  const result = await query("SELECT count(*)::int total, count(*) FILTER (WHERE active)::int active FROM customers");
  return result.rows[0];
}
