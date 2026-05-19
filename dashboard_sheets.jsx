import React, { useState, useEffect, useRef } from "react";
import {
  LineChart, Line, BarChart, Bar, XAxis, YAxis,
  CartesianGrid, Tooltip, ResponsiveContainer,
  ReferenceLine, Legend, LabelList
} from "recharts";

// =========================================================
// CONFIGURACIÓN — pegá acá las URLs de tus hojas publicadas
// =========================================================
// URL base publicada de tu Google Sheet (ya configurada)
const PUBLISHED_BASE = "https://docs.google.com/spreadsheets/d/e/2PACX-1vSO3dFlz9HldHqMDZMdJyBaWjKPgvtGJwaJZsRkx6yn0HYxD2p9Jt-SH7PwKSXqPCC5mKaqGKu4jCSF/pub";

const SHEET_URLS = {
  rmd:     PUBLISHED_BASE + "?output=csv&gid=0",
  motivos: PUBLISHED_BASE + "?output=csv&gid=199062588",
  nps:     PUBLISHED_BASE + "?output=csv&gid=371855427",
  nsfr:    PUBLISHED_BASE + "?output=csv&gid=718336570",
};

// Drivers NPS en el orden que querés mostrarlos
const NPS_TARGET = 70;
const NPS_DRIVERS_ORDER = [
  'GRAL','DELIVERY','PAYMENT','PRICING',
  'REFRIGERACION','SALES_REP','BEES_APP','CUST_SUPPORT','POINTS'
];
const NPS_DRIVER_LABELS = {
  GRAL:'NPS Gral',
  DELIVERY:'Delivery Exp.',
  PAYMENT:'Payment & Credit',
  PRICING:'Pricing & Promo',
  REFRIGERACION:'Refrigeración',
  SALES_REP:'Sales Rep',
  BEES_APP:'BEES App',
  CUST_SUPPORT:'Cust. Support',
  POINTS:'Points Program',
};

const AI_MODEL = 'openai/gpt-oss-20b';

// =========================================================
// SISTEMA IA — contexto que se arma dinámicamente con los datos
// =========================================================
function buildSistema(data) {
  if (!data) return "Sos analista de del Palacio S.A. Los datos aún no cargaron.";

  const rmd = data.rmd || [];
  const nps = normalizeNpsRows(data.nps || []);
  const motivos = normalizeMotivoRows(data.motivos || []);
  const nsfr = data.nsfr || [];

  const anios = [...new Set(rmd.map(r => r.anio))].sort();
  const ultimoAnio = Math.max(...anios);
  const rmdUltimo = rmd.filter(r => r.anio == ultimoAnio);

  const npsGral = nps.filter(n => n.driver_key === 'GRAL');
  const npsDelivery = nps.filter(n => n.driver_key === 'DELIVERY');
  const npsAnios = [...new Set(nps.map(n=>n.anio))].sort();
  const ultimoAnioNps = npsAnios[npsAnios.length - 1];
  const mesCorteNps = Math.max(...nps.filter(n => n.anio === ultimoAnioNps).map(n => n.mes_num));
  const deliveryCauses = groupDeliveryCauses(motivos, ultimoAnioNps, npsAnios[npsAnios.length - 2], mesCorteNps).slice(0, 5);
  const nsfrUltimo = nsfr.filter(n => n.anio == ultimoAnio);

  return `Sos analista de del Palacio S.A. Respondé en español rioplatense, directo y sin vueltas. Tuteo.

## RMD (Rating Delivery) — Target 4.75
Años cargados: ${anios.join(', ')}
${anios.map(a => {
  const rows = rmd.filter(r => r.anio == a);
  const avg = (rows.reduce((s,r) => s + parseFloat(r.rmd||0), 0) / rows.length).toFixed(2);
  return `${a}: promedio ${avg}, ${rows.length} meses — ${rows.map(r => `${r.mes}=${r.rmd}`).join(' ')}`;
}).join('\n')}

## % Detractores RMD
${anios.map(a => {
  const rows = rmd.filter(r => r.anio == a);
  return `${a}: ${rows.map(r => `${r.mes}=${parseFloat(r.pct_detractores).toFixed(2)}%`).join(' ')}`;
}).join('\n')}

## NPS General — Target ${NPS_TARGET}%
${[...new Set(npsGral.map(n=>n.anio))].sort().map(a => {
  const rows = npsGral.filter(n => n.anio == a);
  const resumen = summarizeNps(rows);
  const avg = resumen.nps === null ? '—' : resumen.nps.toFixed(1);
  return `${a}: NPS ponderado ${avg}% — ${rows.map(r=>`${r.mes}=${n2(r.nps_pct).toFixed(1)}%`).join(' ')}`;
}).join('\n')}

## NPS Delivery Experience
${[...new Set(npsDelivery.map(n=>n.anio))].sort().map(a => {
  const rows = npsDelivery.filter(n => n.anio == a);
  const resumen = summarizeNps(rows);
  const avg = resumen.nps === null ? '—' : resumen.nps.toFixed(1);
  return `${a}: NPS ponderado ${avg}% — clientes ${resumen.clientes}, detractores ${resumen.detractores} — ${rows.map(r=>`${r.mes}=${n2(r.nps_pct).toFixed(1)}%`).join(' ')}`;
}).join('\n')}
Causas operativas asociadas a Delivery (${ultimoAnioNps} YTD): ${deliveryCauses.map(c => `${c.motivo}=${c.actual}`).join(' | ')}

## NS FR (HL) — Target 70%
${[...new Set(nsfr.map(n=>n.anio))].sort().map(a => {
  const rows = nsfr.filter(n => n.anio == a);
  const avg = (rows.reduce((s,r) => s + parseFloat(r.nsfr_pct||0), 0) / rows.length).toFixed(1);
  return `${a}: promedio ${avg}% — ${rows.map(r=>`${r.mes}=${parseFloat(r.nsfr_pct).toFixed(1)}%`).join(' ')}`;
}).join('\n')}

Dá recomendaciones concretas y accionables para logística/distribución.`;
}

// =========================================================
// PARSEO CSV simple
// =========================================================
const CP1252_REVERSE = new Map([
  [0x20AC,0x80],[0x201A,0x82],[0x0192,0x83],[0x201E,0x84],[0x2026,0x85],[0x2020,0x86],[0x2021,0x87],
  [0x02C6,0x88],[0x2030,0x89],[0x0160,0x8A],[0x2039,0x8B],[0x0152,0x8C],[0x017D,0x8E],
  [0x2018,0x91],[0x2019,0x92],[0x201C,0x93],[0x201D,0x94],[0x2022,0x95],[0x2013,0x96],[0x2014,0x97],
  [0x02DC,0x98],[0x2122,0x99],[0x0161,0x9A],[0x203A,0x9B],[0x0153,0x9C],[0x017E,0x9E],[0x0178,0x9F],
]);

function repairMojibake(value) {
  const text = String(value ?? '');
  if (!/[ÃÂâðï€œŠšŸ]/.test(text)) return text;

  const bytes = [];
  for (const char of text) {
    const code = char.codePointAt(0);
    if (code <= 0xFF) bytes.push(code);
    else if (CP1252_REVERSE.has(code)) bytes.push(CP1252_REVERSE.get(code));
    else return text;
  }

  try {
    return new TextDecoder('utf-8', {fatal:false}).decode(new Uint8Array(bytes));
  } catch {
    return text;
  }
}

function parseCSV(text) {
  const lines = text.trim().split('\n');
  if (lines.length < 2) return [];
  const headers = lines[0].split(',').map(h => h.trim().replace(/^"|"$/g, '').toLowerCase());
  return lines.slice(1).map(line => {
    const vals = line.split(',').map(v => repairMojibake(v.trim().replace(/^"|"$/g, '')));
    return Object.fromEntries(headers.map((h, i) => [h, vals[i] ?? '']));
  }).filter(row => Object.values(row).some(v => v !== ''));
}

// =========================================================
// FETCH con fallback a datos hardcodeados
// =========================================================
async function fetchSheet(url) {
  try {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const text = await res.text();
    return parseCSV(text);
  } catch (e) {
    console.warn('fetchSheet error:', url, e.message);
    return null;
  }
}

const REQUIRED_COLUMNS = {
  rmd: ['anio', 'mes_num', 'mes', 'rmd', 'pct_detractores'],
  motivos: ['anio', 'mes_num', 'mes', 'motivo', 'cantidad'],
  nps: ['anio', 'mes_num', 'mes', 'driver', 'clientes', 'promotores', 'detractores', 'nps_pct'],
  nsfr: ['anio', 'mes_num', 'mes', 'hl_pedidos', 'hl_entregados', 'nsfr_pct'],
};

function isValidSheet(name, rows) {
  if (!Array.isArray(rows) || rows.length === 0) return false;
  const keys = new Set(Object.keys(rows[0] || {}));
  return REQUIRED_COLUMNS[name].every(col => keys.has(col));
}

// Datos de respaldo (los del archivo Excel original)
const FALLBACK = {
  rmd: [
    {anio:2025,mes_num:1,mes:'Ene',rmd:4.95,pct_detractores:3.29,clientes:881,recurrentes:4,pct_respuestas:35.86},
    {anio:2025,mes_num:2,mes:'Feb',rmd:4.95,pct_detractores:3.28,clientes:822,recurrentes:7,pct_respuestas:37.34},
    {anio:2025,mes_num:3,mes:'Mar',rmd:4.98,pct_detractores:1.27,clientes:631,recurrentes:2,pct_respuestas:37.71},
    {anio:2025,mes_num:4,mes:'Abr',rmd:4.98,pct_detractores:0.98,clientes:511,recurrentes:3,pct_respuestas:38.11},
    {anio:2025,mes_num:5,mes:'May',rmd:4.99,pct_detractores:0.52,clientes:385,recurrentes:0,pct_respuestas:39.90},
    {anio:2025,mes_num:6,mes:'Jun',rmd:4.99,pct_detractores:0.51,clientes:396,recurrentes:0,pct_respuestas:37.52},
    {anio:2025,mes_num:7,mes:'Jul',rmd:4.98,pct_detractores:1.18,clientes:424,recurrentes:1,pct_respuestas:38.46},
    {anio:2025,mes_num:8,mes:'Ago',rmd:4.95,pct_detractores:3.70,clientes:209,recurrentes:0,pct_respuestas:33.88},
    {anio:2025,mes_num:9,mes:'Sep',rmd:4.97,pct_detractores:1.80,clientes:501,recurrentes:1,pct_respuestas:36.52},
    {anio:2025,mes_num:10,mes:'Oct',rmd:4.99,pct_detractores:0.56,clientes:537,recurrentes:0,pct_respuestas:37.15},
    {anio:2025,mes_num:11,mes:'Nov',rmd:4.98,pct_detractores:0.99,clientes:604,recurrentes:1,pct_respuestas:38.06},
    {anio:2025,mes_num:12,mes:'Dic',rmd:4.95,pct_detractores:2.55,clientes:746,recurrentes:4,pct_respuestas:35.98},
    {anio:2026,mes_num:1,mes:'Ene',rmd:4.94,pct_detractores:4.16,clientes:914,recurrentes:7,pct_respuestas:36.74},
    {anio:2026,mes_num:2,mes:'Feb',rmd:4.97,pct_detractores:1.23,clientes:653,recurrentes:2,pct_respuestas:36.20},
    {anio:2026,mes_num:3,mes:'Mar',rmd:4.96,pct_detractores:1.83,clientes:328,recurrentes:0,pct_respuestas:40.68},
    {anio:2026,mes_num:4,mes:'Abr',rmd:4.98,pct_detractores:1.06,clientes:565,recurrentes:1,pct_respuestas:40.87},
  ],
  motivos: [
    {anio:2025,mes_num:1,mes:'Ene',motivo:'Atención del personal de entrega',cantidad:8},
    {anio:2025,mes_num:1,mes:'Ene',motivo:'Cantidad equivocada',cantidad:1},
    {anio:2025,mes_num:1,mes:'Ene',motivo:'Otro motivo',cantidad:20},
    {anio:2025,mes_num:1,mes:'Ene',motivo:'Productos dañados',cantidad:7},
    {anio:2025,mes_num:1,mes:'Ene',motivo:'Productos equivocados',cantidad:2},
    {anio:2025,mes_num:1,mes:'Ene',motivo:'Retraso en el delivery',cantidad:6},
    {anio:2025,mes_num:2,mes:'Feb',motivo:'Atención del personal de entrega',cantidad:8},
    {anio:2025,mes_num:2,mes:'Feb',motivo:'Cantidad equivocada',cantidad:1},
    {anio:2025,mes_num:2,mes:'Feb',motivo:'Otro motivo',cantidad:12},
    {anio:2025,mes_num:2,mes:'Feb',motivo:'Productos dañados',cantidad:11},
    {anio:2025,mes_num:2,mes:'Feb',motivo:'Productos equivocados',cantidad:4},
    {anio:2025,mes_num:2,mes:'Feb',motivo:'Retraso en el delivery',cantidad:3},
    {anio:2026,mes_num:1,mes:'Ene',motivo:'Atención del personal de entrega',cantidad:14},
    {anio:2026,mes_num:1,mes:'Ene',motivo:'Cantidad equivocada',cantidad:11},
    {anio:2026,mes_num:1,mes:'Ene',motivo:'Otro motivo',cantidad:13},
    {anio:2026,mes_num:1,mes:'Ene',motivo:'Productos dañados',cantidad:12},
    {anio:2026,mes_num:1,mes:'Ene',motivo:'Productos equivocados',cantidad:1},
    {anio:2026,mes_num:1,mes:'Ene',motivo:'Retraso en el delivery',cantidad:4},
    {anio:2026,mes_num:2,mes:'Feb',motivo:'Atención del personal de entrega',cantidad:1},
    {anio:2026,mes_num:2,mes:'Feb',motivo:'Cantidad equivocada',cantidad:2},
    {anio:2026,mes_num:2,mes:'Feb',motivo:'Otro motivo',cantidad:5},
    {anio:2026,mes_num:2,mes:'Feb',motivo:'Productos dañados',cantidad:0},
    {anio:2026,mes_num:2,mes:'Feb',motivo:'Productos equivocados',cantidad:1},
    {anio:2026,mes_num:2,mes:'Feb',motivo:'Retraso en el delivery',cantidad:1},
  ],
  nps: [
    ...[
      ['NPS GRAL',42,33,5,67],['NPS DELIVERY EXPERIENCE',5,3,1,40],['NPS PAYMENT AND CREDIT',5,2,2,0],
      ['NPS PRICING & PROMOTION',9,7,1,66.7],['NPS REFRIGERATION AND MATERIALS',9,3,5,-22.2],['NPS SALES REPRESENTATIVE SERVICE',18,16,2,77.8],
      ['NPS BEES APP EXPERIENCE',17,16,0,94.1],['NPS CUSTOMER SUPPORT',19,14,5,47.4],['NPS POINTS PROGRAM',6,6,0,100]
    ].map(([d,c,p,det,n]) => ({anio:2025,mes_num:1,mes:'Ene',driver:d.trim(),clientes:c,promotores:p,detractores:det,nps_pct:n})),
    ...[
      ['NPS GRAL',59,46,7,66],['NPS DELIVERY EXPERIENCE',6,5,1,66.7],['NPS PAYMENT AND CREDIT',5,3,1,40],
      ['NPS PRICING & PROMOTION',11,7,4,27.3],['NPS REFRIGERATION AND MATERIALS',14,4,6,-14.3],['NPS SALES REPRESENTATIVE SERVICE',20,18,2,80],
      ['NPS BEES APP EXPERIENCE',17,16,0,94.1],['NPS CUSTOMER SUPPORT',3,1,2,-33.3],['NPS POINTS PROGRAM',7,6,1,71.4]
    ].map(([d,c,p,det,n]) => ({anio:2025,mes_num:2,mes:'Feb',driver:d,clientes:c,promotores:p,detractores:det,nps_pct:n})),
    ...[
      ['NPS GRAL',86,65,11,62.8],['NPS DELIVERY EXPERIENCE',12,11,1,83.3],['NPS PAYMENT AND CREDIT',4,3,0,75],
      ['NPS PRICING & PROMOTION',10,9,0,90],['NPS REFRIGERATION AND MATERIALS',15,4,7,-20],['NPS SALES REPRESENTATIVE SERVICE',27,27,0,100],
      ['NPS BEES APP EXPERIENCE',47,39,3,76.6],['NPS CUSTOMER SUPPORT',7,5,1,57.1],['NPS POINTS PROGRAM',11,9,1,72.7]
    ].map(([d,c,p,det,n]) => ({anio:2026,mes_num:1,mes:'Ene',driver:d,clientes:c,promotores:p,detractores:det,nps_pct:n})),
    ...[
      ['NPS GRAL',77,50,14,46.8],['NPS DELIVERY EXPERIENCE',14,7,5,14.3],['NPS PAYMENT AND CREDIT',5,4,1,60],
      ['NPS PRICING & PROMOTION',14,8,2,42.9],['NPS REFRIGERATION AND MATERIALS',17,4,7,-17.6],['NPS SALES REPRESENTATIVE SERVICE',25,21,3,72],
      ['NPS BEES APP EXPERIENCE',24,20,2,75],['NPS CUSTOMER SUPPORT',8,3,5,-25],['NPS POINTS PROGRAM',8,3,3,0]
    ].map(([d,c,p,det,n]) => ({anio:2026,mes_num:2,mes:'Feb',driver:d,clientes:c,promotores:p,detractores:det,nps_pct:n})),
  ],
  nsfr: [
    {anio:2024,mes_num:1,mes:'Ene',hl_pedidos:3805,hl_entregados:1719.5,nsfr_pct:45.19},
    {anio:2024,mes_num:2,mes:'Feb',hl_pedidos:2086.6,hl_entregados:1219.9,nsfr_pct:58.46},
    {anio:2024,mes_num:3,mes:'Mar',hl_pedidos:1269.8,hl_entregados:770.1,nsfr_pct:60.65},
    {anio:2024,mes_num:4,mes:'Abr',hl_pedidos:723.5,hl_entregados:403.2,nsfr_pct:55.73},
    {anio:2024,mes_num:12,mes:'Dic',hl_pedidos:1486.1,hl_entregados:734.9,nsfr_pct:49.45},
    {anio:2025,mes_num:1,mes:'Ene',hl_pedidos:3982.1,hl_entregados:1753.5,nsfr_pct:44.03},
    {anio:2025,mes_num:2,mes:'Feb',hl_pedidos:866.1,hl_entregados:783.5,nsfr_pct:90.46},
    {anio:2025,mes_num:3,mes:'Mar',hl_pedidos:518.2,hl_entregados:414.9,nsfr_pct:80.07},
    {anio:2025,mes_num:4,mes:'Abr',hl_pedidos:495,hl_entregados:320.5,nsfr_pct:64.75},
    {anio:2025,mes_num:12,mes:'Dic',hl_pedidos:1006.5,hl_entregados:667.5,nsfr_pct:66.32},
    {anio:2026,mes_num:1,mes:'Ene',hl_pedidos:1334.7,hl_entregados:1049.4,nsfr_pct:78.62},
    {anio:2026,mes_num:2,mes:'Feb',hl_pedidos:1002,hl_entregados:880,nsfr_pct:87.82},
    {anio:2026,mes_num:3,mes:'Mar',hl_pedidos:306,hl_entregados:272.4,nsfr_pct:89.02},
  ],
};

// =========================================================
// UTILIDADES
// =========================================================
const C = {
  bg0: '#F7F7F7',
  bg1: '#FFFFFF',
  bg2: '#DFE3EE',
  border: '#DFE3EE',
  border2: '#8B9DC3',
  blue: '#3B5998',
  green: '#27ae60',
  amber: '#e67e22',
  red: '#e74c3c',
  text0: '#1a2135',
  text1: '#4B5563',
  text2: '#8B9DC3',
};
const tt = {
  contentStyle:{background:'#FFFFFF', border:'1px solid #DFE3EE', color:'#1a2135', fontSize:11, fontFamily:'monospace', boxShadow:'0 2px 8px rgba(59,89,152,0.12)'},
  labelStyle:{color:'#3B5998'},
};

function n2(v) {
  if (typeof v === 'number') return Number.isFinite(v) ? v : 0;
  const normalized = String(v ?? '').trim().replace('%', '').replace(',', '.');
  const value = parseFloat(normalized);
  return Number.isFinite(value) ? value : 0;
}

function isMissingValue(v) {
  return v === null || v === undefined || v === '' || Number.isNaN(Number(String(v).replace(',', '.')));
}

function normalizeNpsDriver(driver) {
  const raw = String(driver || '').trim().toUpperCase().replace(/\s+/g, ' ');
  const clean = raw.replace(/^NPS\s+/, '');

  if (clean === 'GRAL' || clean === 'GENERAL') return 'GRAL';
  if (clean.includes('DELIVERY')) return 'DELIVERY';
  if (clean.includes('PAYMENT') || clean.includes('CREDIT')) return 'PAYMENT';
  if (clean.includes('PRICING') || clean.includes('PROMOTION')) return 'PRICING';
  if (clean.includes('REFRIGERATION') || clean.includes('REFRIGERACION') || clean.includes('REFRIGERACIÓN')) return 'REFRIGERACION';
  if (clean.includes('SALES') || clean.includes('REPRESENTATIVE')) return 'SALES_REP';
  if (clean.includes('BEES')) return 'BEES_APP';
  if (clean.includes('CUSTOMER') || clean.includes('SUPPORT') || clean.includes('CUST')) return 'CUST_SUPPORT';
  if (clean.includes('POINT')) return 'POINTS';
  return clean;
}

function normalizeNpsRows(rows) {
  return (rows || []).map(row => {
    const driverKey = normalizeNpsDriver(row.driver);
    const clientes = n2(row.clientes);
    const promotores = n2(row.promotores);
    const detractores = n2(row.detractores);
    const calcNps = clientes > 0 ? ((promotores - detractores) / clientes) * 100 : 0;

    return {
      ...row,
      anio: parseInt(row.anio),
      mes_num: parseInt(row.mes_num),
      driver_key: driverKey,
      driver_label: NPS_DRIVER_LABELS[driverKey] || String(row.driver || '').replace(/^NPS\s+/i, ''),
      clientes,
      promotores,
      detractores,
      nps_pct: isMissingValue(row.nps_pct) ? calcNps : n2(row.nps_pct),
    };
  }).filter(row => Number.isFinite(row.anio) && Number.isFinite(row.mes_num) && row.driver_key);
}

function summarizeNps(rows) {
  const clientes = rows.reduce((s, r) => s + n2(r.clientes), 0);
  const promotores = rows.reduce((s, r) => s + n2(r.promotores), 0);
  const detractores = rows.reduce((s, r) => s + n2(r.detractores), 0);
  const neutros = Math.max(0, clientes - promotores - detractores);
  const nps = clientes > 0 ? ((promotores - detractores) / clientes) * 100 : null;
  const promPct = clientes > 0 ? (promotores / clientes) * 100 : 0;
  const detrPct = clientes > 0 ? (detractores / clientes) * 100 : 0;
  const neutPct = clientes > 0 ? (neutros / clientes) * 100 : 0;

  return {clientes, promotores, detractores, neutros, nps, promPct, detrPct, neutPct};
}

function fmtDelta(v) {
  if (v === null || v === undefined || Number.isNaN(Number(v))) return '—';
  const n = Number(v);
  return `${n > 0 ? '+' : ''}${n.toFixed(1)} pp`;
}

function fmtPct1(v) {
  return v === null || v === undefined || Number.isNaN(Number(v)) ? '—' : `${Number(v).toFixed(1)}%`;
}

const PP_NOTE = 'pp = puntos porcentuales';

function chartPctLabel(v) {
  if (v === null || v === undefined || Number.isNaN(Number(v))) return '';
  const n = Number(v);
  return `${Math.abs(n) >= 10 ? n.toFixed(0) : n.toFixed(1)}%`;
}

function chartRmdLabel(v) {
  if (v === null || v === undefined || Number.isNaN(Number(v))) return '';
  return Number(v).toFixed(2);
}

function chartCountLabel(v) {
  if (v === null || v === undefined || Number.isNaN(Number(v)) || Number(v) === 0) return '';
  return String(Math.round(Number(v)));
}

function chartStackPctLabel(v) {
  if (v === null || v === undefined || Number.isNaN(Number(v)) || Number(v) < 10) return '';
  return `${Math.round(Number(v))}%`;
}

function useCompactLayout() {
  const getCompact = () => typeof window !== 'undefined' && window.innerWidth < 760;
  const [compact, setCompact] = useState(getCompact);
  useEffect(() => {
    const onResize = () => setCompact(getCompact());
    onResize();
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);
  return compact;
}

function SvgLabelBox({x, y, text, fill = C.text0, anchor = 'middle', bg = '#ffffff'}) {
  if (!text || !Number.isFinite(Number(x)) || !Number.isFinite(Number(y))) return null;
  const width = Math.max(22, String(text).length * 6 + 10);
  const left = anchor === 'middle' ? x - width / 2 : anchor === 'end' ? x - width : x;
  return (
    <g>
      <rect x={left} y={y - 10} width={width} height={16} rx={4} fill={bg} stroke={`${fill}35`} />
      <text x={x} y={y + 1} textAnchor={anchor} fill={fill} fontSize={9} fontWeight={700}>
        {text}
      </text>
    </g>
  );
}

function PointLabel({x, y, value, formatter = chartPctLabel, fill = C.text0, offsetY = -12}) {
  return <SvgLabelBox x={x} y={y + offsetY} text={formatter(value)} fill={fill} />;
}

function BarTopLabel({x, y, width, value, formatter = chartPctLabel, fill = C.text0}) {
  if (value === null || value === undefined || Number.isNaN(Number(value))) return null;
  return <SvgLabelBox x={x + width / 2} y={y - 8} text={formatter(value)} fill={fill} />;
}

function BarRightLabel({x, y, width, height, value, formatter = chartCountLabel, fill = C.text0}) {
  if (value === null || value === undefined || Number.isNaN(Number(value)) || Number(value) === 0) return null;
  return <SvgLabelBox x={x + width + 20} y={y + height / 2} text={formatter(value)} fill={fill} anchor="middle" />;
}

function StackCenterLabel({x, y, width, height, value, formatter = chartStackPctLabel, fill = '#ffffff'}) {
  const text = formatter(value);
  if (!text || width < 36 || height < 14) return null;
  return (
    <text x={x + width / 2} y={y + height / 2 + 3} textAnchor="middle" fill={fill} fontSize={9} fontWeight={700}>
      {text}
    </text>
  );
}

// Prepara serie temporal de una métrica para un campo
const FODA_KEYS = ['fortalezas', 'oportunidades', 'debilidades', 'amenazas'];

function extractJsonObject(text) {
  const clean = String(text || '').replace(/```json|```/gi, '').trim();
  const start = clean.indexOf('{');
  const end = clean.lastIndexOf('}');
  if (start < 0 || end <= start) throw new Error('La IA no devolvió un JSON válido.');
  const jsonText = clean.slice(start, end + 1).replace(/,\s*([}\]])/g, '$1');
  try {
    return JSON.parse(jsonText);
  } catch {
    throw new Error('La IA no devolvió un JSON válido.');
  }
}

function stripJsonFences(text) {
  return String(text || '').replace(/```json|```/gi, '').trim();
}

function safeParseJsonObject(text) {
  try {
    return JSON.parse(stripJsonFences(text));
  } catch {
    return extractJsonObject(text);
  }
}

function readFodaArray(raw, key) {
  const source = raw?.foda && typeof raw.foda === 'object' ? raw.foda : raw;
  if (!source || typeof source !== 'object') return null;
  if (Array.isArray(source[key])) return source[key];
  const entry = Object.entries(source).find(([k]) => k.toLowerCase() === key);
  return Array.isArray(entry?.[1]) ? entry[1] : null;
}

function normalizeFoda(raw) {
  const normalized = {};
  for (const key of FODA_KEYS) {
    const items = readFodaArray(raw, key);
    if (!Array.isArray(items)) {
      throw new Error(`La respuesta no contiene "${key}" como lista.`);
    }
    normalized[key] = items
      .map(item => {
        if (typeof item === 'string') return item;
        return item?.texto || item?.descripcion || item?.detalle || '';
      })
      .map(item => String(item || '').trim())
      .filter(Boolean)
      .slice(0, 5);
    if (normalized[key].length < 3) {
      throw new Error(`La respuesta trae pocos items en "${key}".`);
    }
  }
  return normalized;
}

function getAiEndpoints() {
  const endpoints = ['/api/ai'];
  if (typeof window === 'undefined') return endpoints;

  const isLocal = window.location.protocol === 'file:'
    || window.location.hostname === 'localhost'
    || window.location.hostname === '127.0.0.1';
  if (!isLocal) return endpoints;

  const port = window.location.port || '5173';
  endpoints.push(`http://127.0.0.1:${port}/api/ai`);
  endpoints.push(`http://localhost:${port}/api/ai`);
  return [...new Set(endpoints)];
}

async function requestAiContent(payload) {
  let lastError;
  for (const endpoint of getAiEndpoints()) {
    try {
      const res = await fetch(endpoint, {
        method:'POST',
        headers:{'Content-Type':'application/json'},
        body: JSON.stringify(payload),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) {
        const message = data?.error?.message || `La API respondió HTTP ${res.status}.`;
        lastError = new Error(message);
        if (![404, 405].includes(res.status)) throw lastError;
        continue;
      }
      const text = data?.choices?.[0]?.message?.content;
      if (!text) {
        throw new Error(data?.error?.message || 'La API no devolvió contenido.');
      }
      return text;
    } catch (e) {
      lastError = e;
    }
  }
  throw new Error(lastError?.message === 'Failed to fetch'
    ? 'No se pudo conectar con /api/ai. Abrí el dashboard desde http://127.0.0.1:5173/ y verificá que npm run dev siga corriendo.'
    : lastError?.message || 'No se pudo conectar con /api/ai.');
}

function limitFodaContext(contexto) {
  const text = String(contexto || '').trim();
  return text.length > 6000 ? `${text.slice(0, 6000)}\n...` : text;
}

function buildFodaPayload(metrica, contexto, retry = false) {
  const fodaPrompt = `${retry ? 'El intento anterior no fue JSON valido. ' : ''}Genera una Matriz FODA para del Palacio S.A.

METRICA: ${metrica}
DATOS ACTUALES:
${limitFodaContext(contexto)}

Devolve solo un objeto JSON compacto, sin markdown, sin backticks y sin texto adicional.
Usa exactamente estas claves: fortalezas, oportunidades, debilidades, amenazas.
Cada clave debe ser un array de 3 strings cortos, concretos y basados en los datos.
Escribi los items en español, sin punto final.

Estructura obligatoria:
{"fortalezas":["item","item","item"],"oportunidades":["item","item","item"],"debilidades":["item","item","item"],"amenazas":["item","item","item"]}`;

  return {
    model:AI_MODEL,
    temperature:0,
    reasoning_effort:'low',
    max_completion_tokens:1800,
    messages:[
      {
        role:'system',
        content:'Sos un analista operativo. No muestres razonamiento. Responde solo JSON valido.'
      },
      {role:'user', content:fodaPrompt}
    ]
  };
}

async function requestFoda(metrica, contexto) {
  let lastError;
  for (const retry of [false, true]) {
    try {
      const text = await requestAiContent(buildFodaPayload(metrica, contexto, retry));
      return normalizeFoda(extractJsonObject(text));
    } catch (e) {
      lastError = e;
    }
  }
  throw lastError;
}

function buildLocalFoda(metrica, contexto, reason = '') {
  const name = String(metrica || '').toLowerCase();
  const commonNotice = reason
    ? `IA no disponible: ${reason}. Se muestra un FODA local de respaldo.`
    : 'Se muestra un FODA local de respaldo.';

  if (name.includes('rmd')) {
    return {
      _notice: commonNotice,
      fortalezas: [
        'RMD se mantiene por encima del target operativo',
        'Detractores en niveles gestionables para seguimiento mensual',
        'Datos mensuales permiten detectar desvios con rapidez',
      ],
      oportunidades: [
        'Priorizar causas recurrentes de detraccion en picking y entrega',
        'Cruzar detractores con motivos para acciones correctivas',
        'Estandarizar controles previos a despacho en meses criticos',
      ],
      debilidades: [
        'La satisfaccion puede caer ante errores puntuales de entrega',
        'Motivos operativos requieren seguimiento por responsable',
        'La recurrencia de reclamos debe monitorearse cliente por cliente',
      ],
      amenazas: [
        'Aumento de errores de entrega puede erosionar el servicio',
        'Meses con mas volumen pueden elevar detractores',
        'Falta de acciones rapidas puede convertir reclamos en recurrencia',
      ],
    };
  }

  if (name.includes('nps')) {
    return {
      _notice: commonNotice,
      fortalezas: [
        'Sales Rep y BEES sostienen buena percepcion relativa',
        'El desglose por driver permite priorizar acciones concretas',
        'La medicion ponderada refleja mejor el impacto real',
      ],
      oportunidades: [
        'Atacar primero drivers con bajo NPS y alto volumen',
        'Reducir detractores en Customer Support y Delivery',
        'Usar promotores como referencia de practicas replicables',
      ],
      debilidades: [
        'NPS general queda por debajo del target definido',
        'Algunos drivers muestran alta sensibilidad por baja muestra',
        'Detractores concentrados pueden arrastrar el indicador general',
      ],
      amenazas: [
        'Persistencia bajo target puede afectar fidelidad comercial',
        'Problemas de soporte pueden amplificar experiencias negativas',
        'Volatilidad mensual puede ocultar causas estructurales',
      ],
    };
  }

  if (name.includes('ns')) {
    return {
      _notice: commonNotice,
      fortalezas: [
        'Nivel de servicio supera el target operativo',
        'La medicion por HL muestra cumplimiento material',
        'Tendencia reciente habilita consolidar buenas practicas',
      ],
      oportunidades: [
        'Identificar meses con menor entrega para corregir causas',
        'Cruzar faltantes con disponibilidad y planificacion',
        'Asegurar capacidad en periodos de mayor demanda',
      ],
      debilidades: [
        'La cobertura historica muestra meses con brechas importantes',
        'El indicador depende de disponibilidad y ejecucion coordinada',
        'Faltan aperturas para aislar causas por zona o producto',
      ],
      amenazas: [
        'Quiebres de stock pueden bajar rapidamente el servicio',
        'Picos de demanda pueden tensionar entrega y facturacion',
        'Brechas repetidas impactan NPS y relacion comercial',
      ],
    };
  }

  return {
    _notice: commonNotice,
    fortalezas: [
      'Existe informacion suficiente para seguimiento operativo',
      'Los indicadores permiten monitorear evolucion mensual',
      'El tablero concentra metricas clave para decision',
    ],
    oportunidades: [
      'Priorizar acciones segun brecha contra target',
      'Cruzar metricas para detectar causas compartidas',
      'Formalizar responsables y plazos por desvio',
    ],
    debilidades: [
      'Algunas lecturas dependen de muestras reducidas',
      'Faltan aperturas operativas para diagnostico fino',
      'Los desvios requieren seguimiento sistematico',
    ],
    amenazas: [
      'La falta de accion puede sostener desvios',
      'Cambios de volumen pueden alterar rapidamente los indicadores',
      'Problemas operativos pueden afectar la satisfaccion',
    ],
  };
}

function timeSeries(rows, anios, campo) {
  const meses = ['Ene','Feb','Mar','Abr','May','Jun','Jul','Ago','Sep','Oct','Nov','Dic'];
  return meses.map((mes, idx) => {
    const entry = {mes};
    anios.forEach(a => {
      const row = rows.find(r => parseInt(r.anio) === a && parseInt(r.mes_num) === idx+1);
      entry[String(a)] = row ? n2(row[campo]) : null;
    });
    return entry;
  });
}

function normalizeMotivoRows(rows) {
  return (rows || []).map(row => ({
    ...row,
    anio: parseInt(row.anio),
    mes_num: parseInt(row.mes_num),
    mes: row.mes,
    motivo: String(row.motivo || 'Sin motivo').trim(),
    cantidad: n2(row.cantidad),
  })).filter(row => Number.isFinite(row.anio) && Number.isFinite(row.mes_num) && row.motivo);
}

function groupDeliveryCauses(rows, currentYear, prevYear, latestMonth) {
  const current = rows.filter(r => r.anio === currentYear && r.mes_num <= latestMonth);
  const prev = prevYear ? rows.filter(r => r.anio === prevYear && r.mes_num <= latestMonth) : [];
  const total = current.reduce((s, r) => s + r.cantidad, 0);
  const motivos = [...new Set([...current, ...prev].map(r => r.motivo))];

  return motivos.map(motivo => {
    const actual = current.filter(r => r.motivo === motivo).reduce((s, r) => s + r.cantidad, 0);
    const anterior = prev.filter(r => r.motivo === motivo).reduce((s, r) => s + r.cantidad, 0);
    return {
      motivo,
      actual,
      anterior,
      delta: actual - anterior,
      share: total > 0 ? (actual / total) * 100 : 0,
    };
  }).filter(r => r.actual > 0 || r.anterior > 0)
    .sort((a, b) => b.actual - a.actual || b.delta - a.delta);
}

function buildDeliveryInsight({deliverySummary, prevDeliverySummary, currentSummary, topCause, risingCause, latestMonthName}) {
  const delta = deliverySummary.nps !== null && prevDeliverySummary.nps !== null
    ? deliverySummary.nps - prevDeliverySummary.nps
    : null;
  const gapVsGral = deliverySummary.nps !== null && currentSummary.nps !== null
    ? deliverySummary.nps - currentSummary.nps
    : null;
  const trendText = delta === null
    ? 'Sin base comparable para medir tendencia'
    : delta < -5
      ? `Cae ${Math.abs(delta).toFixed(1)} pp contra el periodo comparable`
      : delta > 5
        ? `Mejora ${delta.toFixed(1)} pp contra el periodo comparable`
        : `Se mantiene estable contra el periodo comparable`;
  const gapText = gapVsGral === null
    ? 'Sin comparacion contra NPS general'
    : gapVsGral < -5
      ? `Está ${Math.abs(gapVsGral).toFixed(1)} pp debajo del NPS general`
      : gapVsGral > 5
        ? `Está ${gapVsGral.toFixed(1)} pp arriba del NPS general`
        : 'Se mueve cerca del NPS general';

  return [
    {
      label:'Desempeño',
      text:`${trendText}. ${gapText}`,
      color: deliverySummary.nps >= NPS_TARGET ? C.green : deliverySummary.nps >= 50 ? C.amber : C.red,
    },
    {
      label:'Causa principal',
      text: topCause ? `${topCause.motivo}: ${topCause.actual} casos (${topCause.share.toFixed(1)}%)` : 'Sin motivos cargados para el corte',
      color: C.amber,
    },
    {
      label:'Foco operativo',
      text: risingCause && risingCause.delta > 0
        ? `${risingCause.motivo} sube ${risingCause.delta} casos vs periodo comparable`
        : `Revisar detractores de ${latestMonthName} y cierre de reclamos`,
      color: risingCause && risingCause.delta > 0 ? C.red : C.blue,
    },
  ];
}

function Panel({title, alert, children, style}) {
  return (
    <div style={{background:C.bg1, border:`1px solid ${C.border}`, borderRadius:10, padding:20, minWidth:'min(320px, 100%)', boxShadow:'0 1px 4px rgba(59,89,152,0.08)', ...style}}>
      <div style={{fontSize:10, color:C.text2, letterSpacing:1.5, textTransform:'uppercase', fontFamily:'monospace', marginBottom:alert?6:14, fontWeight:600}}>{title}</div>
      {alert && <div style={{fontSize:10, color:C.red, marginBottom:14, background:'#fde8e8', padding:'6px 10px', borderRadius:4}}>{alert}</div>}
      {children}
    </div>
  );
}

const COLORS_BY_YEAR = {2024:'#8B9DC3', 2025:'#3B5998', 2026:'#27ae60'};

// =========================================================
// COMPONENTE FODA — se genera con IA en base al contexto
// =========================================================
function FodaPanel({metrica, contexto}) {
  const [foda, setFoda] = useState(null);
  const [loading, setLoading] = useState(false);
  const [generado, setGenerado] = useState(false);

  const generar = async () => {
    setLoading(true);
    setFoda(null);
    try {
      setFoda(await requestFoda(metrica, contexto));
      setGenerado(true);
    } catch(e) {
      console.error('FODA error:', e);
      setFoda(buildLocalFoda(metrica, contexto, e.message));
      setGenerado(true);
    } finally { setLoading(false); }
  };

  const CUADRANTES = [
    {key:'fortalezas',    label:'Fortalezas',    icon:'▲', color:C.green, bg:'#e8f5e9'},
    {key:'oportunidades', label:'Oportunidades',  icon:'◆', color:C.blue,  bg:'#e3eaf5'},
    {key:'debilidades',   label:'Debilidades',    icon:'▼', color:C.amber, bg:'#fff3e0'},
    {key:'amenazas',      label:'Amenazas',       icon:'●', color:C.red,   bg:'#fde8e8'},
  ];

  return (
    <div style={{background:C.bg1, border:`1px solid ${C.border}`, borderRadius:8, padding:20}}>
      <div style={{display:'flex', alignItems:'center', justifyContent:'space-between', marginBottom: generado && foda && !foda._error ? 16 : 4}}>
        <div>
          <div style={{fontSize:10, color:C.text2, letterSpacing:1.5, textTransform:'uppercase', fontFamily:'monospace'}}>
            Análisis FODA — {metrica}
          </div>
          {!generado && (
            <div style={{fontSize:11, color:C.text1, marginTop:4}}>
              La IA analiza los datos actuales y genera la matriz automáticamente
            </div>
          )}
        </div>
        <button onClick={generar} disabled={loading} style={{
          background: loading ? C.bg2 : C.blue,
          border:`1px solid ${loading ? C.border : C.blue}`,
          borderRadius:8, padding:'8px 18px',
          color: loading ? C.text2 : '#ffffff',
          fontSize:11, fontFamily:'monospace', fontWeight: loading ? 400 : 600,
          cursor: loading ? 'not-allowed' : 'pointer',
          transition:'all .15s', whiteSpace:'nowrap', marginLeft:12,
        }}>
          {loading ? 'Generando...' : generado ? '↺ Regenerar' : '⚡ Generar FODA con IA'}
        </button>
      </div>

      {foda?._notice && !foda._error && (
        <div style={{fontSize:11, color:C.amber, background:'#fff3e0', border:`1px solid ${C.amber}35`, borderRadius:6, padding:'8px 10px', marginBottom:12}}>
          {foda._notice}
        </div>
      )}

      {foda && !foda._error && (
        <div style={{display:'grid', gridTemplateColumns:'repeat(auto-fit, minmax(220px, 1fr))', gap:10}}>
          {CUADRANTES.map(q => (
            <div key={q.key} style={{
              background:q.bg,
              border:`1px solid ${q.color}25`,
              borderTop:`3px solid ${q.color}`,
              borderRadius:6, padding:'12px 14px',
            }}>
              <div style={{fontSize:10, color:q.color, letterSpacing:1.5, textTransform:'uppercase', fontFamily:'monospace', marginBottom:10}}>
                {q.icon} {q.label}
              </div>
              <ul style={{margin:0, padding:'0 0 0 14px'}}>
                {(foda[q.key]||[]).map((item,i) => (
                  <li key={i} style={{fontSize:11, color:C.text1, lineHeight:1.7, marginBottom:3}}>
                    {item}
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      )}

      {foda?._error && (
        <div style={{color:C.red, fontSize:11, marginTop:8}}>{foda._error}</div>
      )}
    </div>
  );
}

// =========================================================
// TABS
// =========================================================
function TabRMD({data}) {
  const compact = useCompactLayout();
  const rmd = data.rmd || FALLBACK.rmd;
  const motivos = data.motivos || FALLBACK.motivos;
  const anios = [...new Set(rmd.map(r => parseInt(r.anio)))].sort().slice(-2);

  const trend = timeSeries(rmd, anios, 'rmd');
  const detrTrend = timeSeries(rmd, anios, 'pct_detractores');

  // Motivos acumulados por año
  const motiList = [...new Set(motivos.map(m => m.motivo))];
  const motiData = motiList.map(mot => {
    const entry = {mot: mot.replace('del personal de entrega','entrega').replace('en el delivery','delivery')};
    anios.forEach(a => {
      entry[String(a)] = motivos.filter(m => parseInt(m.anio) === a && m.motivo === mot)
        .reduce((s,m) => s + n2(m.cantidad), 0);
    });
    return entry;
  }).sort((a,b) => n2(b[String(anios[anios.length-1])]) - n2(a[String(anios[anios.length-1])]));

  return (
    <div style={{display:'flex', flexDirection:'column', gap:16}}>
      <div style={{display:'flex', gap:16, flexWrap:'wrap'}}>
        <Panel title="Evolución RMD mensual" style={{flex:'2 1 520px'}}>
          <ResponsiveContainer width="100%" height={compact ? 250 : 220}>
            <LineChart data={trend} margin={{top:28, right:compact ? 12 : 22, left:0, bottom:4}}>
              <CartesianGrid strokeDasharray="3 3" stroke={C.border} />
              <XAxis dataKey="mes" stroke={C.text2} tick={{fontSize:10, fill:C.text2}} />
              <YAxis stroke={C.text2} domain={[4.85,5.0]} tick={{fontSize:10, fill:C.text2}} />
              <Tooltip {...tt} />
              <ReferenceLine y={4.75} stroke={C.red} strokeDasharray="4 4" label={{value:'Target',fill:C.red,fontSize:9}} />
              {anios.map(a => (
                <Line key={a} type="monotone" dataKey={String(a)} stroke={COLORS_BY_YEAR[a]||C.blue} strokeWidth={2} dot={{r:2}} connectNulls={false}>
                  {a===anios[anios.length-1] && <LabelList dataKey={String(a)} content={(props) => <PointLabel {...props} formatter={chartRmdLabel} fill={COLORS_BY_YEAR[a]||C.blue} />} />}
                </Line>
              ))}
              <Legend wrapperStyle={{fontSize:10, color:C.text1}} />
            </LineChart>
          </ResponsiveContainer>
        </Panel>
        <Panel title="% Detractores mensual" style={{flex:'1 1 360px'}}>
          <ResponsiveContainer width="100%" height={compact ? 250 : 220}>
            <BarChart data={detrTrend} margin={{top:28, right:compact ? 10 : 18, left:0, bottom:4}}>
              <CartesianGrid strokeDasharray="3 3" stroke={C.border} />
              <XAxis dataKey="mes" stroke={C.text2} tick={{fontSize:10, fill:C.text2}} />
              <YAxis stroke={C.text2} tick={{fontSize:10, fill:C.text2}} />
              <Tooltip {...tt} />
              {anios.map(a => (
                <Bar key={a} dataKey={String(a)} fill={a===anios[anios.length-1] ? C.amber : `${C.blue}60`} name={String(a)}>
                  {a===anios[anios.length-1] && <LabelList dataKey={String(a)} content={(props) => <BarTopLabel {...props} formatter={chartPctLabel} fill={C.amber} />} />}
                </Bar>
              ))}
              <Legend wrapperStyle={{fontSize:10, color:C.text1}} />
            </BarChart>
          </ResponsiveContainer>
        </Panel>
      </div>
      <Panel title="Motivos de detracción — acumulado anual" alert="⚠ Cantidad equivocada: revisar picking, carga y validación">
        <ResponsiveContainer width="100%" height={compact ? Math.max(300, motiData.length * 42 + 70) : Math.max(240, motiData.length * 34 + 64)}>
          <BarChart data={motiData} layout="vertical" margin={{top:8, right:compact ? 48 : 56, left:compact ? 0 : 8, bottom:8}}>
            <CartesianGrid strokeDasharray="3 3" stroke={C.border} />
            <XAxis type="number" stroke={C.text2} tick={{fontSize:10, fill:C.text2}} />
            <YAxis dataKey="mot" type="category" stroke={C.text2} tick={{fontSize:10, fill:C.text2}} width={compact ? 104 : 140} />
            <Tooltip {...tt} />
            {anios.map(a => (
              <Bar key={a} dataKey={String(a)} fill={a===anios[anios.length-1] ? C.amber : `${C.blue}50`} name={String(a)}>
                {a===anios[anios.length-1] && <LabelList dataKey={String(a)} content={(props) => <BarRightLabel {...props} formatter={chartCountLabel} fill={C.amber} />} />}
              </Bar>
            ))}
            <Legend wrapperStyle={{fontSize:10, color:C.text1}} />
          </BarChart>
        </ResponsiveContainer>
      </Panel>
      <FodaPanel metrica="RMD (Rating de Delivery)" contexto={(() => {
        const lines = anios.map(a => {
          const rows = rmd.filter(r => parseInt(r.anio) === a);
          const avgRmd  = rows.length ? (rows.reduce((s,r)=>s+n2(r.rmd),0)/rows.length).toFixed(2) : '—';
          const avgDetr = rows.length ? (rows.reduce((s,r)=>s+n2(r.pct_detractores),0)/rows.length).toFixed(2) : '—';
          const avgResp = rows.length ? (rows.reduce((s,r)=>s+n2(r.pct_respuestas),0)/rows.length).toFixed(1) : '—';
          const recur   = rows.reduce((s,r)=>s+n2(r.recurrentes),0);
          return `${a}: RMD=${avgRmd} | % Detractores=${avgDetr}% | % Respuestas=${avgResp}% | Recurrentes acum.=${recur}`;
        });
        const motiRes = [...new Set(motivos.map(m=>m.motivo))].map(mot => {
          const byAnio = anios.map(a => {
            const t = motivos.filter(m=>parseInt(m.anio)===a&&m.motivo===mot).reduce((s,m)=>s+n2(m.cantidad),0);
            return `${a}=${t}`;
          }).join(' / ');
          return `  - ${mot}: ${byAnio}`;
        });
        return `Target RMD: 4.75\n${lines.join('\n')}\nMotivos de detracción (acumulado por año):\n${motiRes.join('\n')}`;
      })()} />
    </div>
  );
}

function TabNPS({data}) {
  const nps = normalizeNpsRows(data.nps || FALLBACK.nps);
  const anios = [...new Set(nps.map(n => parseInt(n.anio)))].sort().slice(-2);

  const gral = nps.filter(n => n.driver === 'NPS GRAL');
  const npsTrend = timeSeries(gral, anios, 'nps_pct');

  // % detractores NPS por mes/año
  const totales = anios.map(a => {
    const rows = nps.filter(n => parseInt(n.anio) === a && (n.driver === 'NPS GRAL'));
    return rows.map(r => {
      const cli = n2(r.clientes);
      const det = n2(r.detractores);
      return {anio:a, mes_num:parseInt(r.mes_num), mes:r.mes, pct: cli > 0 ? (det/cli*100) : 0};
    });
  }).flat();

  const MESES = ['Ene','Feb','Mar','Abr','May','Jun','Jul','Ago','Sep','Oct','Nov','Dic'];
  const detrTrend = MESES.map((mes, idx) => {
    const entry = {mes};
    anios.forEach(a => {
      const r = totales.find(t => t.anio === a && t.mes_num === idx+1);
      entry[String(a)] = r ? parseFloat(r.pct.toFixed(1)) : null;
    });
    return entry;
  });

  // Comparativo por driver (acumulado)
  const driverData = NPS_DRIVERS_ORDER.map(d => {
    const entry = {driver: NPS_DRIVER_LABELS[d] || d};
    anios.forEach(a => {
      const rows = nps.filter(n => parseInt(n.anio) === a && n.driver.trim() === d);
      const avg = rows.length ? (rows.reduce((s,r) => s + n2(r.nps_pct), 0) / rows.length) : null;
      entry[String(a)] = avg !== null ? parseFloat(avg.toFixed(1)) : null;
    });
    return entry;
  });

  return (
    <div style={{display:'flex', flexDirection:'column', gap:16}}>
      <div style={{display:'flex', gap:16, flexWrap:'wrap'}}>
        <Panel title="NPS General mensual" style={{flex:2}}>
          <ResponsiveContainer width="100%" height={200}>
            <LineChart data={npsTrend}>
              <CartesianGrid strokeDasharray="3 3" stroke={C.border} />
              <XAxis dataKey="mes" stroke={C.text2} tick={{fontSize:10, fill:C.text2}} />
              <YAxis stroke={C.text2} domain={[-30,110]} tick={{fontSize:10, fill:C.text2}} />
              <Tooltip {...tt} formatter={v => v ? [`${v}%`,''] : ['—','']} />
              <ReferenceLine y={70} stroke={C.green} strokeDasharray="4 4" label={{value:'Target 70%',fill:C.green,fontSize:9}} />
              {anios.map(a => <Line key={a} type="monotone" dataKey={String(a)} stroke={COLORS_BY_YEAR[a]||C.blue} strokeWidth={2} dot={{r:2}} connectNulls={false} />)}
              <Legend wrapperStyle={{fontSize:10, color:C.text1}} />
            </LineChart>
          </ResponsiveContainer>
        </Panel>
        <Panel title="% Detractores NPS">
          <ResponsiveContainer width="100%" height={200}>
            <LineChart data={detrTrend}>
              <CartesianGrid strokeDasharray="3 3" stroke={C.border} />
              <XAxis dataKey="mes" stroke={C.text2} tick={{fontSize:10, fill:C.text2}} />
              <YAxis stroke={C.text2} tick={{fontSize:10, fill:C.text2}} />
              <Tooltip {...tt} formatter={v => v ? [`${v}%`,''] : ['—','']} />
              <ReferenceLine y={10} stroke={C.red} strokeDasharray="4 4" label={{value:'Meta <10%',fill:C.red,fontSize:9}} />
              {anios.map(a => <Line key={a} type="monotone" dataKey={String(a)} stroke={COLORS_BY_YEAR[a]||C.amber} strokeWidth={2} dot={{r:2}} connectNulls={false} />)}
              <Legend wrapperStyle={{fontSize:10, color:C.text1}} />
            </LineChart>
          </ResponsiveContainer>
        </Panel>
      </div>
      <Panel title="Comparativo por driver (promedio anual)" alert="⚠ Customer Support y Delivery en caída sostenida">
        <ResponsiveContainer width="100%" height={260}>
          <BarChart data={driverData}>
            <CartesianGrid strokeDasharray="3 3" stroke={C.border} />
            <XAxis dataKey="driver" stroke={C.text2} tick={{fontSize:9, fill:C.text2}} angle={-15} textAnchor="end" height={48} />
            <YAxis stroke={C.text2} tick={{fontSize:10, fill:C.text2}} />
            <Tooltip {...tt} formatter={v => v ? [`${v}%`,''] : ['—','']} />
            <ReferenceLine y={70} stroke={C.green} strokeDasharray="4 4" />
            {anios.map(a => <Bar key={a} dataKey={String(a)} fill={a===anios[anios.length-1] ? C.amber : `${C.blue}60`} name={String(a)} />)}
            <Legend wrapperStyle={{fontSize:10, color:C.text1}} />
          </BarChart>
        </ResponsiveContainer>
      </Panel>
      <FodaPanel metrica="NPS (Net Promoter Score)" contexto={(() => {
        const lines = anios.map(a => {
          const gralRows = nps.filter(n => parseInt(n.anio)===a && n.driver.trim()==='NPS GRAL');
          const avgGral  = gralRows.length ? (gralRows.reduce((s,r)=>s+n2(r.nps_pct),0)/gralRows.length).toFixed(1) : '—';
          const totCli   = gralRows.reduce((s,r)=>s+n2(r.clientes),0);
          const totDetr  = gralRows.reduce((s,r)=>s+n2(r.detractores),0);
          const pctDetr  = totCli > 0 ? (totDetr/totCli*100).toFixed(1) : '—';
          return `${a}: NPS Gral=${avgGral}% | % Detractores=${pctDetr}%`;
        });
        const driverLines = NPS_DRIVERS_ORDER.map(d => {
          const byAnio = anios.map(a => {
            const rows = nps.filter(n=>parseInt(n.anio)===a&&n.driver.trim()===d);
            const avg  = rows.length ? (rows.reduce((s,r)=>s+n2(r.nps_pct),0)/rows.length).toFixed(1) : '—';
            return `${a}=${avg}%`;
          }).join(' / ');
          return `  - ${NPS_DRIVER_LABELS[d]||d}: ${byAnio}`;
        });
        return `Target NPS: 70%\n${lines.join('\n')}\nDesglose por driver:\n${driverLines.join('\n')}`;
      })()} />
    </div>
  );
}

function TabNPSMejorado({data}) {
  const compact = useCompactLayout();
  const nps = normalizeNpsRows(data.nps || FALLBACK.nps);
  const motivos = normalizeMotivoRows(data.motivos || FALLBACK.motivos);
  const anios = [...new Set(nps.map(n => n.anio))].sort().slice(-2);
  const currentYear = anios[anios.length - 1];
  const prevYear = anios.length > 1 ? anios[anios.length - 2] : null;
  const MESES = ['Ene','Feb','Mar','Abr','May','Jun','Jul','Ago','Sep','Oct','Nov','Dic'];
  const latestMonth = Math.max(...nps.filter(n => n.anio === currentYear).map(n => n.mes_num));
  const latestMonthName = MESES[latestMonth - 1] || 'Ultimo mes';
  const periodLabel = `Ene-${latestMonthName}`;

  const gral = nps.filter(n => n.driver_key === 'GRAL');
  const npsTrend = timeSeries(gral, anios, 'nps_pct');

  const totales = anios.map(a => {
    const rows = nps.filter(n => n.anio === a && n.driver_key === 'GRAL');
    return rows.map(r => {
      const pct = r.clientes > 0 ? (r.detractores / r.clientes * 100) : 0;
      return {anio:a, mes_num:r.mes_num, mes:r.mes, pct};
    });
  }).flat();

  const detrTrend = MESES.map((mes, idx) => {
    const entry = {mes};
    anios.forEach(a => {
      const r = totales.find(t => t.anio === a && t.mes_num === idx + 1);
      entry[String(a)] = r ? parseFloat(r.pct.toFixed(1)) : null;
    });
    return entry;
  });

  const currentRows = nps.filter(n => n.anio === currentYear && n.mes_num <= latestMonth);
  const prevRows = prevYear ? nps.filter(n => n.anio === prevYear && n.mes_num <= latestMonth) : [];
  const currentSummary = summarizeNps(currentRows.filter(n => n.driver_key === 'GRAL'));
  const prevSummary = summarizeNps(prevRows.filter(n => n.driver_key === 'GRAL'));
  const latestRows = nps.filter(n => n.anio === currentYear && n.mes_num === latestMonth);
  const latestSummary = summarizeNps(latestRows.filter(n => n.driver_key === 'GRAL'));
  const npsDelta = currentSummary.nps !== null && prevSummary.nps !== null ? currentSummary.nps - prevSummary.nps : null;
  const targetGap = currentSummary.nps === null ? null : NPS_TARGET - currentSummary.nps;
  const targetNetNeeded = Math.max(0, Math.ceil((NPS_TARGET / 100) * currentSummary.clientes - (currentSummary.promotores - currentSummary.detractores)));

  const kpiCards = [
    {
      label:`NPS ${currentYear} YTD`,
      val:fmtPct1(currentSummary.nps),
      sub:prevYear ? `${fmtDelta(npsDelta)} vs ${prevYear} ${periodLabel}` : 'Sin comparacion previa',
      color: currentSummary.nps >= NPS_TARGET ? C.green : currentSummary.nps >= 55 ? C.amber : C.red,
    },
    {
      label:`Ultimo mes ${latestMonthName}`,
      val:fmtPct1(latestSummary.nps),
      sub:`${latestSummary.clientes} respuestas · ${latestSummary.detractores} detractores`,
      color: latestSummary.nps >= NPS_TARGET ? C.green : latestSummary.nps >= 55 ? C.amber : C.red,
    },
    {
      label:'Brecha target',
      val: targetGap !== null && targetGap <= 0 ? 'En target' : `${Math.max(0, targetGap || 0).toFixed(1)} pp`,
      sub: targetNetNeeded > 0 ? `Faltan ${targetNetNeeded} respuestas netas` : 'Sostener promotores',
      color: targetGap !== null && targetGap <= 0 ? C.green : targetGap <= 10 ? C.amber : C.red,
    },
    {
      label:'% detractores',
      val:fmtPct1(currentSummary.detrPct),
      sub:`${currentSummary.detractores} de ${currentSummary.clientes} respuestas`,
      color: currentSummary.detrPct <= 10 ? C.green : currentSummary.detrPct <= 15 ? C.amber : C.red,
    },
  ];

  const driverData = NPS_DRIVERS_ORDER.map(d => {
    const entry = {driver: NPS_DRIVER_LABELS[d] || d};
    anios.forEach(a => {
      const rows = nps.filter(n => n.anio === a && n.mes_num <= latestMonth && n.driver_key === d);
      const summary = summarizeNps(rows);
      entry[String(a)] = summary.nps !== null ? parseFloat(summary.nps.toFixed(1)) : null;
    });
    return entry;
  });

  const riskRows = NPS_DRIVERS_ORDER
    .filter(d => d !== 'GRAL')
    .map(d => {
      const curr = summarizeNps(currentRows.filter(n => n.driver_key === d));
      const prev = summarizeNps(prevRows.filter(n => n.driver_key === d));
      const delta = curr.nps !== null && prev.nps !== null ? curr.nps - prev.nps : null;
      const color = curr.nps >= NPS_TARGET ? C.green : curr.nps >= 50 ? C.amber : C.red;
      return {
        key:d,
        label:NPS_DRIVER_LABELS[d] || d,
        nps:curr.nps,
        clientes:curr.clientes,
        detractores:curr.detractores,
        detrPct:curr.detrPct,
        delta,
        gap:curr.nps === null ? null : curr.nps - NPS_TARGET,
        color,
      };
    })
    .sort((a,b) => (a.nps ?? 999) - (b.nps ?? 999) || b.detractores - a.detractores);

  const worst = riskRows[0];
  const biggestDetractor = [...riskRows].sort((a,b) => b.detractores - a.detractores)[0];
  const riskAlert = worst
    ? `${worst.label}: ${fmtPct1(worst.nps)} (${fmtDelta(worst.delta)} vs ${prevYear || 'previo'}). ${biggestDetractor.label} acumula ${biggestDetractor.detractores} detractores.`
    : null;

  const latestMix = latestRows
    .filter(n => n.driver_key !== 'GRAL')
    .map(row => {
      const s = summarizeNps([row]);
      return {
        driver: row.driver_label,
        nps: n2(row.nps_pct),
        promPct: parseFloat(s.promPct.toFixed(1)),
        neutPct: parseFloat(s.neutPct.toFixed(1)),
        detrPct: parseFloat(s.detrPct.toFixed(1)),
      };
    })
    .sort((a,b) => a.nps - b.nps);

  const deliveryRows = nps.filter(n => n.driver_key === 'DELIVERY');
  const currentDeliveryRows = currentRows.filter(n => n.driver_key === 'DELIVERY');
  const prevDeliveryRows = prevRows.filter(n => n.driver_key === 'DELIVERY');
  const latestDeliveryRows = latestRows.filter(n => n.driver_key === 'DELIVERY');
  const deliverySummary = summarizeNps(currentDeliveryRows);
  const prevDeliverySummary = summarizeNps(prevDeliveryRows);
  const latestDeliverySummary = summarizeNps(latestDeliveryRows);
  const deliveryDelta = deliverySummary.nps !== null && prevDeliverySummary.nps !== null
    ? deliverySummary.nps - prevDeliverySummary.nps
    : null;
  const deliveryGapVsGeneral = deliverySummary.nps !== null && currentSummary.nps !== null
    ? deliverySummary.nps - currentSummary.nps
    : null;
  const deliveryTargetGap = deliverySummary.nps === null ? null : deliverySummary.nps - NPS_TARGET;
  const deliveryNetNeeded = Math.max(0, Math.ceil((NPS_TARGET / 100) * deliverySummary.clientes - (deliverySummary.promotores - deliverySummary.detractores)));
  const deliveryKpis = [
    {
      label:`Delivery ${currentYear} YTD`,
      val:fmtPct1(deliverySummary.nps),
      sub:prevYear ? `${fmtDelta(deliveryDelta)} vs ${prevYear} ${periodLabel}` : 'Sin comparación previa',
      color: deliverySummary.nps >= NPS_TARGET ? C.green : deliverySummary.nps >= 50 ? C.amber : C.red,
    },
    {
      label:`Delivery ${latestMonthName}`,
      val:fmtPct1(latestDeliverySummary.nps),
      sub:`${latestDeliverySummary.clientes} respuestas · ${latestDeliverySummary.detractores} detractores`,
      color: latestDeliverySummary.nps >= NPS_TARGET ? C.green : latestDeliverySummary.nps >= 50 ? C.amber : C.red,
    },
    {
      label:'Brecha vs NPS gral',
      val:fmtDelta(deliveryGapVsGeneral),
      sub:deliveryGapVsGeneral < 0 ? 'Delivery tracciona hacia abajo' : 'Delivery acompaña o supera el promedio',
      color: deliveryGapVsGeneral < -5 ? C.red : deliveryGapVsGeneral < 0 ? C.amber : C.green,
    },
    {
      label:'Brecha target Delivery',
      val:deliveryTargetGap !== null && deliveryTargetGap >= 0 ? 'En target' : fmtDelta(deliveryTargetGap),
      sub:deliveryNetNeeded > 0 ? `Faltan ${deliveryNetNeeded} respuestas netas` : 'Sostener promotores',
      color: deliveryTargetGap >= 0 ? C.green : deliveryTargetGap >= -15 ? C.amber : C.red,
    },
  ];

  const deliveryTrend = MESES.map((mes, idx) => {
    const entry = {mes};
    anios.forEach(a => {
      const d = deliveryRows.find(r => r.anio === a && r.mes_num === idx + 1);
      const g = gral.find(r => r.anio === a && r.mes_num === idx + 1);
      entry[`${a} Delivery`] = d ? parseFloat(n2(d.nps_pct).toFixed(1)) : null;
      entry[`${a} NPS Gral`] = g ? parseFloat(n2(g.nps_pct).toFixed(1)) : null;
    });
    return entry;
  });

  const deliveryMixTrend = deliveryRows
    .filter(n => n.anio === currentYear && n.mes_num <= latestMonth)
    .sort((a, b) => a.mes_num - b.mes_num)
    .map(row => {
      const s = summarizeNps([row]);
      return {
        mes: row.mes,
        promPct: parseFloat(s.promPct.toFixed(1)),
        neutPct: parseFloat(s.neutPct.toFixed(1)),
        detrPct: parseFloat(s.detrPct.toFixed(1)),
        clientes: s.clientes,
        detractores: s.detractores,
      };
    });

  const deliveryCauses = groupDeliveryCauses(motivos, currentYear, prevYear, latestMonth);
  const actionableCauses = deliveryCauses.filter(c => !/otro/i.test(c.motivo));
  const topCause = actionableCauses[0] || deliveryCauses[0];
  const risingCause = actionableCauses.filter(c => c.delta > 0).sort((a, b) => b.delta - a.delta)[0];
  const deliveryInsights = buildDeliveryInsight({
    deliverySummary,
    prevDeliverySummary,
    currentSummary,
    topCause,
    risingCause,
    latestMonthName,
  });
  const deliveryAlert = topCause
    ? `Principal causa operativa asociada: ${topCause.motivo} (${topCause.actual} casos, ${topCause.share.toFixed(1)}%).`
    : null;

  return (
    <div style={{display:'flex', flexDirection:'column', gap:16}}>
      <div style={{display:'grid', gridTemplateColumns:`repeat(auto-fit, minmax(${compact ? 150 : 180}px, 1fr))`, gap:10}}>
        {kpiCards.map(k => (
          <div key={k.label} style={{background:C.bg1, border:`1px solid ${C.border}`, borderLeft:`4px solid ${k.color}`, borderRadius:10, padding:'14px 16px', boxShadow:'0 1px 4px rgba(59,89,152,0.08)'}}>
            <div style={{fontSize:10, color:C.text2, textTransform:'uppercase', letterSpacing:1.4, marginBottom:7, fontWeight:600}}>{k.label}</div>
            <div style={{fontSize:24, fontWeight:700, color:k.color, fontFamily:'monospace'}}>{k.val}</div>
            <div style={{fontSize:10, color:C.text1, marginTop:7, lineHeight:1.4}}>{k.sub}</div>
          </div>
        ))}
      </div>

      <div style={{display:'flex', gap:16, flexWrap:'wrap'}}>
        <Panel title="NPS General mensual" style={{flex:'2 1 560px'}}>
          <ResponsiveContainer width="100%" height={compact ? 280 : 250}>
            <LineChart data={npsTrend} margin={{top:30, right:compact ? 12 : 24, left:0, bottom:4}}>
              <CartesianGrid strokeDasharray="3 3" stroke={C.border} />
              <XAxis dataKey="mes" stroke={C.text2} tick={{fontSize:10, fill:C.text2}} />
              <YAxis stroke={C.text2} domain={[-30,110]} tick={{fontSize:10, fill:C.text2}} tickFormatter={v => `${v}%`} />
              <Tooltip {...tt} formatter={v => [fmtPct1(v),'']} />
              <ReferenceLine y={NPS_TARGET} stroke={C.green} strokeDasharray="4 4" label={{value:`Target ${NPS_TARGET}%`,fill:C.green,fontSize:9}} />
              {anios.map(a => (
                <Line key={a} type="monotone" dataKey={String(a)} stroke={COLORS_BY_YEAR[a]||C.blue} strokeWidth={a===currentYear?2.8:2} dot={{r:a===currentYear?4:3}} connectNulls={false}>
                  {a===currentYear && <LabelList dataKey={String(a)} content={(props) => <PointLabel {...props} formatter={chartPctLabel} fill={COLORS_BY_YEAR[a]||C.blue} />} />}
                </Line>
              ))}
              <Legend wrapperStyle={{fontSize:10, color:C.text1}} />
            </LineChart>
          </ResponsiveContainer>
        </Panel>

        <Panel title="% Detractores NPS" style={{flex:'1 1 360px'}}>
          <ResponsiveContainer width="100%" height={compact ? 280 : 250}>
            <LineChart data={detrTrend} margin={{top:30, right:compact ? 12 : 24, left:0, bottom:4}}>
              <CartesianGrid strokeDasharray="3 3" stroke={C.border} />
              <XAxis dataKey="mes" stroke={C.text2} tick={{fontSize:10, fill:C.text2}} />
              <YAxis stroke={C.text2} tick={{fontSize:10, fill:C.text2}} tickFormatter={v => `${v}%`} />
              <Tooltip {...tt} formatter={v => [fmtPct1(v),'']} />
              <ReferenceLine y={10} stroke={C.red} strokeDasharray="4 4" label={{value:'Meta <10%',fill:C.red,fontSize:9}} />
              {anios.map(a => (
                <Line key={a} type="monotone" dataKey={String(a)} stroke={COLORS_BY_YEAR[a]||C.amber} strokeWidth={a===currentYear?2.8:2} dot={{r:a===currentYear?4:3}} connectNulls={false}>
                  {a===currentYear && <LabelList dataKey={String(a)} content={(props) => <PointLabel {...props} formatter={chartPctLabel} fill={COLORS_BY_YEAR[a]||C.amber} />} />}
                </Line>
              ))}
              <Legend wrapperStyle={{fontSize:10, color:C.text1}} />
            </LineChart>
          </ResponsiveContainer>
        </Panel>
      </div>

      <div style={{display:'flex', gap:16, flexWrap:'wrap'}}>
        <Panel title={`Comparativo por driver (${periodLabel}, ponderado)`} alert={riskAlert} style={{flex:'2 1 620px'}}>
          <ResponsiveContainer width="100%" height={compact ? 340 : 310}>
            <BarChart data={driverData} margin={{top:30, right:compact ? 12 : 24, left:0, bottom:10}}>
              <CartesianGrid strokeDasharray="3 3" stroke={C.border} />
              <XAxis dataKey="driver" stroke={C.text2} tick={{fontSize:9, fill:C.text2}} angle={compact ? -28 : -18} textAnchor="end" height={compact ? 78 : 60} interval={0} />
              <YAxis stroke={C.text2} tick={{fontSize:10, fill:C.text2}} tickFormatter={v => `${v}%`} />
              <Tooltip {...tt} formatter={v => [fmtPct1(v),'']} />
              <ReferenceLine y={NPS_TARGET} stroke={C.green} strokeDasharray="4 4" />
              {anios.map(a => (
                <Bar key={a} dataKey={String(a)} fill={a===currentYear ? C.amber : `${C.blue}60`} name={String(a)} radius={[4,4,0,0]}>
                  {a===currentYear && <LabelList dataKey={String(a)} content={(props) => <BarTopLabel {...props} formatter={chartPctLabel} fill={C.amber} />} />}
                </Bar>
              ))}
              <Legend wrapperStyle={{fontSize:10, color:C.text1}} />
            </BarChart>
          </ResponsiveContainer>
        </Panel>

        <Panel title={`Drivers criticos ${currentYear}`} style={{flex:'1 1 420px'}}>
          <div style={{overflowX:'auto'}}>
            <div style={{display:'grid', gridTemplateColumns:'minmax(128px,1.2fr) repeat(4,minmax(62px,.6fr))', gap:8, fontSize:9, color:C.text2, letterSpacing:1, textTransform:'uppercase', marginBottom:8}}>
              <div>Driver</div><div>NPS</div><div>Var</div><div>Detr.</div><div>Brecha</div>
            </div>
            {riskRows.slice(0, 7).map(row => (
              <div key={row.key} style={{display:'grid', gridTemplateColumns:'minmax(128px,1.2fr) repeat(4,minmax(62px,.6fr))', gap:8, alignItems:'center', padding:'8px 0', borderTop:`1px solid ${C.border}`}}>
                <div style={{fontSize:11, color:C.text0, lineHeight:1.35}}>{row.label}</div>
                <div style={{fontSize:12, color:row.color, fontWeight:700}}>{fmtPct1(row.nps)}</div>
                <div style={{fontSize:11, color:row.delta < 0 ? C.red : row.delta > 0 ? C.green : C.text1}}>{fmtDelta(row.delta)}</div>
                <div style={{fontSize:11, color:C.text1}}>{row.detractores} <span style={{color:C.text2}}>({fmtPct1(row.detrPct)})</span></div>
                <div style={{fontSize:11, color:(row.gap ?? -1) >= 0 ? C.green : C.red}}>{fmtDelta(row.gap)}</div>
              </div>
            ))}
          </div>
        </Panel>
      </div>

      <Panel title={`Mix de respuestas por driver - ${latestMonthName} ${currentYear}`}>
        <ResponsiveContainer width="100%" height={Math.max(compact ? 330 : 290, latestMix.length * (compact ? 42 : 36) + 64)}>
          <BarChart data={latestMix} layout="vertical" margin={{top:8, right:compact ? 12 : 28, left:compact ? 4 : 22, bottom:8}}>
            <CartesianGrid strokeDasharray="3 3" stroke={C.border} />
            <XAxis type="number" domain={[0,100]} stroke={C.text2} tick={{fontSize:10, fill:C.text2}} tickFormatter={v => `${v}%`} />
            <YAxis dataKey="driver" type="category" stroke={C.text2} tick={{fontSize:10, fill:C.text2}} width={compact ? 112 : 140} />
            <Tooltip {...tt} formatter={(v, name) => [fmtPct1(v), name]} />
            <Bar dataKey="promPct" stackId="mix" fill={C.green} name="Promotores" radius={[4,0,0,4]}>
              <LabelList dataKey="promPct" content={(props) => <StackCenterLabel {...props} fill="#fff" />} />
            </Bar>
            <Bar dataKey="neutPct" stackId="mix" fill={C.text2} name="Neutros">
              <LabelList dataKey="neutPct" content={(props) => <StackCenterLabel {...props} fill={C.text0} />} />
            </Bar>
            <Bar dataKey="detrPct" stackId="mix" fill={C.red} name="Detractores" radius={[0,4,4,0]}>
              <LabelList dataKey="detrPct" content={(props) => <StackCenterLabel {...props} fill="#fff" />} />
            </Bar>
            <Legend wrapperStyle={{fontSize:10, color:C.text1}} />
          </BarChart>
        </ResponsiveContainer>
      </Panel>

      <div style={{display:'grid', gridTemplateColumns:`repeat(auto-fit, minmax(${compact ? 150 : 180}px, 1fr))`, gap:10}}>
        {deliveryKpis.map(k => (
          <div key={k.label} style={{background:C.bg1, border:`1px solid ${C.border}`, borderLeft:`4px solid ${k.color}`, borderRadius:10, padding:'14px 16px', boxShadow:'0 1px 4px rgba(59,89,152,0.08)'}}>
            <div style={{fontSize:10, color:C.text2, textTransform:'uppercase', letterSpacing:1.4, marginBottom:7, fontWeight:600}}>{k.label}</div>
            <div style={{fontSize:23, fontWeight:700, color:k.color, fontFamily:'monospace'}}>{k.val}</div>
            <div style={{fontSize:10, color:C.text1, marginTop:7, lineHeight:1.4}}>{k.sub}</div>
          </div>
        ))}
      </div>

      <div style={{display:'flex', gap:16, flexWrap:'wrap'}}>
        <Panel title={`Delivery Experience vs NPS general (${periodLabel})`} style={{flex:'2 1 620px'}}>
          <ResponsiveContainer width="100%" height={compact ? 320 : 290}>
            <LineChart data={deliveryTrend} margin={{top:32, right:compact ? 12 : 28, left:0, bottom:4}}>
              <CartesianGrid strokeDasharray="3 3" stroke={C.border} />
              <XAxis dataKey="mes" stroke={C.text2} tick={{fontSize:10, fill:C.text2}} />
              <YAxis stroke={C.text2} domain={[-40,110]} tick={{fontSize:10, fill:C.text2}} tickFormatter={v => `${v}%`} />
              <Tooltip {...tt} formatter={(v, name) => [fmtPct1(v), name]} />
              <ReferenceLine y={NPS_TARGET} stroke={C.green} strokeDasharray="4 4" label={{value:`Target ${NPS_TARGET}%`,fill:C.green,fontSize:9}} />
              {anios.map(a => (
                <Line key={`${a}-delivery`} type="monotone" dataKey={`${a} Delivery`} stroke={a===currentYear ? C.amber : C.red} strokeWidth={a===currentYear?3:2} dot={{r:a===currentYear?4:3}} connectNulls={false}>
                  {a===currentYear && <LabelList dataKey={`${a} Delivery`} content={(props) => <PointLabel {...props} formatter={chartPctLabel} fill={C.amber} />} />}
                </Line>
              ))}
              {anios.map(a => (
                <Line key={`${a}-gral`} type="monotone" dataKey={`${a} NPS Gral`} stroke={a===currentYear ? C.blue : C.border2} strokeWidth={a===currentYear?2.5:2} strokeDasharray="5 5" dot={{r:2}} connectNulls={false}>
                  {a===currentYear && <LabelList dataKey={`${a} NPS Gral`} content={(props) => <PointLabel {...props} formatter={chartPctLabel} fill={C.blue} offsetY={14} />} />}
                </Line>
              ))}
              <Legend wrapperStyle={{fontSize:10, color:C.text1}} />
            </LineChart>
          </ResponsiveContainer>
        </Panel>

        <Panel title={`Lectura operativa Delivery ${currentYear}`} alert={deliveryAlert} style={{flex:'1 1 380px'}}>
          <div style={{display:'flex', flexDirection:'column'}}>
            {deliveryInsights.map((ins, idx) => (
              <div key={ins.label} style={{display:'grid', gridTemplateColumns:compact ? '1fr' : '90px 1fr', gap:compact ? 4 : 10, padding:'10px 0', borderTop:idx ? `1px solid ${C.border}` : 'none', alignItems:'start'}}>
                <div style={{fontSize:10, color:ins.color, textTransform:'uppercase', letterSpacing:1, fontWeight:700}}>{ins.label}</div>
                <div style={{fontSize:12, color:C.text0, lineHeight:1.45}}>{ins.text}</div>
              </div>
            ))}
          </div>
        </Panel>
      </div>

      <div style={{display:'flex', gap:16, flexWrap:'wrap'}}>
        <Panel title={`Mix mensual Delivery - ${currentYear}`} style={{flex:'1 1 420px'}}>
          <ResponsiveContainer width="100%" height={compact ? 300 : 270}>
            <BarChart data={deliveryMixTrend} margin={{top:12, right:compact ? 10 : 22, left:0, bottom:4}}>
              <CartesianGrid strokeDasharray="3 3" stroke={C.border} />
              <XAxis dataKey="mes" stroke={C.text2} tick={{fontSize:10, fill:C.text2}} />
              <YAxis domain={[0,100]} stroke={C.text2} tick={{fontSize:10, fill:C.text2}} tickFormatter={v => `${v}%`} />
              <Tooltip {...tt} formatter={(v, name) => [fmtPct1(v), name]} />
              <Bar dataKey="promPct" stackId="mix" fill={C.green} name="Promotores" radius={[4,4,0,0]}>
                <LabelList dataKey="promPct" content={(props) => <StackCenterLabel {...props} fill="#fff" />} />
              </Bar>
              <Bar dataKey="neutPct" stackId="mix" fill={C.text2} name="Neutros">
                <LabelList dataKey="neutPct" content={(props) => <StackCenterLabel {...props} fill={C.text0} />} />
              </Bar>
              <Bar dataKey="detrPct" stackId="mix" fill={C.red} name="Detractores">
                <LabelList dataKey="detrPct" content={(props) => <StackCenterLabel {...props} fill="#fff" />} />
              </Bar>
              <Legend wrapperStyle={{fontSize:10, color:C.text1}} />
            </BarChart>
          </ResponsiveContainer>
        </Panel>

        <Panel title={`Causas operativas asociadas a Delivery - ${periodLabel}`} style={{flex:'1.5 1 520px'}}>
          <ResponsiveContainer width="100%" height={Math.max(compact ? 320 : 270, Math.min(7, deliveryCauses.length) * (compact ? 42 : 36) + 76)}>
            <BarChart data={deliveryCauses.slice(0, 7)} layout="vertical" margin={{top:8, right:compact ? 50 : 62, left:compact ? 0 : 18, bottom:8}}>
              <CartesianGrid strokeDasharray="3 3" stroke={C.border} />
              <XAxis type="number" stroke={C.text2} tick={{fontSize:10, fill:C.text2}} allowDecimals={false} />
              <YAxis dataKey="motivo" type="category" stroke={C.text2} tick={{fontSize:10, fill:C.text2}} width={compact ? 126 : 180} />
              <Tooltip {...tt} formatter={(v, name) => [v, name]} />
              {prevYear && (
                <Bar dataKey="anterior" fill={`${C.blue}55`} name={String(prevYear)} radius={[0,4,4,0]}>
                  <LabelList dataKey="anterior" content={(props) => <BarRightLabel {...props} formatter={chartCountLabel} fill={C.blue} />} />
                </Bar>
              )}
              <Bar dataKey="actual" fill={C.amber} name={String(currentYear)} radius={[0,4,4,0]}>
                <LabelList dataKey="actual" content={(props) => <BarRightLabel {...props} formatter={chartCountLabel} fill={C.amber} />} />
              </Bar>
              <Legend wrapperStyle={{fontSize:10, color:C.text1}} />
            </BarChart>
          </ResponsiveContainer>
        </Panel>
      </div>

      <FodaPanel metrica="NPS (Net Promoter Score)" contexto={(() => {
        const lines = anios.map(a => {
          const gralRows = nps.filter(n => n.anio===a && n.mes_num <= latestMonth && n.driver_key==='GRAL');
          const s = summarizeNps(gralRows);
          return `${a}: NPS Gral ponderado=${fmtPct1(s.nps)} | Clientes=${s.clientes} | Promotores=${s.promotores} | Detractores=${s.detractores} | % Detractores=${fmtPct1(s.detrPct)}`;
        });
        const driverLines = NPS_DRIVERS_ORDER.map(d => {
          const byAnio = anios.map(a => {
            const rows = nps.filter(n=>n.anio===a && n.mes_num <= latestMonth && n.driver_key===d);
            const s = summarizeNps(rows);
            return `${a}=${fmtPct1(s.nps)} (${s.clientes} resp, ${s.detractores} detr.)`;
          }).join(' / ');
          return `  - ${NPS_DRIVER_LABELS[d]||d}: ${byAnio}`;
        });
        const deliveryLines = anios.map(a => {
          const rows = nps.filter(n=>n.anio===a && n.mes_num <= latestMonth && n.driver_key==='DELIVERY');
          const s = summarizeNps(rows);
          return `${a}: Delivery=${fmtPct1(s.nps)} | Clientes=${s.clientes} | Promotores=${s.promotores} | Detractores=${s.detractores} | % Detractores=${fmtPct1(s.detrPct)}`;
        });
        const causeLines = deliveryCauses.slice(0, 5).map(c => `  - ${c.motivo}: ${currentYear}=${c.actual}${prevYear ? ` / ${prevYear}=${c.anterior} / var=${c.delta}` : ''}`);
        return `Target NPS: ${NPS_TARGET}%\nCorte comparativo: ${periodLabel}\n${lines.join('\n')}\nDesglose por driver:\n${driverLines.join('\n')}\nDetalle Delivery Experience:\n${deliveryLines.join('\n')}\nCausas operativas asociadas a Delivery:\n${causeLines.join('\n')}`;
      })()} />
    </div>
  );
}

function TabNSFR({data}) {
  const compact = useCompactLayout();
  const nsfr = data.nsfr || FALLBACK.nsfr;
  const anios = [...new Set(nsfr.map(n => parseInt(n.anio)))].sort().slice(-3);

  const trend = timeSeries(nsfr, anios, 'nsfr_pct');

  const resumen = anios.map(a => {
    const rows = nsfr.filter(n => parseInt(n.anio) === a);
    const ped = rows.reduce((s,r) => s + n2(r.hl_pedidos), 0);
    const ent = rows.reduce((s,r) => s + n2(r.hl_entregados), 0);
    const pct = ped > 0 ? (ent/ped*100).toFixed(1) : '—';
    const color = parseFloat(pct) >= 70 ? C.green : parseFloat(pct) >= 60 ? C.amber : C.red;
    return {anio:a, ped: ped.toFixed(0), ent: ent.toFixed(0), pct, color};
  });

  return (
    <div style={{display:'flex', flexDirection:'column', gap:16}}>
      <div style={{display:'grid', gridTemplateColumns:`repeat(auto-fit, minmax(${compact ? 150 : 180}px, 1fr))`, gap:12}}>
        {resumen.map(r => (
          <div key={r.anio} style={{background:C.bg1, border:`1px solid ${C.border}`, borderLeft:`4px solid ${r.color}`, borderRadius:10, padding:'14px 18px', boxShadow:'0 1px 4px rgba(59,89,152,0.08)'}}>
            <div style={{fontSize:10, color:C.text2, textTransform:'uppercase', letterSpacing:1.5, marginBottom:8, fontWeight:600}}>Acum. {r.anio}</div>
            <div style={{fontSize:28, fontWeight:700, color:r.color, fontFamily:'monospace'}}>{r.pct}%</div>
            <div style={{fontSize:10, color:C.text1, marginTop:6}}>{r.ped} HL ped / {r.ent} ent</div>
          </div>
        ))}
      </div>
      <Panel title="NS FR mensual — HL (% entregado/pedido)" alert="✓ 2026 supera el target del 70%">
        <ResponsiveContainer width="100%" height={compact ? 300 : 270}>
          <LineChart data={trend} margin={{top:30, right:compact ? 12 : 24, left:0, bottom:4}}>
            <CartesianGrid strokeDasharray="3 3" stroke={C.border} />
            <XAxis dataKey="mes" stroke={C.text2} tick={{fontSize:10, fill:C.text2}} />
            <YAxis stroke={C.text2} tick={{fontSize:10, fill:C.text2}} tickFormatter={v => `${Math.round(v)}%`} />
            <Tooltip {...tt} formatter={v => v ? [`${v.toFixed(1)}%`,''] : ['—','']} />
            <ReferenceLine y={70} stroke={C.green} strokeDasharray="4 4" label={{value:'Target 70%',fill:C.green,fontSize:9}} />
            {anios.map(a => (
              <Line key={a} type="monotone" dataKey={String(a)} stroke={COLORS_BY_YEAR[a]||C.blue} strokeWidth={a===anios[anios.length-1]?2.5:2} dot={{r:a===anios[anios.length-1]?4:3}} connectNulls={false}>
                {a===anios[anios.length-1] && <LabelList dataKey={String(a)} content={(props) => <PointLabel {...props} formatter={chartPctLabel} fill={COLORS_BY_YEAR[a]||C.blue} />} />}
              </Line>
            ))}
            <Legend wrapperStyle={{fontSize:10, color:C.text1}} />
          </LineChart>
        </ResponsiveContainer>
      </Panel>
      <FodaPanel metrica="NS FR (Nivel de Servicio Facturación Remota)" contexto={(() => {
        const lines = resumen.map(r => {
          const rows = nsfr.filter(n=>parseInt(n.anio)===r.anio);
          const meses = rows.map(n=>n.mes).join(', ');
          return `${r.anio}: NS FR acumulado=${r.pct}% | HL pedidos=${r.ped} | HL entregados=${r.ent} | Meses cargados: ${meses}`;
        });
        const mensualLines = trend.filter(t => anios.some(a => t[String(a)] !== null)).map(t => {
          const byAnio = anios.map(a => t[String(a)] ? `${a}=${t[String(a)].toFixed(1)}%` : null).filter(Boolean).join(' / ');
          return `  ${t.mes}: ${byAnio}`;
        });
        return `Target NS FR: 70%\n${lines.join('\n')}\nDetalle mensual:\n${mensualLines.join('\n')}`;
      })()} />
    </div>
  );
}


// =========================================================
// TAB INFORME EJECUTIVO
// =========================================================
function buildInformeContexto(data) {
  const rmd     = data.rmd     || FALLBACK.rmd;
  const motivos = normalizeMotivoRows(data.motivos || FALLBACK.motivos);
  const nps     = normalizeNpsRows(data.nps || FALLBACK.nps);
  const nsfr    = data.nsfr    || FALLBACK.nsfr;

  const aniosRmd  = [...new Set(rmd.map(r=>parseInt(r.anio)))].sort();
  const aniosNps  = [...new Set(nps.map(n=>n.anio))].sort();
  const aniosNsfr = [...new Set(nsfr.map(n=>parseInt(n.anio)))].sort();
  const ultimoAnioRmd  = Math.max(...aniosRmd);
  const ultimoAnioNps  = Math.max(...aniosNps);
  const ultimoAnioNsfr = Math.max(...aniosNsfr);

  // RMD
  const rmdRows  = rmd.filter(r=>parseInt(r.anio)===ultimoAnioRmd);
  const rmdPrev  = rmd.filter(r=>parseInt(r.anio)===ultimoAnioRmd-1);
  const rmdAvg   = (rmdRows.reduce((s,r)=>s+n2(r.rmd),0)/rmdRows.length).toFixed(2);
  const detrAvg  = (rmdRows.reduce((s,r)=>s+n2(r.pct_detractores),0)/rmdRows.length).toFixed(1);
  const respAvg  = (rmdRows.reduce((s,r)=>s+n2(r.pct_respuestas),0)/rmdRows.length).toFixed(1);
  const rmdPrevAvg = rmdPrev.length ? (rmdPrev.reduce((s,r)=>s+n2(r.rmd),0)/rmdPrev.length).toFixed(2) : '—';

  const motiResumen = [...new Set(motivos.map(m=>m.motivo))].map(mot => {
    const curr = motivos.filter(m=>parseInt(m.anio)===ultimoAnioRmd&&m.motivo===mot).reduce((s,m)=>s+n2(m.cantidad),0);
    const prev = motivos.filter(m=>parseInt(m.anio)===ultimoAnioRmd-1&&m.motivo===mot).reduce((s,m)=>s+n2(m.cantidad),0);
    const var_ = prev > 0 ? Math.round((curr-prev)/prev*100) : 'N/A';
    return `    ${mot}: ${curr} casos (${ultimoAnioRmd-1}=${prev}, variación=${var_}%)`;
  }).join('\n');

  // NPS con ponderación por volumen
  const npsRowsAll = nps.filter(n=>n.anio===ultimoAnioNps);
  const ultimoMesNps = Math.max(...npsRowsAll.map(n=>n.mes_num));
  const npsRows = npsRowsAll.filter(n=>n.mes_num<=ultimoMesNps);
  const npsPrev = nps.filter(n=>n.anio===ultimoAnioNps-1 && n.mes_num<=ultimoMesNps);
  const gralRows = npsRows.filter(n=>n.driver_key==='GRAL');
  const npsGralSummary = summarizeNps(gralRows);
  const npsAvg  = fmtPct1(npsGralSummary.nps);
  const totCli  = npsGralSummary.clientes;
  const totPro  = npsGralSummary.promotores;
  const totDet  = npsGralSummary.detractores;
  const pctDetNps = fmtPct1(npsGralSummary.detrPct);

  const driverLines = NPS_DRIVERS_ORDER.filter(d=>d!=='GRAL').map(d => {
    const rows  = npsRows.filter(n=>n.driver_key===d);
    const prevR = npsPrev.filter(n=>n.driver_key===d);
    const currS = summarizeNps(rows);
    const prevS = summarizeNps(prevR);
    const avg   = fmtPct1(currS.nps);
    const avgP  = fmtPct1(prevS.nps);
    const totCliD = currS.clientes;
    const totDetD = currS.detractores;
    const pDet  = fmtPct1(currS.detrPct);
    const var_  = currS.nps !== null && prevS.nps !== null ? (currS.nps-prevS.nps).toFixed(1) : 'N/A';
    const label = NPS_DRIVER_LABELS[d] || d;
    return `    ${label}: NPS=${avg} (año anterior=${avgP}, var=${var_} pp) | Clientes=${totCliD} | Detractores=${totDetD} | %Detractores=${pDet}`;
  }).join('\n');

  const deliveryRows = npsRows.filter(n=>n.driver_key==='DELIVERY');
  const deliveryPrev = npsPrev.filter(n=>n.driver_key==='DELIVERY');
  const deliverySummary = summarizeNps(deliveryRows);
  const deliveryPrevSummary = summarizeNps(deliveryPrev);
  const deliveryVar = deliverySummary.nps !== null && deliveryPrevSummary.nps !== null
    ? (deliverySummary.nps - deliveryPrevSummary.nps).toFixed(1)
    : 'N/A';
  const deliveryMotivos = groupDeliveryCauses(motivos, ultimoAnioNps, ultimoAnioNps - 1, ultimoMesNps)
    .slice(0, 6)
    .map(c => `    ${c.motivo}: ${ultimoAnioNps}=${c.actual} | ${ultimoAnioNps-1}=${c.anterior} | var=${c.delta} | peso=${c.share.toFixed(1)}%`)
    .join('\n');

  // NS FR
  const nsfrRows = nsfr.filter(n=>parseInt(n.anio)===ultimoAnioNsfr);
  const nsfrPrev = nsfr.filter(n=>parseInt(n.anio)===ultimoAnioNsfr-1);
  const nsfrPed  = nsfrRows.reduce((s,r)=>s+n2(r.hl_pedidos),0);
  const nsfrEnt  = nsfrRows.reduce((s,r)=>s+n2(r.hl_entregados),0);
  const nsfrPct  = nsfrPed > 0 ? (nsfrEnt/nsfrPed*100).toFixed(1) : '—';
  const nsfrPedP = nsfrPrev.reduce((s,r)=>s+n2(r.hl_pedidos),0);
  const nsfrEntP = nsfrPrev.reduce((s,r)=>s+n2(r.hl_entregados),0);
  const nsfrPctP = nsfrPedP > 0 ? (nsfrEntP/nsfrPedP*100).toFixed(1) : '—';
  const nsfrVar  = nsfrPct !== '—' && nsfrPctP !== '—' ? (n2(nsfrPct)-n2(nsfrPctP)).toFixed(1) : 'N/A';
  const nsfrMeses = nsfrRows.map(r=>`${r.mes}=${parseFloat(r.nsfr_pct).toFixed(1)}%`).join(', ');

  return `Generá un INFORME EJECUTIVO COMPLETO para del Palacio S.A. en español rioplatense.
Período analizado: ${ultimoAnioNps} YTD (${gralRows.length} meses cargados).
Dirigido a: Gerencia / Dirección y uso interno.

## DATOS RMD (Rating de Delivery) — Target: 4.75
Año ${ultimoAnioRmd}: RMD promedio=${rmdAvg} | Año anterior=${rmdPrevAvg} | % Detractores promedio=${detrAvg}% | % Respuestas=${respAvg}%
Detalle mensual ${ultimoAnioRmd}: ${rmdRows.map(r=>`${r.mes}=${r.rmd}(det=${parseFloat(r.pct_detractores).toFixed(1)}%)`).join(' | ')}
Motivos de detracción acumulados ${ultimoAnioRmd}:
${motiResumen}

## DATOS NPS — Target: 70%
Año ${ultimoAnioNps}: NPS General ponderado=${npsAvg} | Clientes totales=${totCli} | Promotores=${totPro} | Detractores=${totDet} | %Detractores=${pctDetNps}
Drivers (NPS ponderado ${ultimoAnioNps} vs año anterior, con volumen y %detractores):
${driverLines}

Subdriver Delivery Experience:
    NPS=${fmtPct1(deliverySummary.nps)} | Año anterior=${fmtPct1(deliveryPrevSummary.nps)} | Variación=${deliveryVar} pp | Clientes=${deliverySummary.clientes} | Promotores=${deliverySummary.promotores} | Detractores=${deliverySummary.detractores} | %Detractores=${fmtPct1(deliverySummary.detrPct)}
Causas operativas asociadas a Delivery:
${deliveryMotivos}

## DATOS NS FR (Nivel de Servicio Facturación Remota HL) — Target: 70%
Año ${ultimoAnioNsfr}: ${nsfrPct}% (${nsfrEnt.toFixed(0)} HL entregados / ${nsfrPed.toFixed(0)} HL pedidos)
Año anterior: ${nsfrPctP}% | Variación: ${nsfrVar} pp
Detalle mensual ${ultimoAnioNsfr}: ${nsfrMeses}

## INSTRUCCIONES DE FORMATO
Contexto de negocio: distribuidora oficial de Cerveceria y Malteria Quilmes en Partido de la Costa, Dolores y Chascomus. El informe debe ayudar a tomar decisiones comerciales y operativas, interpretar RMD/NPS y explicar el impacto de la cantidad de respuestas sin generar fatiga de encuestas.
Cuando uses "pp", escribi "pp (puntos porcentuales)" la primera vez.
RESPONDE SOLO JSON VALIDO. Sin texto extra, sin markdown, sin backticks.
El objeto JSON debe respetar esta estructura exacta:
{
  "resumen_ejecutivo": "3-4 párrafos de análisis general, logros y riesgos principales",
  "rmd": {
    "estado": "VERDE|AMARILLO|ROJO",
    "analisis": "2-3 párrafos de análisis profundo con los números",
    "puntos_criticos": ["item1", "item2", "item3"],
    "foda": {"fortalezas":["..."],"oportunidades":["..."],"debilidades":["..."],"amenazas":["..."]}
  },
  "nps": {
    "estado": "VERDE|AMARILLO|ROJO",
    "analisis": "2-3 párrafos incluyendo análisis por driver, Delivery Experience y causas operativas",
    "puntos_criticos": ["item1", "item2", "item3"],
    "drivers_ranking": [{"driver":"nombre","nps":0,"estado":"VERDE|AMARILLO|ROJO","prioridad":"ALTA|MEDIA|BAJA"}],
    "foda": {"fortalezas":["..."],"oportunidades":["..."],"debilidades":["..."],"amenazas":["..."]}
  },
  "nsfr": {
    "estado": "VERDE|AMARILLO|ROJO",
    "analisis": "2 párrafos",
    "puntos_criticos": ["item1", "item2"],
    "foda": {"fortalezas":["..."],"oportunidades":["..."],"debilidades":["..."],"amenazas":["..."]}
  },
  "plan_accion": [
    {"prioridad":1,"area":"RMD|NPS|NS FR","accion":"descripción concreta","responsable":"área sugerida","plazo":"inmediato|30 días|60 días|90 días","impacto":"ALTO|MEDIO|BAJO"},
    {"prioridad":2,"area":"...","accion":"...","responsable":"...","plazo":"...","impacto":"..."},
    {"prioridad":3,"area":"...","accion":"...","responsable":"...","plazo":"...","impacto":"..."},
    {"prioridad":4,"area":"...","accion":"...","responsable":"...","plazo":"...","impacto":"..."},
    {"prioridad":5,"area":"...","accion":"...","responsable":"...","plazo":"...","impacto":"..."}
  ],
  "conclusion": "1-2 párrafos de cierre con perspectiva y recomendación estratégica"
}`;
}

function estadoPorValor(value, verde, amarillo) {
  if (value >= verde) return 'VERDE';
  if (value >= amarillo) return 'AMARILLO';
  return 'ROJO';
}

function buildLocalInforme(data, reason = '') {
  const rmd = data.rmd || FALLBACK.rmd;
  const motivos = normalizeMotivoRows(data.motivos || FALLBACK.motivos);
  const nps = normalizeNpsRows(data.nps || FALLBACK.nps);
  const nsfr = data.nsfr || FALLBACK.nsfr;

  const ultimoAnioRmd = Math.max(...rmd.map(r => parseInt(r.anio)));
  const rmdRows = rmd.filter(r => parseInt(r.anio) === ultimoAnioRmd);
  const rmdAvg = rmdRows.length ? rmdRows.reduce((s,r)=>s+n2(r.rmd),0) / rmdRows.length : 0;
  const detrAvg = rmdRows.length ? rmdRows.reduce((s,r)=>s+n2(r.pct_detractores),0) / rmdRows.length : 0;

  const aniosNps = [...new Set(nps.map(n=>n.anio))].sort();
  const ultimoAnioNps = aniosNps[aniosNps.length - 1];
  const npsRows = nps.filter(n => n.anio === ultimoAnioNps);
  const npsGeneral = summarizeNps(npsRows.filter(n => n.driver_key === 'GRAL'));
  const delivery = summarizeNps(npsRows.filter(n => n.driver_key === 'DELIVERY'));

  const ultimoAnioNsfr = Math.max(...nsfr.map(n => parseInt(n.anio)));
  const nsfrRows = nsfr.filter(n => parseInt(n.anio) === ultimoAnioNsfr);
  const nsfrPed = nsfrRows.reduce((s,r)=>s+n2(r.hl_pedidos),0);
  const nsfrEnt = nsfrRows.reduce((s,r)=>s+n2(r.hl_entregados),0);
  const nsfrPct = nsfrPed > 0 ? (nsfrEnt / nsfrPed) * 100 : 0;

  const topMotivos = groupDeliveryCauses(
    motivos,
    ultimoAnioNps,
    aniosNps.length > 1 ? aniosNps[aniosNps.length - 2] : null,
    Math.max(...npsRows.map(n => n.mes_num))
  ).slice(0, 3);

  const driversRanking = NPS_DRIVERS_ORDER
    .filter(d => d !== 'GRAL')
    .map(d => {
      const summary = summarizeNps(npsRows.filter(n => n.driver_key === d));
      return {
        driver:NPS_DRIVER_LABELS[d] || d,
        nps:summary.nps === null ? 0 : Number(summary.nps.toFixed(1)),
        estado:estadoPorValor(summary.nps ?? 0, NPS_TARGET, 50),
        prioridad:(summary.nps ?? 0) < 50 || summary.detractores >= 5 ? 'ALTA' : (summary.nps ?? 0) < NPS_TARGET ? 'MEDIA' : 'BAJA',
      };
    })
    .sort((a,b) => a.nps - b.nps)
    .slice(0, 7);

  const fallbackText = reason
    ? `Informe local de respaldo. La IA no estuvo disponible: ${reason}.`
    : 'Informe local de respaldo generado con los datos cargados.';
  const rmdFoda = buildLocalFoda('RMD', '', '');
  const npsFoda = buildLocalFoda('NPS', '', '');
  const nsfrFoda = buildLocalFoda('NS FR', '', '');

  return {
    _notice: fallbackText,
    resumen_ejecutivo: `${fallbackText}\n\nEl tablero muestra RMD ${ultimoAnioRmd} en ${rmdAvg.toFixed(2)}, NPS general ${ultimoAnioNps} en ${fmtPct1(npsGeneral.nps)} y NS FR ${ultimoAnioNsfr} en ${fmtPct1(nsfrPct)}. La lectura prioritaria es sostener el nivel de servicio donde cumple target y atacar los puntos que concentran detractores.\n\nEn NPS, Delivery Experience queda en ${fmtPct1(delivery.nps)} con ${delivery.detractores} detractores. Las causas operativas de mayor peso son ${topMotivos.map(m => `${m.motivo} (${m.actual})`).join(', ') || 'sin motivos cargados'}.`,
    rmd: {
      estado:estadoPorValor(rmdAvg, 4.75, 4.6),
      analisis:`RMD promedio ${ultimoAnioRmd}: ${rmdAvg.toFixed(2)} contra target 4.75. El porcentaje promedio de detractores es ${detrAvg.toFixed(1)}%, por lo que conviene sostener controles de despacho y entrega.\n\nLa prioridad operativa es revisar meses con mayor detraccion y causas repetidas antes de que afecten NPS.`,
      puntos_criticos:[
        `RMD promedio ${rmdAvg.toFixed(2)}`,
        `% detractores promedio ${detrAvg.toFixed(1)}%`,
        'Controlar picking, carga y entrega en meses criticos',
      ],
      foda:rmdFoda,
    },
    nps: {
      estado:estadoPorValor(npsGeneral.nps ?? 0, NPS_TARGET, 55),
      analisis:`NPS general ${ultimoAnioNps}: ${fmtPct1(npsGeneral.nps)} con ${npsGeneral.clientes} respuestas y ${npsGeneral.detractores} detractores.\n\nDelivery Experience registra ${fmtPct1(delivery.nps)}. Si queda por debajo del NPS general, debe tratarse como driver operativo prioritario porque impacta directamente la experiencia de entrega.`,
      puntos_criticos:[
        `NPS general ${fmtPct1(npsGeneral.nps)}`,
        `Delivery Experience ${fmtPct1(delivery.nps)}`,
        topMotivos[0] ? `Causa principal Delivery: ${topMotivos[0].motivo}` : 'Cruzar detractores con motivos operativos',
      ],
      drivers_ranking:driversRanking,
      foda:npsFoda,
    },
    nsfr: {
      estado:estadoPorValor(nsfrPct, 70, 60),
      analisis:`NS FR ${ultimoAnioNsfr}: ${fmtPct1(nsfrPct)} (${nsfrEnt.toFixed(0)} HL entregados sobre ${nsfrPed.toFixed(0)} HL pedidos).\n\nEl indicador debe seguirse junto con RMD y NPS para detectar si faltantes o rechazos terminan afectando la satisfaccion del cliente.`,
      puntos_criticos:[
        `NS FR ${fmtPct1(nsfrPct)}`,
        `${nsfrEnt.toFixed(0)} HL entregados`,
        'Revisar meses bajo target y causas de no entrega',
      ],
      foda:nsfrFoda,
    },
    plan_accion:[
      {prioridad:1, area:'NPS', accion:'Atacar Delivery Experience con seguimiento semanal de detractores y motivos principales', responsable:'Operaciones / Comercial', plazo:'inmediato', impacto:'ALTO'},
      {prioridad:2, area:'RMD', accion:'Reforzar control de cantidad, producto y estado antes de despacho', responsable:'Deposito / Logistica', plazo:'30 días', impacto:'ALTO'},
      {prioridad:3, area:'NPS', accion:'Contactar clientes detractores para cierre de reclamos y recuperacion comercial', responsable:'Ventas', plazo:'30 días', impacto:'MEDIO'},
      {prioridad:4, area:'NS FR', accion:'Revisar pedidos no entregados y faltantes por ruta o zona', responsable:'Facturacion / Distribucion', plazo:'60 días', impacto:'MEDIO'},
      {prioridad:5, area:'RMD', accion:'Publicar tablero mensual de causas y responsables por desvio', responsable:'Gerencia Operativa', plazo:'90 días', impacto:'MEDIO'},
    ],
    conclusion:'La prioridad es convertir los datos de experiencia en una rutina operativa: detectar causa, asignar responsable, cerrar reclamo y medir recuperacion al mes siguiente. Delivery Experience debe mirarse junto con RMD porque ambos explican la satisfaccion real del cliente.',
  };
}

async function requestInformeJson(prompt) {
  let text = await requestAiContent({
    model:AI_MODEL,
    temperature:0,
    max_completion_tokens:5000,
    messages:[
      {
        role:'system',
        content:'Sos analista ejecutivo. Devolves exclusivamente un objeto JSON valido, sin markdown ni texto adicional.'
      },
      {role:'user', content:prompt}
    ]
  });

  try {
    return safeParseJsonObject(text);
  } catch (firstError) {
    text = await requestAiContent({
      model:AI_MODEL,
      temperature:0,
      max_completion_tokens:5000,
      messages:[
        {
          role:'system',
          content:'Converti la entrada a un unico objeto JSON valido. No agregues texto, markdown ni explicaciones.'
        },
        {
          role:'user',
          content:`La respuesta anterior no fue JSON parseable. Reescribila como JSON valido respetando esta estructura: resumen_ejecutivo, rmd, nps, nsfr, plan_accion, conclusion.\n\nRESPUESTA A CORREGIR:\n${text}`
        }
      ]
    });
    try {
      return safeParseJsonObject(text);
    } catch {
      throw firstError;
    }
  }
}

const ESTADO_COLOR = {VERDE: '#27ae60', AMARILLO: '#e67e22', ROJO: '#e74c3c'};
const ESTADO_BG    = {VERDE: '#e8f5e9', AMARILLO: '#fff3e0', ROJO: '#fde8e8'};
const IMPACTO_COLOR = {ALTO: '#e74c3c', MEDIO: '#e67e22', BAJO: '#8B9DC3'};
const PLAZO_COLOR   = {'inmediato':'#e74c3c','30 días':'#e67e22','60 días':'#3B5998','90 días':'#8B9DC3'};

function FodaGrid({foda}) {
  const Q = [
    {key:'fortalezas',    label:'FORTALEZAS',    color:'#27ae60', bg:'#e8f5e9'},
    {key:'oportunidades', label:'OPORTUNIDADES',  color:'#3B5998', bg:'#e3eaf5'},
    {key:'debilidades',   label:'DEBILIDADES',    color:'#e67e22', bg:'#fff3e0'},
    {key:'amenazas',      label:'AMENAZAS',       color:'#e74c3c', bg:'#fde8e8'},
  ];
  return (
    <div style={{display:'grid', gridTemplateColumns:'repeat(auto-fit, minmax(220px, 1fr))', gap:8, marginTop:12}}>
      {Q.map(q => (
        <div key={q.key} style={{background:q.bg, border:`1px solid ${q.color}20`, borderTop:`2px solid ${q.color}`, borderRadius:6, padding:'10px 12px'}}>
          <div style={{fontSize:9, color:q.color, letterSpacing:2, fontFamily:'monospace', marginBottom:8}}>{q.label}</div>
          <ul style={{margin:0, padding:'0 0 0 14px'}}>
            {(foda[q.key]||[]).map((item,i) => (
              <li key={i} style={{fontSize:11, color:C.text1, lineHeight:1.7, marginBottom:2}}>{item}</li>
            ))}
          </ul>
        </div>
      ))}
    </div>
  );
}

function SeccionMetrica({titulo, icono, data, color}) {
  if (!data) return null;
  const bc = ESTADO_COLOR[data.estado] || C.text2;
  const bb = ESTADO_BG[data.estado]   || C.bg1;
  return (
    <div style={{background:C.bg1, border:`1px solid ${C.border}`, borderLeft:`4px solid ${bc}`, borderRadius:8, padding:20, marginBottom:16}}>
      <div style={{display:'flex', alignItems:'center', gap:10, marginBottom:14}}>
        <div style={{fontSize:16}}>{icono}</div>
        <div style={{fontSize:14, fontWeight:700, color:C.text0, letterSpacing:1}}>{titulo}</div>
        <div style={{marginLeft:'auto', background:bb, border:`1px solid ${bc}40`, borderRadius:20, padding:'3px 12px', fontSize:10, color:bc, fontFamily:'monospace', fontWeight:600}}>
          {data.estado}
        </div>
      </div>
      <div style={{fontSize:12, color:C.text1, lineHeight:1.8, whiteSpace:'pre-wrap', marginBottom:14}}>{data.analisis}</div>
      {data.puntos_criticos && data.puntos_criticos.length > 0 && (
        <div style={{marginBottom:14}}>
          <div style={{fontSize:9, color:C.text2, letterSpacing:1.5, textTransform:'uppercase', marginBottom:8}}>Puntos Críticos</div>
          {data.puntos_criticos.map((p,i) => (
            <div key={i} style={{display:'flex', gap:8, alignItems:'flex-start', marginBottom:6}}>
              <div style={{color:bc, fontSize:10, marginTop:2, flexShrink:0}}>▸</div>
              <div style={{fontSize:11, color:C.text0, lineHeight:1.6}}>{p}</div>
            </div>
          ))}
        </div>
      )}
      {data.drivers_ranking && (
        <div style={{marginBottom:14}}>
          <div style={{fontSize:9, color:C.text2, letterSpacing:1.5, textTransform:'uppercase', marginBottom:8}}>Ranking de Drivers</div>
          <div style={{display:'flex', flexWrap:'wrap', gap:6}}>
            {data.drivers_ranking.map((d,i) => {
              const dc = ESTADO_COLOR[d.estado] || C.text2;
              return (
                <div key={i} style={{background:ESTADO_BG[d.estado]||C.bg2, border:`1px solid ${dc}30`, borderRadius:6, padding:'6px 10px', fontSize:10}}>
                  <span style={{color:C.text2, marginRight:4}}>#{i+1}</span>
                  <span style={{color:C.text0}}>{d.driver}</span>
                  <span style={{color:dc, marginLeft:6, fontFamily:'monospace'}}>{d.nps}%</span>
                  {d.prioridad === 'ALTA' && <span style={{color:C.red, marginLeft:6, fontSize:9}}>⚠</span>}
                </div>
              );
            })}
          </div>
        </div>
      )}
      {data.foda && <FodaGrid foda={data.foda} />}
    </div>
  );
}

function TabInforme({data}) {
  const [informe, setInforme] = useState(null);
  const [loading, setLoading] = useState(false);
  const [generado, setGenerado] = useState(false);
  const [progreso, setProgreso] = useState('');
  const reportRef = useRef(null);

  const generar = async () => {
    setLoading(true);
    setInforme(null);
    setProgreso('Analizando datos...');
    try {
      const prompt = buildInformeContexto(data);
      setProgreso('Generando análisis con IA (puede demorar ~20 segundos)...');
      const resultado = await requestInformeJson(prompt);
      if (!resultado) throw new Error('La IA no devolvió un informe válido');
      setInforme(resultado);
      setGenerado(true);
    } catch(e) {
      console.error('Error al generar informe:', e);
      setInforme({
        _error: `❌ Error: ${e.message}\n\nGenerando informe de respaldo...`,
        ...buildLocalInforme(data, e.message)
      });
      setGenerado(true);
    } finally {
      setLoading(false);
      setProgreso('');
    }
  };

  const imprimir = () => {
    const style = document.createElement('style');
    style.setAttribute('data-print-informe', 'true');
    style.textContent = `
      @page { size: A4; margin: 12mm; }
      @media print {
        html, body {
          background: #ffffff !important;
          color: #000000 !important;
          font-family: Arial, sans-serif !important;
          margin: 0 !important;
          padding: 0 !important;
        }
        body * { visibility: hidden !important; }
        #informe-print, #informe-print * { visibility: visible !important; }
        #informe-print {
          position: absolute !important;
          left: 0 !important;
          top: 0 !important;
          width: 100% !important;
          margin: 0 !important;
          padding: 0 !important;
          background: #ffffff !important;
        }
        #informe-print * {
          box-shadow: none !important;
          -webkit-print-color-adjust: exact !important;
          print-color-adjust: exact !important;
        }
        .no-print { display: none !important; }
      }
    `;
    document.head.appendChild(style);
    const cleanup = () => {
      document.head.querySelectorAll('style[data-print-informe="true"]').forEach(node => node.remove());
      window.removeEventListener('afterprint', cleanup);
    };
    window.addEventListener('afterprint', cleanup);
    window.print();
    setTimeout(cleanup, 60000);
  };

  const ahora = new Date().toLocaleDateString('es-AR', {day:'2-digit', month:'long', year:'numeric'});

  return (
    <div>
      {/* Barra de acciones */}
      <div className="no-print" style={{display:'flex', alignItems:'center', justifyContent:'space-between', marginBottom:20, flexWrap:'wrap', gap:10}}>
        <div>
          <div style={{fontSize:13, color:C.text0, fontWeight:600}}>Informe Ejecutivo Completo</div>
          <div style={{fontSize:11, color:C.text2, marginTop:3}}>Análisis por métrica · FODA · Plan de acción · Listo para imprimir · {PP_NOTE}</div>
        </div>
        <div style={{display:'flex', gap:10}}>
          {generado && (
            <button onClick={imprimir} style={{
              background:C.bg1, border:`1px solid ${C.border}`, borderRadius:8,
              padding:'9px 18px', color:C.blue, fontSize:11, fontFamily:'monospace', cursor:'pointer',
              boxShadow:'0 1px 3px rgba(59,89,152,0.08)',
            }}>
              🖨️ Imprimir / PDF
            </button>
          )}
          <button onClick={generar} disabled={loading} style={{
            background: loading ? C.border2 : C.blue, border:'none', borderRadius:8,
            padding:'10px 22px', color:'#fff', fontSize:12, fontFamily:'monospace',
            cursor: loading ? 'not-allowed':'pointer', fontWeight:700, letterSpacing:0.5,
          }}>
            {loading ? progreso || 'Generando...' : generado ? '↺ Regenerar Informe' : '⚡ Generar Informe con IA'}
          </button>
        </div>
      </div>

      {!generado && !loading && (
        <div style={{background:C.bg1, border:`1px solid ${C.border}`, borderRadius:10, padding:40, textAlign:'center', boxShadow:'0 1px 4px rgba(59,89,152,0.08)'}}>
          <div style={{fontSize:36, marginBottom:16}}>📊</div>
          <div style={{fontSize:15, color:C.text0, marginBottom:10, fontWeight:600}}>Informe Ejecutivo con IA</div>
          <div style={{fontSize:12, color:C.text1, lineHeight:1.9, maxWidth:480, margin:'0 auto'}}>
            La IA analiza todos los datos disponibles — RMD, NPS por driver con volumen ponderado, NS FR —
            y genera un informe completo con análisis, FODA por métrica y plan de acción priorizado,
            listo para presentar a gerencia.
          </div>
        </div>
      )}

      {loading && (
        <div style={{background:C.bg1, border:`1px solid ${C.border}`, borderRadius:8, padding:40, textAlign:'center'}}>
          <div style={{fontSize:12, color:C.blue, fontFamily:'monospace', marginBottom:12}}>{progreso}</div>
          <div style={{display:'flex', justifyContent:'center', gap:6}}>
            {[0,1,2].map(i => (
              <div key={i} style={{width:8, height:8, borderRadius:'50%', background:C.blue,
                animation:'pulse 1.2s ease-in-out infinite', animationDelay:`${i*0.2}s`}} />
            ))}
          </div>
        </div>
      )}

      {informe?._error && (
        <div style={{background:'#fde8e8', border:`2px solid ${C.red}`, borderRadius:8, padding:16, marginBottom:16, whiteSpace:'pre-wrap', fontFamily:'monospace'}}>
          <div style={{color:C.red, fontSize:12, lineHeight:1.8}}>{informe._error}</div>
        </div>
      )}

      {informe && !informe._error && (
        <div id="informe-print" ref={reportRef}>
          {/* Encabezado del informe */}
          <div style={{background:'linear-gradient(135deg, #3B5998 0%, #8B9DC3 100%)', borderRadius:10, padding:'24px 28px', marginBottom:16, boxShadow:'0 2px 10px rgba(59,89,152,0.25)'}}>
            <div style={{display:'flex', justifyContent:'space-between', alignItems:'flex-start'}}>
              <div>
                <div style={{fontSize:9, color:'rgba(255,255,255,0.65)', letterSpacing:3, textTransform:'uppercase', marginBottom:6, fontFamily:'monospace'}}>del Palacio S.A.</div>
                <div style={{fontSize:22, fontWeight:700, color:'#ffffff', letterSpacing:1, marginBottom:4}}>INFORME EJECUTIVO OPERATIVO</div>
                <div style={{fontSize:11, color:'rgba(255,255,255,0.65)'}}>RMD · NPS · Nivel de Servicio Facturación Remota · {PP_NOTE}</div>
              </div>
              <div style={{textAlign:'right'}}>
                <div style={{fontSize:10, color:'rgba(255,255,255,0.55)'}}>Generado el</div>
                <div style={{fontSize:13, color:'#ffffff', marginTop:2}}>{ahora}</div>
                <div style={{fontSize:10, color:'rgba(255,255,255,0.5)', marginTop:6}}>Confidencial — Uso interno</div>
              </div>
            </div>
          </div>

          {informe._notice && (
            <div style={{background:'#fff3e0', border:`1px solid ${C.amber}35`, borderLeft:`4px solid ${C.amber}`, borderRadius:8, padding:'10px 14px', color:C.text0, fontSize:11, marginBottom:16}}>
              {informe._notice}
            </div>
          )}

          {/* Semáforo de KPIs */}
          <div style={{display:'flex', gap:10, marginBottom:16, flexWrap:'wrap'}}>
            {[
              {label:'RMD', estado:informe.rmd?.estado},
              {label:'NPS', estado:informe.nps?.estado},
              {label:'NS FR', estado:informe.nsfr?.estado},
            ].map(k => {
              const kc = ESTADO_COLOR[k.estado]||C.text2;
              return (
                <div key={k.label} style={{flex:1, minWidth:120, background:ESTADO_BG[k.estado]||C.bg1,
                  border:`1px solid ${kc}50`, borderLeft:`4px solid ${kc}`, borderRadius:10, padding:'12px 16px', textAlign:'center', boxShadow:'0 1px 3px rgba(59,89,152,0.08)'}}>
                  <div style={{fontSize:10, color:C.text2, letterSpacing:1.5, textTransform:'uppercase', marginBottom:8, fontWeight:600}}>{k.label}</div>
                  <div style={{fontSize:14, fontWeight:700, color:kc}}>{k.estado}</div>
                </div>
              );
            })}
          </div>

          {/* Resumen Ejecutivo */}
          <div style={{background:C.bg1, border:`1px solid ${C.border2}`, borderLeft:`4px solid ${C.blue}`, borderRadius:8, padding:20, marginBottom:16}}>
            <div style={{fontSize:9, color:C.blue, letterSpacing:2, textTransform:'uppercase', fontFamily:'monospace', marginBottom:12}}>RESUMEN EJECUTIVO</div>
            <div style={{fontSize:12, color:C.text1, lineHeight:1.9, whiteSpace:'pre-wrap'}}>{informe.resumen_ejecutivo}</div>
          </div>

          {/* Secciones por métrica */}
          <SeccionMetrica titulo="RMD — Rating de Delivery" icono="🚚" data={informe.rmd} />
          <SeccionMetrica titulo="NPS — Net Promoter Score" icono="⭐" data={informe.nps} />
          <SeccionMetrica titulo="NS FR — Nivel de Servicio Facturación Remota" icono="📦" data={informe.nsfr} />

          {/* Plan de Acción */}
          {informe.plan_accion && (
            <div style={{background:C.bg1, border:`1px solid ${C.border}`, borderRadius:8, padding:20, marginBottom:16}}>
              <div style={{fontSize:9, color:C.amber, letterSpacing:2, textTransform:'uppercase', fontFamily:'monospace', marginBottom:16}}>PLAN DE ACCIÓN PRIORIZADO</div>
              <div style={{display:'flex', flexDirection:'column', gap:8}}>
                {informe.plan_accion.map((item,i) => {
                  const ic = IMPACTO_COLOR[item.impacto] || C.text2;
                  const pc = PLAZO_COLOR[item.plazo]   || C.text2;
                  return (
                    <div key={i} style={{background:C.bg2, border:`1px solid ${C.border}`, borderRadius:6, padding:'12px 16px',
                      display:'flex', gap:14, alignItems:'flex-start'}}>
                      <div style={{width:28, height:28, borderRadius:'50%', background:`${ic}20`,
                        border:`1.5px solid ${ic}`, display:'flex', alignItems:'center', justifyContent:'center',
                        fontSize:12, fontWeight:700, color:ic, flexShrink:0}}>
                        {item.prioridad}
                      </div>
                      <div style={{flex:1}}>
                        <div style={{display:'flex', gap:8, flexWrap:'wrap', marginBottom:6}}>
                          <span style={{background:`${ic}15`, border:`1px solid ${ic}30`, borderRadius:4,
                            padding:'2px 8px', fontSize:9, color:ic, fontFamily:'monospace'}}>{item.area}</span>
                          <span style={{background:`${pc}15`, border:`1px solid ${pc}30`, borderRadius:4,
                            padding:'2px 8px', fontSize:9, color:pc, fontFamily:'monospace'}}>{item.plazo}</span>
                          <span style={{background:'transparent', border:`1px solid ${C.border2}`, borderRadius:4,
                            padding:'2px 8px', fontSize:9, color:C.text2, fontFamily:'monospace'}}>Resp: {item.responsable}</span>
                          <span style={{marginLeft:'auto', fontSize:9, color:ic, fontFamily:'monospace', fontWeight:600}}>Impacto {item.impacto}</span>
                        </div>
                        <div style={{fontSize:12, color:C.text0, lineHeight:1.6}}>{item.accion}</div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* Conclusión */}
          {informe.conclusion && (
            <div style={{background:'linear-gradient(135deg, #e3eaf5 0%, #DFE3EE 100%)', border:`1px solid ${C.border}`, borderLeft:`4px solid ${C.blue}`, borderRadius:10, padding:20, boxShadow:'0 1px 4px rgba(59,89,152,0.08)'}}>
              <div style={{fontSize:9, color:C.blue, letterSpacing:2, textTransform:'uppercase', fontFamily:'monospace', marginBottom:12, fontWeight:700}}>CONCLUSIÓN ESTRATÉGICA</div>
              <div style={{fontSize:12, color:C.text0, lineHeight:1.9, whiteSpace:'pre-wrap'}}>{informe.conclusion}</div>
            </div>
          )}
        </div>
      )}

      <style>{`
        @keyframes pulse { 0%,100%{opacity:.3} 50%{opacity:1} }
      `}</style>
    </div>
  );
}


const SUGGESTED = [
  "¿Cuál es el principal problema que tengo que resolver ahora?",
  "Comparame el RMD de los últimos dos años",
  "¿Por qué subió tanto 'cantidad equivocada'?",
  "¿Cuáles drivers del NPS están en riesgo?",
  "Haceme un resumen ejecutivo para presentar",
];

function TabIA({data, sistema}) {
  const [msgs, setMsgs] = useState([
    {role:'assistant', content:'¡Hola! Tengo los datos en vivo cargados. ¿Qué querés analizar?'}
  ]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const endRef = useRef(null);

  useEffect(() => { endRef.current?.scrollIntoView({behavior:'smooth'}); }, [msgs]);

  const send = async (text) => {
    const msg = text || input.trim();
    if (!msg || loading) return;
    setInput('');
    const next = [...msgs, {role:'user', content:msg}];
    setMsgs(next);
    setLoading(true);
    try {
      const res = await fetch('/api/ai', {
        method:'POST', headers:{'Content-Type':'application/json'},
        body: JSON.stringify({
          model:AI_MODEL, max_completion_tokens:4000,
          messages: [{role:'system', content:sistema}, ...next.map(m => ({role:m.role, content:m.content}))]
        })
      });
      const d = await res.json();
      const reply = d.choices?.[0]?.message?.content || 'Sin respuesta.';
      setMsgs(prev => [...prev, {role:'assistant', content:reply}]);
    } catch(e) {
      setMsgs(prev => [...prev, {role:'assistant', content:'Error al conectar.'}]);
    } finally { setLoading(false); }
  };

  return (
    <div style={{display:'flex', flexDirection:'column', gap:12}}>
      <div style={{fontSize:10, color:C.text2, letterSpacing:1.5, fontFamily:'monospace'}}>CONSULTAS RÁPIDAS</div>
      <div style={{display:'flex', gap:8, flexWrap:'wrap'}}>
        {SUGGESTED.map((s,i) => (
          <button key={i} onClick={() => send(s)} style={{
            background:C.bg1, border:`1px solid ${C.border}`, borderRadius:8,
            padding:'7px 14px', color:C.blue, fontSize:11, fontFamily:'monospace',
            cursor:'pointer', lineHeight:1.4, transition:'all .15s',
            boxShadow:'0 1px 3px rgba(59,89,152,0.08)',
          }}
          onMouseOver={e => {e.currentTarget.style.borderColor=C.blue; e.currentTarget.style.background='#e3eaf5';}}
          onMouseOut={e => {e.currentTarget.style.borderColor=C.border; e.currentTarget.style.background=C.bg1;}}>
            {s}
          </button>
        ))}
      </div>
      <div style={{background:C.bg1, border:`1px solid ${C.border}`, borderRadius:8, display:'flex', flexDirection:'column', height:'50vh', overflow:'hidden'}}>
        <div style={{flex:1, overflowY:'auto', padding:16, display:'flex', flexDirection:'column', gap:10}}>
          {msgs.map((m,i) => (
            <div key={i} style={{
              alignSelf: m.role==='user' ? 'flex-end' : 'flex-start', maxWidth:'82%',
              background: m.role==='user' ? '#3B5998' : C.bg1,
              border:`1px solid ${m.role==='user' ? 'transparent' : C.border}`,
              borderRadius: m.role==='user' ? '12px 12px 4px 12px' : '12px 12px 12px 4px',
              padding:'10px 14px', fontSize:12, lineHeight:1.65,
              color: m.role==='user' ? '#ffffff' : C.text0,
              whiteSpace:'pre-wrap', fontFamily:'monospace',
              boxShadow: m.role==='user' ? '0 2px 6px rgba(59,89,152,0.25)' : '0 1px 3px rgba(59,89,152,0.08)',
            }}>
              {m.role==='assistant' && <span style={{fontSize:9, color:C.blue, marginRight:6, letterSpacing:1, fontWeight:700}}>IA</span>}
              {m.content}
            </div>
          ))}
          {loading && <div style={{color:C.blue, fontSize:11, fontFamily:'monospace'}}>Analizando...</div>}
          <div ref={endRef} />
        </div>
        <div style={{padding:'10px 14px', borderTop:`1px solid ${C.border}`, display:'flex', gap:10}}>
          <input value={input} onChange={e => setInput(e.target.value)}
            onKeyDown={e => e.key==='Enter' && !e.shiftKey && send()}
            placeholder="Preguntá sobre RMD, NPS o NS FR..."
            style={{flex:1, background:C.bg1, border:`1px solid ${C.border}`, borderRadius:8,
              padding:'9px 14px', color:C.text0, fontSize:12, fontFamily:'monospace', outline:'none',
              boxShadow:'inset 0 1px 3px rgba(59,89,152,0.06)'}} />
          <button onClick={() => send()} disabled={loading} style={{
            background: loading ? C.border2 : C.blue, border:'none', borderRadius:8,
            padding:'8px 20px', color:'#fff', cursor: loading ? 'not-allowed':'pointer',
            fontSize:12, fontFamily:'monospace', fontWeight:600,
          }}>
            Enviar →
          </button>
        </div>
      </div>
    </div>
  );
}

// =========================================================
// APP PRINCIPAL
// =========================================================
export default function App() {
  const compact = useCompactLayout();
  const [tab, setTab] = useState('rmd');
  const [data, setData] = useState({});
  const [loading, setLoading] = useState(true);
  const [fromSheets, setFromSheets] = useState(false);
  const [sistema, setSistema] = useState(buildSistema(FALLBACK));

  useEffect(() => {
    if (!PUBLISHED_BASE || PUBLISHED_BASE === '') {
      setData(FALLBACK);
      setSistema(buildSistema(FALLBACK));
      setLoading(false);
      return;
    }
    setLoading(true);
    Promise.all([
      fetchSheet(SHEET_URLS.rmd),
      fetchSheet(SHEET_URLS.motivos),
      fetchSheet(SHEET_URLS.nps),
      fetchSheet(SHEET_URLS.nsfr),
    ]).then(([rmd, motivos, nps, nsfr]) => {
      const valid = {
        rmd: isValidSheet('rmd', rmd),
        motivos: isValidSheet('motivos', motivos),
        nps: isValidSheet('nps', nps),
        nsfr: isValidSheet('nsfr', nsfr),
      };
      const loaded = {
        rmd:     valid.rmd     ? rmd     : FALLBACK.rmd,
        motivos: valid.motivos ? motivos : FALLBACK.motivos,
        nps:     valid.nps     ? nps     : FALLBACK.nps,
        nsfr:    valid.nsfr    ? nsfr    : FALLBACK.nsfr,
      };
      const ok = Object.values(valid).every(Boolean);
      if (!ok) console.warn('Una o mas hojas no tienen las columnas esperadas. Se usan datos locales para esas hojas.', valid);
      setData(loaded);
      setFromSheets(ok);
      setSistema(buildSistema(loaded));
    }).finally(() => setLoading(false));
  }, []);

  // KPIs dinámicos
  const rmd = data.rmd || FALLBACK.rmd;
  const nps = normalizeNpsRows(data.nps || FALLBACK.nps);
  const nsfr = data.nsfr || FALLBACK.nsfr;

  const ultimoAnioRmd = Math.max(...rmd.map(r => parseInt(r.anio)));
  const rmdUltimo = rmd.filter(r => parseInt(r.anio) === ultimoAnioRmd);
  const rmdYTD = rmdUltimo.length ? (rmdUltimo.reduce((s,r) => s + n2(r.rmd), 0) / rmdUltimo.length).toFixed(2) : '—';
  const detrYTD = rmdUltimo.length ? (rmdUltimo.reduce((s,r) => s + n2(r.pct_detractores), 0) / rmdUltimo.length).toFixed(2) : '—';

  const ultimoAnioNps = Math.max(...nps.map(n => n.anio));
  const npsUltimo = nps.filter(n => n.anio === ultimoAnioNps && n.driver_key === 'GRAL');
  const npsResumen = summarizeNps(npsUltimo);
  const npsYTD = npsResumen.nps !== null ? npsResumen.nps.toFixed(1) : '—';

  const ultimoAnioNsfr = Math.max(...nsfr.map(n => parseInt(n.anio)));
  const nsfrUltimo = nsfr.filter(n => parseInt(n.anio) === ultimoAnioNsfr);
  const nsfrYTD = nsfrUltimo.length ? (nsfrUltimo.reduce((s,r) => s + n2(r.nsfr_pct), 0) / nsfrUltimo.length).toFixed(1) : '—';

  const TABS = [
    {id:'rmd', label:'RMD'},
    {id:'nps', label:'NPS'},
    {id:'nsfr', label:'NS FR'},
    {id:'ia', label:'⚡ Análisis IA'},
    {id:'informe', label:'📊 Informe Ejecutivo'},
  ];

  const kpis = [
    {label:`RMD ${ultimoAnioRmd} YTD`, val:rmdYTD, sub:'Target 4.75', color: n2(rmdYTD) >= 4.75 ? C.green : C.red},
    {label:'% Detr. RMD', val:`${detrYTD}%`, sub:'Meta <5%', color: n2(detrYTD) < 3 ? C.green : n2(detrYTD) < 5 ? C.amber : C.red},
    {label:`NPS Gral ${ultimoAnioNps}`, val:`${npsYTD}%`, sub:'Target 70%', color: n2(npsYTD) >= 70 ? C.green : n2(npsYTD) >= 55 ? C.amber : C.red},
    {label:`NS FR ${ultimoAnioNsfr}`, val:`${nsfrYTD}%`, sub:'Target 70%', color: n2(nsfrYTD) >= 70 ? C.green : n2(nsfrYTD) >= 60 ? C.amber : C.red},
  ];

  return (
    <div style={{background:C.bg0, minHeight:'100vh', color:C.text0, fontFamily:"'IBM Plex Mono','Courier New',monospace"}}>
      <div style={{background:'linear-gradient(90deg, #3B5998 0%, #4a6aaa 100%)', padding:compact ? '14px 16px' : '16px 28px', display:'flex', flexDirection:compact ? 'column' : 'row', alignItems:compact ? 'flex-start' : 'center', justifyContent:'space-between', gap:compact ? 10 : 0, boxShadow:'0 2px 8px rgba(59,89,152,0.25)'}}>
        <div>
          <div style={{fontSize:9, color:'rgba(255,255,255,0.65)', letterSpacing:3, textTransform:'uppercase', fontFamily:'monospace'}}>del Palacio S.A.</div>
          <div style={{fontSize:compact ? 17 : 20, fontWeight:700, color:'#ffffff', letterSpacing:1.2, marginTop:3, fontFamily:'monospace'}}>DASHBOARD OPERATIVO</div>
        </div>
        <div style={{textAlign:compact ? 'left' : 'right', fontSize:10}}>
          <div style={{color: fromSheets ? '#4ade80' : '#fbbf24', marginBottom:4, fontFamily:'monospace'}}>
            {loading ? '○ Cargando...' : fromSheets ? '● Google Sheets en vivo' : '● Datos locales'}
          </div>
          <div style={{color:'rgba(255,255,255,0.5)', letterSpacing:1, fontFamily:'monospace', fontSize:9}}>RMD · NPS · NS FR</div>
        </div>
      </div>

      {!loading && (
        <div style={{padding:compact ? '12px 12px' : '14px 24px'}}>
          <div style={{display:'grid', gridTemplateColumns:`repeat(auto-fit, minmax(${compact ? 145 : 170}px, 1fr))`, gap:10}}>
            {kpis.map(k => (
              <div key={k.label} style={{background:C.bg1, border:`1px solid ${C.border}`, borderLeft:`4px solid ${k.color}`, borderRadius:10, padding:compact ? '12px 14px' : '14px 18px', boxShadow:'0 1px 4px rgba(59,89,152,0.08)'}}>
                <div style={{fontSize:10, color:C.text2, textTransform:'uppercase', letterSpacing:1.5, marginBottom:6, fontWeight:600}}>{k.label}</div>
                <div style={{fontSize:compact ? 22 : 26, fontWeight:700, color:k.color, fontFamily:'monospace'}}>{k.val}</div>
                <div style={{fontSize:10, color:C.text1, marginTop:6}}>{k.sub}</div>
              </div>
            ))}
          </div>
          <div style={{fontSize:10, color:C.text2, marginTop:8, fontFamily:'monospace'}}>{PP_NOTE}</div>
        </div>
      )}

      <div style={{padding:compact ? '0 8px' : '0 24px', borderBottom:`2px solid ${C.border}`, display:'flex', gap:2, background:C.bg1, overflowX:'auto', WebkitOverflowScrolling:'touch'}}>
        {TABS.map(t => (
          <button key={t.id} onClick={() => setTab(t.id)} style={{
            background: 'transparent', border:'none',
            borderBottom: tab===t.id ? `2px solid ${C.blue}` : '2px solid transparent',
            color: tab===t.id ? C.blue : C.text2,
            padding:compact ? '11px 14px' : '11px 22px', cursor:'pointer', fontFamily:'monospace', fontSize:compact ? 11 : 12, letterSpacing:0.5, transition:'all .15s',
            fontWeight: tab===t.id ? 700 : 400, marginBottom:'-2px',
            whiteSpace:'nowrap', flexShrink:0,
          }}>{t.label}</button>
        ))}
      </div>

      <div style={{padding:compact ? '14px 12px' : '20px 28px'}}>
        {loading ? (
          <div style={{textAlign:'center', padding:60, color:C.text2, fontSize:13}}>Cargando datos desde Google Sheets...</div>
        ) : (
          <>
            {tab==='rmd'  && <TabRMD  data={data} />}
            {tab==='nps'  && <TabNPSMejorado data={data} />}
            {tab==='nsfr' && <TabNSFR data={data} />}
            {tab==='ia'   && <TabIA   data={data} sistema={sistema} />}
            {tab==='informe' && <TabInforme data={data} />}
          </>
        )}
      </div>
    </div>
  );
}
