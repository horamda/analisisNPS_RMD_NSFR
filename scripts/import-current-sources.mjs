import fs from "node:fs/promises";
import { ensureSchema, getPool } from "../lib/db.mjs";
import { SHEET_IMPORT_SOURCES } from "../lib/claims-config.mjs";
import { readCsvRows, readWorkbookRows } from "../lib/claim-normalizers.mjs";
import { importSource } from "../lib/source-importer.mjs";
try {
  await ensureSchema();
  for(const s of SHEET_IMPORT_SOURCES){
    const r=await fetch(s.url,{signal:AbortSignal.timeout(120000)});
    if(!r.ok)throw new Error(`${s.label}: HTTP ${r.status}`);
    console.log(JSON.stringify({sheet:s.label,...await importSource({source:s.source,fileName:s.url,rows:readCsvRows(await r.text())})}));
  }
  for(const [source,name] of [["NPS","NPS (2).xlsx"],["RMD","RMDZ.xlsx"],["BEES_CARE","beescare.xlsx"]]){
    const buffer=await fs.readFile(`C:/Users/horac/Downloads/${name}`);
    console.log(JSON.stringify({file:name,...await importSource({source,fileName:name,rows:readWorkbookRows(buffer.toString("base64"))})}));
  }
}finally{await getPool().end();}
