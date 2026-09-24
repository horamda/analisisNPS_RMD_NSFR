import { query, withClient } from "./db.mjs";

export async function catalogs() {
  return {statuses:(await query("SELECT * FROM claim_statuses ORDER BY id")).rows,
    owners:(await query("SELECT * FROM claim_owners ORDER BY name")).rows,
    sla:(await query("SELECT DISTINCT internal_sla_status AS value FROM claims WHERE coalesce(internal_sla_status,'')<>'' ORDER BY 1")).rows.map(r=>r.value),
    visited:(await query("SELECT DISTINCT upper(coalesce(manual_data->>'VISITADO',raw->>'VISITADO','')) AS value FROM claims ORDER BY 1")).rows.map(r=>r.value).filter(Boolean),
    localities:(await query("SELECT DISTINCT locality_name AS value FROM customers WHERE coalesce(locality_name,'')<>'' ORDER BY 1")).rows.map(r=>r.value)};
}

export async function mutateCatalog(kind,id,method,body,supplied) {
  const table=kind==='statuses'?'claim_statuses':'claim_owners';
  const field=kind==='statuses'?'status':'owner_name';
  const run=async client=>{
    const current=id?(await client.query(`SELECT * FROM ${table} WHERE id=$1 FOR UPDATE`,[id])).rows[0]:null;
    if(id&&!current)throw Object.assign(new Error('Registro no encontrado'),{status:404});
    if(method==='DELETE') {
      if(current.import_name)throw Object.assign(new Error('Estado vinculado al importador. Podes editarlo o desactivarlo.'),{status:409});
      const used=await client.query(`SELECT 1 FROM claims WHERE ${field}=$1 LIMIT 1`,[current.name]);
      if(used.rowCount)throw Object.assign(new Error('Este valor tiene reclamos asociados. Desactivalo para conservar el historial.'),{status:409});
      await client.query(`DELETE FROM ${table} WHERE id=$1`,[id]);return {deleted:true};
    }
    const name=String(body.name??current?.name??'').trim();
    if(!name||name.length>100)throw Object.assign(new Error('Nombre obligatorio, hasta 100 caracteres'),{status:400});
    const active=body.active??current?.active??true;
    if(typeof active!=='boolean'||(body.terminal!==undefined&&typeof body.terminal!=='boolean'))throw Object.assign(new Error('Configuracion invalida'),{status:400});
    const terminal=body.terminal??current?.terminal??false;
    if(id){
      await client.query(`UPDATE ${table} SET name=$2,active=$3${kind==='statuses'?',terminal=$4':''} WHERE id=$1`,kind==='statuses'?[id,name,active,terminal]:[id,name,active]);
      if(current.name!==name)await client.query(`UPDATE claims SET ${field}=$2 WHERE ${field}=$1`,[current.name,name]);
    }else await client.query(`INSERT INTO ${table}(name,active${kind==='statuses'?',terminal':''}) VALUES($1,$2${kind==='statuses'?',$3':''})`,kind==='statuses'?[name,active,terminal]:[name,active]);
    return {ok:true};
  };
  return supplied?run(supplied):withClient(run);
}
