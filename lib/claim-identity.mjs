import crypto from 'node:crypto';

const clean=v=>String(v??'').trim();
const channel=c=>c.source.includes('NPS')?'NPS':c.source.includes('RMD')?'RMD':'BEES_CARE';
export function customerKey(value){
  let id=clean(value);
  const prefix=process.env.DISTRIBUTOR_CODE||'136928';
  if(id.length===14 && id.startsWith(prefix))id=id.slice(6);
  return /^\d+$/.test(id)?id.replace(/^0+(?=\d)/,''):id;
}
const timestamp=v=>{const d=new Date(v);return v&&!Number.isNaN(d.getTime())?d.toISOString():'';};
const digest=v=>crypto.createHash('sha256').update(v).digest('hex');

export function existingDuplicateGroups(rows){
  const groups=new Map();
  for(const c of rows){
    const customer=customerKey(c.customer_id),at=timestamp(c.opened_at),id=clean(c.external_id);
    const key=id?`${channel(c)}|id|${id}`:customer&&at?`${channel(c)}|${customer}|${at}`:'';
    if(!key)continue;
    const list=groups.get(key)||[];list.push(c);groups.set(key,list);
  }
  return [...groups.values()].filter(list=>list.length>1).map(list=>({source:list[0].source,claim_ids:list.map(c=>c.id)}));
}

export function identityResolver(existing){
  const ids=new Map(),events=new Map(),days=new Map();
  function push(map,key,c){if(!key)return;const list=map.get(key)||[];if(!list.some(x=>x.dedupe_key===c.dedupe_key))list.push(c);map.set(key,list);}
  function keys(c){const customer=customerKey(c.customer_id),at=timestamp(c.opened_at);return {id:clean(c.external_id),event:customer&&at?`${channel(c)}|${customer}|${at}`:'',day:customer&&at?`${customer}|${at.slice(0,10)}`:''};}
  function add(c){const k=keys(c);push(ids,k.id,c);push(events,k.event,c);push(days,k.day,c);}
  existing.forEach(add);
  return c=>{
    const k=keys(c);
    const sameId=k.id?(ids.get(k.id)||[]):[];
    const sameType=sameId.filter(x=>channel(x)===channel(c));
    if(sameType.length===1){
      const match=sameType[0];
      if(customerKey(match.customer_id)&&customerKey(c.customer_id)&&customerKey(match.customer_id)!==customerKey(c.customer_id))return {conflict:'El identificador existe con otro cliente',candidates:sameType};
      return {key:match.dedupe_key};
    }
    if(sameType.length>1)return {conflict:'Hay varios reclamos con el mismo identificador',candidates:sameType};
    const exact=!k.id&&k.event?(events.get(k.event)||[]):[];
    if(exact.length===1)return {key:exact[0].dedupe_key};
    if(exact.length>1)return {conflict:'Hay varios reclamos para esta encuesta',candidates:exact};
    const possible=[...new Map([...sameId,...(k.day?days.get(k.day)||[]:[])].filter(x=>
      (!k.id || channel(x)!==channel(c)) && customerKey(x.customer_id)===customerKey(c.customer_id)
    ).map(x=>[x.dedupe_key,x])).values()];
    if(possible.length)return {conflict:'Posible coincidencia entre origenes o fechas sin identificador comun',candidates:possible};
    if(!k.id&&!k.event)return {conflict:'Falta identificador o cliente y fecha',candidates:[]};
    const key=`identity-v3:${digest(k.id?`${channel(c)}|id|${k.id}`:k.event)}`;
    add({...c,dedupe_key:key});
    return {key};
  };
}
