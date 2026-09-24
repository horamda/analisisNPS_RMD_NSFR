import bcrypt from "bcryptjs";
import { summarizeSla } from './sla-summary.mjs';
import { existingDuplicateGroups } from './claim-identity.mjs';
import { catalogs, mutateCatalog } from "./claim-catalogs.mjs";
import { importSource } from "./source-importer.mjs";
import jwt from "jsonwebtoken";
import { ensureSchema, query } from "./db.mjs";
import { ensureAdminUser, getClaimsSummary, getCustomersSummary, importClaims, importCustomers, listClaims, normalizeCustomers, updateClaim } from "./claims-service.mjs";
import { readCsvRows, readDelimitedRows, readWorkbookRows, normalizeRows } from "./claim-normalizers.mjs";
import { SHEET_IMPORT_SOURCES, USER_ROLES, CLAIMS_START_DATE } from "./claims-config.mjs";

const JSON_HEADERS = {
  "Content-Type": "application/json; charset=utf-8",
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
  "Access-Control-Allow-Methods": "GET, POST, PATCH, DELETE, OPTIONS",
};

let booted = false;

async function boot() {
  if (booted) return;
  await ensureSchema();
  await ensureAdminUser();
  booted = true;
}

export function readJsonBody(req) {
  return new Promise((resolve, reject) => {
    let body = "";
    req.on("data", (chunk) => { body += chunk; });
    req.on("end", () => {
      try {
        resolve(body ? JSON.parse(body) : {});
      } catch (error) {
        reject(error);
      }
    });
    req.on("error", reject);
  });
}

function secret() {
  return process.env.JWT_SECRET || process.env.ADMIN_PASSWORD || "dev-secret-change-me";
}

function send(res, status, data) {
  res.writeHead(status, JSON_HEADERS);
  res.end(JSON.stringify(data));
}

function tokenFrom(req) {
  const header = req.headers.authorization || "";
  return header.startsWith("Bearer ") ? header.slice(7) : "";
}

async function requireUser(req) {
  const token = tokenFrom(req);
  if (!token) throw Object.assign(new Error("No autenticado"), { status: 401 });
  try {
    return jwt.verify(token, secret());
  } catch {
    throw Object.assign(new Error("Sesion invalida"), { status: 401 });
  }
}

function requireRole(user, roles) {
  if (!roles.includes(user.role)) throw Object.assign(new Error("Permiso insuficiente"), { status: 403 });
}

function publicUser(row) {
  return {
    id: row.id,
    username: row.username,
    display_name: row.display_name,
    role: row.role,
    active: row.active,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

export async function handleApi(req, res) {
  const url = new URL(req.url || "/", "http://localhost");
  const pathname = url.pathname;
  if (!pathname.startsWith("/api/")) return false;
  if (req.method === "OPTIONS") {
    res.writeHead(204, JSON_HEADERS);
    res.end();
    return true;
  }

  try {
    await boot();

    if (pathname === "/api/auth/login" && req.method === "POST") {
      const body = await readJsonBody(req);
      const result = await query("SELECT * FROM users WHERE username=$1 AND active=true", [body.username || ""]);
      const user = result.rows[0];
      if (!user || !(await bcrypt.compare(body.password || "", user.password_hash))) {
        return send(res, 401, { error: { message: "Usuario o contrasena incorrectos" } });
      }
      const payload = publicUser(user);
      const token = jwt.sign(payload, secret(), { expiresIn: "12h" });
      return send(res, 200, { token, user: payload });
    }

    const user = await requireUser(req);
    if(pathname==='/api/import/conflicts' && req.method==='GET'){
      requireRole(user,['admin']);
      const result=await query('SELECT c.*,s.source,s.file_name FROM import_conflicts c JOIN source_imports s ON s.id=c.source_import_id ORDER BY c.id DESC LIMIT 100');
      const existing=await query('SELECT id,source,external_id,customer_id,opened_at FROM claims');
      return send(res,200,{conflicts:result.rows,existing:existingDuplicateGroups(existing.rows)});
    }
    if(pathname==='/api/claim-catalogs' && req.method==='GET')return send(res,200,await catalogs());
    const catalogMatch=pathname.match(/^\/api\/claim-catalogs\/(statuses|owners)(?:\/(\d+))?$/);
    if(catalogMatch && ['POST','PATCH','DELETE'].includes(req.method)){
      requireRole(user,['admin']);
      if((req.method==='POST')===Boolean(catalogMatch[2]))return send(res,400,{error:{message:'Operacion invalida'}});
      return send(res,200,await mutateCatalog(catalogMatch[1],catalogMatch[2],req.method,await readJsonBody(req)));
    }

    if (pathname === "/api/auth/me" && req.method === "GET") {
      return send(res, 200, { user });
    }

    if (pathname === "/api/users" && req.method === "GET") {
      requireRole(user, ["admin"]);
      const result = await query("SELECT * FROM users ORDER BY username");
      return send(res, 200, { users: result.rows.map(publicUser) });
    }

    if (pathname === "/api/users" && req.method === "POST") {
      requireRole(user, ["admin"]);
      const body = await readJsonBody(req);
      if (!body.username || !body.password) return send(res, 400, { error: { message: "Usuario y contrasena son obligatorios" } });
      if (!USER_ROLES.includes(body.role)) return send(res, 400, { error: { message: "Rol invalido" } });
      const hash = await bcrypt.hash(body.password, 10);
      const result = await query(
        "INSERT INTO users (username,password_hash,display_name,role,active) VALUES ($1,$2,$3,$4,$5) RETURNING *",
        [body.username, hash, body.display_name || body.username, body.role, body.active !== false]
      );
      return send(res, 201, { user: publicUser(result.rows[0]) });
    }

    const userMatch = pathname.match(/^\/api\/users\/(\d+)$/);
    if (userMatch && req.method === "PATCH") {
      requireRole(user, ["admin"]);
      const body = await readJsonBody(req);
      const fields = [];
      const params = [userMatch[1]];
      for (const field of ["display_name", "role", "active"]) {
        if (Object.prototype.hasOwnProperty.call(body, field)) {
          if (field === "role" && !USER_ROLES.includes(body.role)) return send(res, 400, { error: { message: "Rol invalido" } });
          params.push(body[field]);
          fields.push(`${field}=$${params.length}`);
        }
      }
      if (body.password) {
        params.push(await bcrypt.hash(body.password, 10));
        fields.push(`password_hash=$${params.length}`);
      }
      if (!fields.length) return send(res, 400, { error: { message: "Sin cambios" } });
      const result = await query(`UPDATE users SET ${fields.join(",")}, updated_at=now() WHERE id=$1 RETURNING *`, params);
      return send(res, 200, { user: publicUser(result.rows[0]) });
    }

    if (pathname === "/api/claims" && req.method === "GET") {
      return send(res, 200, { claims: await listClaims(Object.fromEntries(url.searchParams)) });
    }

    if (pathname === "/api/claims/summary" && req.method === "GET") {
      return send(res, 200, { summary: await getClaimsSummary() });
    }

    if (pathname === "/api/dashboard/summary" && req.method === "GET") {
      const [claims, customers] = await Promise.all([getClaimsSummary(), getCustomersSummary()]);
      const imports = await query("SELECT source, count(*)::int batches, max(created_at) last_import FROM import_batches GROUP BY source ORDER BY last_import DESC");
      const archives = await query("SELECT id,source,file_name,created_at,report,jsonb_array_length(payload) AS total FROM source_imports ORDER BY id DESC LIMIT 100");
      const slaRows = await query(`SELECT source, extract(year FROM opened_at)::int AS year,
        extract(month FROM opened_at)::int AS month, internal_sla_status, count(*)::int AS total
        FROM claims WHERE requires_management = true AND opened_at >= $1::timestamptz
        GROUP BY 1,2,3,4 ORDER BY 2 DESC NULLS LAST,3 DESC NULLS LAST,1`, [CLAIMS_START_DATE]);
      return send(res, 200, { summary: { claims, customers, imports: imports.rows, archives: archives.rows, sla: summarizeSla(slaRows.rows) } });
    }

    const archiveMatch=pathname.match(/^\/api\/import\/archive\/(\d+)$/);
    if(archiveMatch && req.method === "GET") {
      requireRole(user,["admin"]);
      const offset=Math.max(0,Math.floor(Number(url.searchParams.get("offset"))||0));
      const result=await query("SELECT value FROM source_imports s CROSS JOIN LATERAL jsonb_array_elements(s.payload) WITH ORDINALITY AS r(value,n) WHERE s.id=$1 AND n>$2 AND n<=$2+100 ORDER BY n",[archiveMatch[1],offset]);
      return send(res,200,{rows:result.rows.map(r=>r.value)});
    }

    const claimMatch = pathname.match(/^\/api\/claims\/(\d+)$/);
    if (claimMatch && req.method === "PATCH") {
      requireRole(user, ["admin", "user"]);
      const body = await readJsonBody(req);
      const claim = await updateClaim(claimMatch[1], body, user);
      if (!claim) return send(res, 404, { error: { message: "Reclamo no encontrado" } });
      return send(res, 200, { claim });
    }

    if (pathname === "/api/import/excel" && req.method === "POST") {
      requireRole(user, ["admin"]);
      const body = await readJsonBody(req);
      const rows = readWorkbookRows(body.fileBase64 || "");
      return send(res, 200, await importSource({ source: body.source, fileName: body.fileName, rows, userId: user.id }));
    }

    if (pathname === "/api/import/customers" && req.method === "POST") {
      requireRole(user, ["admin"]);
      const body = await readJsonBody(req);
      const text = Buffer.from(body.fileBase64 || "", "base64").toString("utf8");
      const customers = normalizeCustomers(readDelimitedRows(text, ";"));
      return send(res, 200, await importCustomers({ customers, fileName: body.fileName, userId: user.id }));
    }

    if (pathname === "/api/import/sheet" && req.method === "POST") {
      requireRole(user, ["admin"]);
      const results = [];
      for (const sheet of SHEET_IMPORT_SOURCES) {
        try {
          const response = await fetch(sheet.url, {signal: AbortSignal.timeout(120000)});
          if (!response.ok) throw new Error(`HTTP ${response.status}`);
          const rows = readCsvRows(await response.text());
          results.push({ sheet: sheet.label, ok: true, ...(await importSource({ source: sheet.source, fileName: sheet.url, rows, userId: user.id })) });
        } catch (error) {
          results.push({ sheet: sheet.label, ok: false, error: error.message });
        }
      }
      return send(res, 200, { results });
    }

    return send(res, 404, { error: { message: "Endpoint no encontrado" } });
  } catch (error) {
    if(error.code==='23505')return send(res,409,{error:{message:'Ya existe un registro con ese nombre o identificador.'}});
    return send(res, error.status || 500, { error: { message: error.message || "Error interno" } });
  }
}
