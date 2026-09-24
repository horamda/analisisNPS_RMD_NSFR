import pg from "pg";

const { Pool } = pg;

let pool;

export function getPool() {
  if (!pool) {
    const connectionString = process.env.DATABASE_URL;
    if (!connectionString) throw new Error("DATABASE_URL no configurada");
    pool = new Pool({
      connectionString,
      ssl: process.env.DATABASE_SSL === "true" ? { rejectUnauthorized: false } : undefined,
    });
  }
  return pool;
}

export async function query(text, params = []) {
  return getPool().query(text, params);
}

export async function withClient(fn) {
  const client = await getPool().connect();
  try {
    await client.query("BEGIN");
    const result = await fn(client);
    await client.query("COMMIT");
    return result;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

export async function ensureSchema() {
  await query(`
    CREATE TABLE IF NOT EXISTS users (
      id BIGSERIAL PRIMARY KEY,
      username TEXT NOT NULL UNIQUE,
      password_hash TEXT NOT NULL,
      display_name TEXT NOT NULL,
      role TEXT NOT NULL CHECK (role IN ('admin','user','viewer')),
      active BOOLEAN NOT NULL DEFAULT true,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );

    CREATE TABLE IF NOT EXISTS import_batches (
      id BIGSERIAL PRIMARY KEY,
      source TEXT NOT NULL,
      file_name TEXT,
      imported_by BIGINT REFERENCES users(id),
      total_rows INTEGER NOT NULL DEFAULT 0,
      inserted_rows INTEGER NOT NULL DEFAULT 0,
      updated_rows INTEGER NOT NULL DEFAULT 0,
      skipped_rows INTEGER NOT NULL DEFAULT 0,
      error_rows INTEGER NOT NULL DEFAULT 0,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );

    CREATE TABLE IF NOT EXISTS customers (
      id BIGSERIAL PRIMARY KEY,
      customer_id TEXT NOT NULL UNIQUE,
      branch TEXT,
      legal_name TEXT,
      trade_name TEXT,
      phone TEXT,
      mobile TEXT,
      email TEXT,
      address TEXT,
      locality_code TEXT,
      locality_name TEXT,
      province_code TEXT,
      province_name TEXT,
      department_code TEXT,
      department_name TEXT,
      grouping_code TEXT,
      grouping_name TEXT,
      area_code TEXT,
      area_name TEXT,
      subchannel_code TEXT,
      subchannel_name TEXT,
      route_sales_code TEXT,
      route_sales_name TEXT,
      sales_rep_code TEXT,
      sales_rep_name TEXT,
      delivery_route_code TEXT,
      delivery_route_name TEXT,
      delivery_days TEXT,
      visit_days TEXT,
      active BOOLEAN NOT NULL DEFAULT true,
      raw JSONB NOT NULL DEFAULT '{}'::jsonb,
      first_import_batch_id BIGINT REFERENCES import_batches(id),
      last_import_batch_id BIGINT REFERENCES import_batches(id),
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );

    CREATE TABLE IF NOT EXISTS claims (
      id BIGSERIAL PRIMARY KEY,
      dedupe_key TEXT NOT NULL UNIQUE,
      source TEXT NOT NULL,
      source_label TEXT,
      external_id TEXT,
      customer_id TEXT,
      customer_name TEXT,
      requester_name TEXT,
      subject TEXT,
      driver_primary TEXT,
      driver_secondary TEXT,
      comment TEXT,
      score NUMERIC,
      category TEXT,
      order_number TEXT,
      distributor_code TEXT,
      distributor_name TEXT,
      location TEXT,
      segment_sales TEXT,
      segment_market TEXT,
      opened_at TIMESTAMPTZ,
      source_resolved_at TIMESTAMPTZ,
      sla_hours NUMERIC,
      source_sla_status TEXT,
      requires_management BOOLEAN NOT NULL DEFAULT false,
      status TEXT NOT NULL DEFAULT 'Nuevo',
      owner_user_id BIGINT REFERENCES users(id),
      owner_name TEXT,
      answered_at TIMESTAMPTZ,
      answered_by TEXT,
      response TEXT,
      action_log TEXT,
      closed_at TIMESTAMPTZ,
      internal_sla_status TEXT,
      resolution_days NUMERIC,
      raw JSONB NOT NULL DEFAULT '{}'::jsonb,
      first_import_batch_id BIGINT REFERENCES import_batches(id),
      last_import_batch_id BIGINT REFERENCES import_batches(id),
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );

    CREATE TABLE IF NOT EXISTS claim_history (
      id BIGSERIAL PRIMARY KEY,
      claim_id BIGINT NOT NULL REFERENCES claims(id) ON DELETE CASCADE,
      user_id BIGINT REFERENCES users(id),
      event_type TEXT NOT NULL,
      field_name TEXT,
      old_value TEXT,
      new_value TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );

    CREATE INDEX IF NOT EXISTS idx_claims_source ON claims(source);
    CREATE INDEX IF NOT EXISTS idx_claims_status ON claims(status);
    CREATE INDEX IF NOT EXISTS idx_claims_customer ON claims(customer_id);
    CREATE INDEX IF NOT EXISTS idx_claims_opened ON claims(opened_at);
    CREATE INDEX IF NOT EXISTS idx_customers_name ON customers(legal_name);
    CREATE INDEX IF NOT EXISTS idx_customers_locality ON customers(locality_name);
    ALTER TABLE claims ADD COLUMN IF NOT EXISTS customer_record_id BIGINT REFERENCES customers(id);
    ALTER TABLE claims ADD COLUMN IF NOT EXISTS manual_data JSONB NOT NULL DEFAULT '{}'::jsonb;
    CREATE INDEX IF NOT EXISTS idx_claims_customer_record ON claims(customer_record_id);
    CREATE TABLE IF NOT EXISTS source_imports (
      id BIGSERIAL PRIMARY KEY,
      source TEXT NOT NULL,
      file_name TEXT NOT NULL,
      digest TEXT NOT NULL,
      payload JSONB NOT NULL,
      report JSONB,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      UNIQUE(source,digest)
    );
    CREATE TABLE IF NOT EXISTS claims_migration_backups (
      id BIGSERIAL PRIMARY KEY,
      payload JSONB NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
    CREATE TABLE IF NOT EXISTS claim_statuses (
      id BIGSERIAL PRIMARY KEY, name TEXT NOT NULL UNIQUE,
      active BOOLEAN NOT NULL DEFAULT true, terminal BOOLEAN NOT NULL DEFAULT false, import_name TEXT UNIQUE
    );
    CREATE TABLE IF NOT EXISTS claim_owners (
      id BIGSERIAL PRIMARY KEY, name TEXT NOT NULL UNIQUE,
      active BOOLEAN NOT NULL DEFAULT true
    );
    CREATE TABLE IF NOT EXISTS import_conflicts (
      id BIGSERIAL PRIMARY KEY,
      source_import_id BIGINT NOT NULL REFERENCES source_imports(id),
      reason TEXT NOT NULL,
      candidate_ids JSONB NOT NULL DEFAULT '[]',
      payload JSONB NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
    ALTER TABLE claim_statuses ADD COLUMN IF NOT EXISTS import_name TEXT UNIQUE;
    INSERT INTO claim_statuses(name,terminal,import_name)
      SELECT name,terminal,name FROM (VALUES ('Nuevo',false),('En gestion',false),('Esperando respuesta',false),('Cerrado',true),('Descartado',true)) AS defaults(name,terminal)
      WHERE NOT EXISTS (SELECT 1 FROM claim_statuses) ON CONFLICT DO NOTHING;
    INSERT INTO claim_statuses(name) SELECT DISTINCT status FROM claims WHERE status IS NOT NULL ON CONFLICT DO NOTHING;
    INSERT INTO claim_owners(name) SELECT DISTINCT trim(owner_name) FROM claims WHERE trim(coalesce(owner_name,''))<>'' ON CONFLICT DO NOTHING;
  `);
  for (const table of ["nps_records", "rmd_records", "bees_care_records"]) {
    await query(`CREATE TABLE IF NOT EXISTS ${table} (
      id BIGSERIAL PRIMARY KEY,
      claim_id BIGINT NOT NULL REFERENCES claims(id),
      import_batch_id BIGINT REFERENCES import_batches(id),
      source TEXT NOT NULL,
      payload JSONB NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    ); CREATE INDEX IF NOT EXISTS idx_${table}_claim ON ${table}(claim_id)`);
  }
}
