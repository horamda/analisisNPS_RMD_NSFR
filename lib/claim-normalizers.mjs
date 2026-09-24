import crypto from "node:crypto";
import * as XLSX from "xlsx";
import { CLAIMS_START_DATE } from './claims-config.mjs';

const XLSX_LIB = XLSX.default || XLSX;

function clean(value) {
  if (value === null || value === undefined) return "";
  return String(value).replace(/\s+/g, " ").trim();
}

function lowerKey(value) {
  return clean(value)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
}

const columnIndexes = new WeakMap();
function pick(row, names) {
  let index = columnIndexes.get(row);
  if (!index) {
    index = new Map(Object.entries(row).map(([key, value]) => [lowerKey(key), value]));
    columnIndexes.set(row, index);
  }
  for (const name of names) {
    const value = index.get(lowerKey(name));
    if (value !== undefined && clean(value) !== '') return value;
  }
  return "";
}

function toNumber(value) {
  const text = clean(value).replace(",", ".");
  if (!text) return null;
  const number = Number(text);
  return Number.isFinite(number) ? number : null;
}

function toDate(value) {
  if (!value) return null;
  if (value instanceof Date && !Number.isNaN(value.getTime())) return value.toISOString();
  if (typeof value === "number") {
    const parsed = XLSX_LIB.SSF.parse_date_code(value);
    if (parsed) return new Date(Date.UTC(parsed.y, parsed.m - 1, parsed.d, parsed.H || 0, parsed.M || 0, parsed.S || 0)).toISOString();
  }
  const text = clean(value);
  if (!text) return null;
  if (/^\d{5}(?:\.\d+)?$/.test(text)) {
    const parsedExcel = XLSX_LIB.SSF.parse_date_code(Number(text));
    if (parsedExcel) return new Date(Date.UTC(parsedExcel.y, parsedExcel.m - 1, parsedExcel.d, parsedExcel.H || 0, parsedExcel.M || 0, parsedExcel.S || 0)).toISOString();
  }
  const dmy = text.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})(?:\s+(\d{1,2}):(\d{2}))?/);
  if (dmy) {
    const [, d, m, y, hh = "0", mm = "0"] = dmy;
    return new Date(Date.UTC(Number(y), Number(m) - 1, Number(d), Number(hh), Number(mm))).toISOString();
  }
  const parsed = new Date(text);
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
}

function hash(parts) {
  return crypto.createHash("sha256").update(parts.map(clean).join("|")).digest("hex");
}

function buildClaim(source, label, keyParts, fields) {
  const channel = source.includes("NPS") ? "NPS" : source.includes("RMD") ? "RMD" : "BEES_CARE";
  const identity = fields.external_id
    ? ["id", fields.external_id]
    : fields.customer_id && fields.opened_at ? ["customer-date", fields.customer_id, fields.opened_at] : keyParts;
  return {
    source,
    source_label: label,
    legacy_dedupe_key: `${source}:${hash(keyParts)}`,
    dedupe_key: `${channel}:${hash(identity)}`,
    status: fields.status || "Nuevo",
    requires_management: Boolean(fields.requires_management),
    raw: fields.raw || {},
    ...fields,
  };
}

export function readWorkbookRows(base64) {
  const buffer = Buffer.from(base64, "base64");
  const workbook = XLSX_LIB.read(buffer, { type: "buffer", cellDates: true });
  const sheetName = workbook.SheetNames[0];
  if (!sheetName) return [];
  return rowsFromSheet(workbook.Sheets[sheetName]);
}

export function readCsvRows(text) {
  if (/^\s*</.test(text)) throw new Error('La fuente devolvió HTML en lugar de datos CSV. Revisá el enlace publicado.');
  let matrix = parseCsvMatrix(text, ',');
  if (matrix[0]?.length === 1 && text.includes(';')) matrix = parseCsvMatrix(text, ';');
  return rowsFromMatrix(matrix);
}

export function readDelimitedRows(text, delimiter = ";") {
  return rowsFromMatrix(parseCsvMatrix(text, delimiter));
}

function rowsFromSheet(sheet) {
  const matrix = XLSX_LIB.utils.sheet_to_json(sheet, { header: 1, defval: "", raw: false });
  return rowsFromMatrix(matrix);
}

function rowsFromMatrix(matrix) {
  if (!matrix.length) return [];
  const headerIndex = matrix.findIndex((row) => {
    const keys = row.map(lowerKey);
    return keys.includes("rmd_rating_id") || keys.includes("fecha enc") || keys.includes("fecha creacion") || keys.includes("forma de ingreso") || keys.includes("caso n") || keys.includes("poc id");
  });
  const start = headerIndex >= 0 ? headerIndex : 0;
  const headers = matrix[start].map((value, index) => clean(value) === "Recuento" && start > 0 && clean(matrix[start - 1][index]) ? `${clean(matrix[start - 1][index])} Recuento` : clean(value) || `col_${index + 1}`);
  return matrix.slice(start + 1).map((row) => {
    const obj = {};
    headers.forEach((header, index) => {
      const key = obj[header] === undefined ? header : `${header}_${index + 1}`;
      obj[key] = row[index] ?? "";
    });
    return obj;
  }).filter((row) => Object.values(row).some((value) => clean(value)));
}

function parseCsvMatrix(text, delimiter = ",") {
  const rows = [];
  let row = [];
  let value = "";
  let quoted = false;
  const input = text.replace(/^\uFEFF/, "");
  for (let i = 0; i < input.length; i += 1) {
    const char = input[i];
    const next = input[i + 1];
    if (char === '"') {
      if (quoted && next === '"') {
        value += '"';
        i += 1;
      } else {
        quoted = !quoted;
      }
    } else if (char === delimiter && !quoted) {
      row.push(value);
      value = "";
    } else if ((char === "\n" || char === "\r") && !quoted) {
      if (char === "\r" && next === "\n") i += 1;
      row.push(value);
      if (row.some((cell) => clean(cell))) rows.push(row);
      row = [];
      value = "";
    } else {
      value += char;
    }
  }
  row.push(value);
  if (row.some((cell) => clean(cell))) rows.push(row);
  return rows;
}

export function normalizeRowsLegacy(source, rows) {
  if (source.startsWith("SHEET_") && rows.length) {
    const headers = Object.keys(rows[0]).map(lowerKey);
    if (headers.includes("rmd_rating_id") && !source.includes("RMD")) {
      throw new Error("La hoja contiene datos RMD pero esta configurada con otro origen. Revisar el enlace.");
    }
    if (headers.includes("primary_driver") && !source.includes("NPS")) {
      throw new Error("La hoja contiene datos NPS pero esta configurada con otro origen. Revisar el enlace.");
    }
    if (headers.includes("forma de ingreso") && (source.includes("NPS") || source.includes("RMD"))) {
      throw new Error("La hoja contiene tickets manuales pero esta configurada como encuestas. Revisar el enlace.");
    }
  }
  if (source === "NPS") return rows.map(normalizeNps).filter(Boolean);
  if (source === "RMD") return rows.map(normalizeRmd).filter(Boolean);
  if (source === "BEES_CARE") return rows.map(normalizeBeesCare).filter(Boolean);
  if (source.startsWith("SHEET_")) return rows.map((row) => normalizeSheetClaim(source, row)).filter(Boolean);
  throw new Error(`Tipo de importacion no soportado: ${source}`);
}

export function unifiedStatus(value) {
  const state = lowerKey(value);
  if (state.startsWith("cerrado") || ["completo", "completado"].includes(state)) return "Cerrado";
  if (["en progreso", "en gestion"].includes(state)) return "En gestion";
  if (state === "esperando respuesta") return "Esperando respuesta";
  if (state === "descartado") return "Descartado";
  return "Nuevo";
}

export function normalizeRows(source, rows) {
  return inspectRows(source, rows).claims;
}

export function inspectRows(source, rows) {
  const type = source.includes("NPS") ? "NPS" : source.includes("RMD") ? "RMD" : "BEES_CARE";
  const headers = new Set(Object.keys(rows[0] || {}).map(lowerKey));
  const detected = headers.has('rmd_rating_id') ? 'RMD' : headers.has('primary_driver') || headers.has('driver primario') ? 'NPS' : headers.has('forma de ingreso') || headers.has('caso n°') ? 'BEES_CARE' : null;
  if (detected && detected !== type) throw new Error(`La hoja contiene datos ${detected}, pero se seleccionó ${type}. Revisá el origen.`);
  const issues = {};
  const reject = reason => { issues[reason] = (issues[reason] || 0) + 1; return null; };
  const claims = rows.map(raw => {
    const row = {...raw};
    const alias = (target, names) => { row[target] = pick(raw, [target, ...names]); };
    alias("COD CLIENTE DIST", ["COD_CLIENTE_DISTRIBUIDOR"]);
    alias("NOMBRE CLIENTE", ["NOMBRE_CLIENTE", "NOMBRE DE CLIENTE", "Nombre Cliente"]);
    alias("Nombre Cliente", ["NOMBRE_CLIENTE", "NOMBRE DE CLIENTE", "NOMBRE CLIENTE"]);
    alias("FECHA ENC", ["FECHA"]);
    alias("DRIVER PRIMARIO", ["PRIMARY_DRIVER"]);
    alias("DRIVER SECUNDARIO", ["SECONDARY_DRIVER"]);
    alias("Fecha Puntuacion", ["#FECHA_ENC"]);
    alias("Fecha Entrega", ["#FECHA_ENT"]);
    alias("Puntuacion", ["#SCORE"]);
    alias("Comentario", ["#COMMENT", "COMENTARIO"]);
    alias("ID Ticket", ["CASO N\u00b0", "N\u00b0 TICKET"]);
    alias("ID CLIENTE", ["POC ID", "N\u00b0 Cliente"]);
    const c = type === "NPS" ? normalizeNps(row) : type === "RMD" ? normalizeRmd(row) : normalizeBeesCare(row);
    if (!c || !c.customer_id && !c.external_id) return reject('Sin identificador ni cliente');
    if (c.opened_at && c.opened_at < CLAIMS_START_DATE) return reject('Fecha de ingreso anterior a 2025');
    // Auxiliary rows are retained in the archive, never promoted to claims.
    if (type === "NPS" && (c.score === null || c.score < 0 || c.score > 10)) return reject(c.score === null ? 'NPS sin puntaje válido' : 'NPS fuera de rango');
    if (type === "RMD" && (!c.external_id || c.score === null || c.score < 1 || c.score > 5)) return reject(!c.external_id ? 'RMD sin identificador' : c.score === null ? 'RMD sin puntaje válido' : 'RMD fuera de rango');
    const manualTicket = headers.has('forma de ingreso') || headers.has('fecha de ingreso de ticket');
    if (type === "BEES_CARE" && !manualTicket && !source.includes("TICKETS") && !/^\d+$/.test(c.external_id)) return reject('Fila auxiliar o número de caso inválido');
    c.raw = raw;
    c.source = type;
    c.source_label = type === "BEES_CARE" ? "BEES CARE" : type;
    c.status = unifiedStatus(pick(raw, ["STATUS", "ESTADO"]));
    c.owner_name = clean(pick(raw, ["RESPONSABLE"]));
    c.answered_at = toDate(pick(raw, ["FECHA RTA", "Fecha respuesta", "Fecha de contestacion"]));
    c.answered_by = clean(pick(raw, ["Quien contesto el ticket"]));
    c.response = clean(Object.entries(raw).find(([key])=>["respuesta","observaciones del responsable"].includes(lowerKey(key)))?.[1]);
    if (!clean(pick(raw, ['STATUS', 'ESTADO'])) && (c.answered_at || c.response)) c.status = 'En gestion';
    c.action_log = clean(pick(raw, ["Action Log"]));
    c.resolution_days = toNumber(pick(raw, ["Dias resolucion"]));
    c.internal_sla_status = clean(pick(raw, ["Cumplimiento SLA"]));
    c.closed_at = c.status === "Cerrado" ? c.answered_at || c.source_resolved_at || null : null;
    c.requires_management = type === "NPS" ? lowerKey(c.category) === "detractor" || c.score <= 6 : type === "RMD" ? c.score <= 3 : true;
    return c;
  }).filter(Boolean);
  return {claims, issues};
}

function normalizeNps(row) {
  const customerId = clean(pick(row, ["COD CLIENTE DIST", "N° Cliente", "N Cliente"]));
  const openedAt = toDate(pick(row, ["FECHA ENC", "Fecha de ingreso de ticket"]));
  const score = toNumber(pick(row, ["SCORE"]));
  const category = clean(pick(row, ["CATEGORIA", "CATEGORÍA"]));
  const driverPrimary = clean(pick(row, ["DRIVER PRIMARIO", "Asunto / Driver"]));
  const driverSecondary = clean(pick(row, ["DRIVER SECUNDARIO"]));
  const comment = clean(pick(row, ["COMENTARIO", "Comentario del cliente"]));
  if (!customerId && !comment) return null;
  const requires = lowerKey(category).includes("detractor") || (score !== null && score <= 6);
  return buildClaim("NPS", "NPS", [customerId, openedAt, score, driverPrimary, driverSecondary, comment], {
    external_id: "",
    customer_id: customerId,
    customer_name: clean(pick(row, ["NOMBRE CLIENTE", "Nombre Cliente"])),
    location: clean(pick(row, ["DESC LOCALIDAD"])),
    segment_market: clean(pick(row, ["COD DESC SEGMENTO MKT"])),
    segment_sales: clean(pick(row, ["COD DESC SEGMENTO VENTA"])),
    distributor_code: clean(pick(row, ["COD DISTRIBUIDOR"])),
    distributor_name: clean(pick(row, ["DDC NAME"])),
    opened_at: openedAt,
    subject: driverPrimary || "NPS",
    driver_primary: driverPrimary,
    driver_secondary: driverSecondary,
    comment,
    score,
    category,
    requires_management: requires,
    raw: row,
  });
}

function normalizeRmd(row) {
  const externalId = clean(pick(row, ["Rmd_rating_id"]));
  const order = clean(pick(row, ["NRO_PEDIDO"]));
  const customerId = clean(pick(row, ["COD_CLIENTE_DISTRIBUIDOR"]));
  const openedAt = toDate(pick(row, ["Fecha Puntuacion"]));
  const score = toNumber(pick(row, ["Puntuacion"]));
  const comment = clean(pick(row, ["Comentario"]));
  if (!externalId && !order && !customerId) return null;
  return buildClaim("RMD", "RMD", [externalId || order, customerId, openedAt, score, comment], {
    external_id: externalId || order,
    order_number: order,
    customer_id: customerId,
    customer_name: clean(pick(row, ["NOMBRE_CLIENTE"])),
    opened_at: openedAt,
    source_resolved_at: null,
    subject: "Rating Delivery",
    driver_primary: inferRmdReason(row),
    comment,
    score,
    category: score !== null && score <= 3 ? "Detractor" : "",
    segment_market: clean(pick(row, ["DESC_SEGMENTO_MKT"])),
    segment_sales: clean(pick(row, ["DESC_SEGMENTO_VENTA"])),
    distributor_code: clean(pick(row, ["COD_DISTRIBUIDOR"])),
    distributor_name: clean(pick(row, ["DESC_DISTRIBUIDOR"])),
    requires_management: score !== null && score <= 3,
    raw: row,
  });
}

function inferRmdReason(row) {
  const reasons = ["Damaged products", "Driver-related", "N/A", "Other issues"];
  return reasons.find((reason) => clean(pick(row, [reason, `${reason} Recuento`])) && clean(pick(row, [reason, `${reason} Recuento`])) !== "0") || "";
}

function normalizeBeesCare(row) {
  const ticket = clean(pick(row, ["N° TICKET", "N TICKET", "ID Ticket"]));
  const customerId = clean(pick(row, ["ID CLIENTE", "N° Cliente"]));
  const openedAt = toDate(pick(row, ["FECHA CREACION", "FECHA CREACIÓN", "Fecha de ingreso de ticket"]));
  if (!ticket && !customerId) return null;
  const state = clean(pick(row, ["ESTADO"]));
  return buildClaim("BEES_CARE", "BEES CARE", [ticket || customerId, openedAt], {
    external_id: ticket,
    customer_id: customerId,
    customer_name: clean(pick(row, ["Nombre Cliente"])),
    opened_at: openedAt,
    source_resolved_at: toDate(pick(row, ["FECHA SOLUCION", "FECHA SOLUCIÓN"])),
    source_sla_status: state,
    sla_hours: toNumber(pick(row, ["SLA"])),
    subject: clean(pick(row, ["MOTIVO", "Asunto / Driver"])),
    driver_primary: clean(pick(row, ["MOTIVO"])),
    driver_secondary: clean(pick(row, ["SUBMOTIVO"])),
    comment: clean(pick(row, ["Comentario del cliente"])),
    distributor_code: clean(pick(row, ["COD. DISTRIBUIDOR", "CÓD. DISTRIBUIDOR"])),
    distributor_name: clean(pick(row, ["DISTRIBUIDOR"])),
    location: clean(pick(row, ["SUBREGION", "SUBREGIÓN"])),
    requires_management: !lowerKey(state).includes("cerrado"),
    raw: row,
  });
}

function normalizeSheetClaim(source, row) {
  const sourceLabel = source.replace("SHEET_", "").replaceAll("_", " ");
  const entry = clean(pick(row, ["Forma de ingreso"])) || sourceLabel;
  const ticket = clean(pick(row, ["ID Ticket", "N° TICKET", "N TICKET", "CASO N°", "CASO N"]));
  const customerId = clean(pick(row, ["N° Cliente", "N Cliente", "ID CLIENTE", "POC ID"]));
  const openedAt = toDate(pick(row, ["Fecha de ingreso de ticket", "FECHA CREACION", "FECHA CREACIÓN"]));
  const comment = clean(pick(row, ["Comentario del cliente", "COMENTARIO"]));
  if (!ticket && !customerId && !comment) return null;
  const sourceState = clean(pick(row, ["ESTADO"]));
  const manualStatus = clean(pick(row, ["Estado"]));
  const status = ["Nuevo", "En gestion", "Esperando respuesta", "Cerrado", "Descartado"].includes(manualStatus)
    ? manualStatus
    : lowerKey(sourceState).includes("cerrado") || clean(pick(row, ["Fecha de contestacion", "Fecha de contestación", "FECHA SOLUCION", "FECHA SOLUCIÓN"]))
      ? "Cerrado"
      : "Nuevo";
  return buildClaim(source, entry, [entry, ticket, customerId, openedAt, clean(pick(row, ["Asunto / Driver"])), comment], {
    external_id: ticket,
    customer_id: customerId,
    customer_name: clean(pick(row, ["Nombre Cliente", "NOMBRE CLIENTE", "NOMBRE DE CLIENTE"])),
    requester_name: clean(pick(row, ["Nombre del Solicitante"])),
    opened_at: openedAt,
    subject: clean(pick(row, ["Asunto / Driver", "MOTIVO"])),
    driver_primary: clean(pick(row, ["Asunto / Driver", "MOTIVO"])),
    comment,
    answered_at: toDate(pick(row, ["Fecha de contestacion", "Fecha de contestación"])),
    answered_by: clean(pick(row, ["Quien contesto el ticket", "Quién contestó el ticket"])),
    response: clean(pick(row, ["Respuesta"])),
    action_log: clean(pick(row, ["Action Log"])),
    resolution_days: toNumber(pick(row, ["Dias resolucion", "Días resolución"])),
    source_sla_status: sourceState,
    sla_hours: toNumber(pick(row, ["SLA"])),
    internal_sla_status: clean(pick(row, ["Cumplimiento SLA"])),
    status,
    requires_management: status !== "Cerrado" && status !== "Descartado",
    raw: row,
  });
}
