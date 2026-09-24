import assert from 'node:assert/strict';
import {ensureSchema,withClient,getPool} from '../lib/db.mjs';
import {mutateCatalog} from '../lib/claim-catalogs.mjs';
import {listClaims} from '../lib/claims-service.mjs';
try {
 await ensureSchema();
 try {await withClient(async client=>{
   for(const kind of ['statuses','owners']){
     const name=`test-${kind}-${Date.now()}`;
     const table=kind==='statuses'?'claim_statuses':'claim_owners';
     await mutateCatalog(kind,null,'POST',{name},client);
     const {id}=(await client.query(`SELECT id FROM ${table} WHERE name=$1`,[name])).rows[0];
     await mutateCatalog(kind,id,'PATCH',{name:name+'-renamed',active:false},client);
     const item=(await client.query(`SELECT * FROM ${table} WHERE id=$1`,[id])).rows[0];
     assert.equal(item.active,false);assert.equal(item.name,name+'-renamed');
     await mutateCatalog(kind,id,'DELETE',{},client);
     assert.equal((await client.query(`SELECT id FROM ${table} WHERE id=$1`,[id])).rowCount,0);
   }
   throw Error('ROLLBACK_TEST');
 });}catch(e){if(e.message!=='ROLLBACK_TEST')throw e;}
 const first=await listClaims({source:'RMD',score:'1'});
 assert.ok(first.every(c=>c.source==='RMD'&&Number(c.score)===1));
 assert.ok(first.length<=50);
 await assert.rejects(()=>listClaims({from:'2026-09-30',to:'2026-09-01'}));
 console.log('PASS: CRUD de catalogos, filtros y paginacion; cambios de prueba revertidos');
}finally{await getPool().end();}
