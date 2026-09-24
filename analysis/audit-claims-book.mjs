import { SHEET_IMPORT_SOURCES } from '../lib/claims-config.mjs';
import { readCsvRows, normalizeRows } from '../lib/claim-normalizers.mjs';
import { writeFile } from 'node:fs/promises';

const count = (rows, key) => rows.reduce((a,r) => {const v=String(r[key]??'');a[v]=(a[v]||0)+1;return a;},{});
const profiles = await Promise.all(SHEET_IMPORT_SOURCES.map(async s => {
  try {
    const response=await fetch(s.url,{signal:AbortSignal.timeout(60000)});
    if(!response.ok)throw Error(`HTTP ${response.status}`);
    const text=await response.text();
    if(text.trim().startsWith('<'))throw Error('HTML instead of CSV');
    const rows=readCsvRows(text), claims=normalizeRows(s.source,rows);
    const eligible=claims.filter(c=>c.requires_management);
    const groups=new Map();
    for(const c of eligible){const a=groups.get(c.dedupe_key)||[];a.push(c);groups.set(c.dedupe_key,a);}
    const repeated=[...groups.values()].filter(a=>a.length>1);
    const dates=claims.map(c=>c.opened_at).filter(Boolean).sort();
    const rawUnique=new Set(rows.map(r=>JSON.stringify(r)));
    const p={sheet:s.label,url:s.url,rows:rows.length,columns:Object.keys(rows[0]||{}),normalized:claims.length,
      exactDuplicateRows:rows.length-rawUnique.size,eligible:eligible.length,uniqueEligible:groups.size,
      repeatedGroups:repeated.length,duplicateEligibleRows:eligible.length-groups.size,
      groupsWithDifferentScores:repeated.filter(a=>new Set(a.map(c=>c.score)).size>1).length,
      groupsWithDifferentDrivers:repeated.filter(a=>new Set(a.map(c=>c.driver_primary+'|'+c.driver_secondary)).size>1).length,
      groupsWithDifferentRawRows:repeated.filter(a=>new Set(a.map(c=>JSON.stringify(c.raw))).size>1).length,
      dateRange:[dates[0],dates.at(-1)],missingDate:claims.filter(c=>!c.opened_at).length,
      missingCustomer:claims.filter(c=>!c.customer_id).length,missingTicket:claims.filter(c=>!c.external_id).length,
      status:count(claims,'status'),eligibleStatus:count(eligible,'status'),sla:count(eligible,'internal_sla_status'),
      uniqueEligibleSla:count([...groups.values()].map(a=>a[0]),'internal_sla_status'),
      answered:claims.filter(c=>c.answered_at).length,newWithAnswerDate:claims.filter(c=>c.status==='Nuevo'&&c.answered_at).length,
      closedWithoutClosedDate:claims.filter(c=>c.status==='Cerrado'&&!c.closed_at).length,
      answerBeforeOpened:claims.filter(c=>c.answered_at&&c.opened_at&&c.answered_at<c.opened_at).length,
      excelErrors:rows.reduce((n,r)=>n+Object.values(r).filter(v=>/^#(REF!|N\/A|VALUE!|DIV\/0!|NAME\?|NUM!|ERROR!)/.test(String(v))).length,0),
      rawStates:count(rows,s.source.includes('RMD')?'STATUS':'ESTADO')};
    console.log(JSON.stringify(p));return p;
  }catch(e){const p={sheet:s.label,error:e.message};console.log(JSON.stringify(p));return p;}
}));
await writeFile(new URL('./claims-book-profile.json',import.meta.url),JSON.stringify({checkedAt:new Date().toISOString(),scope:'Published CSV values; no database writes or formula inspection',profiles},null,2));
