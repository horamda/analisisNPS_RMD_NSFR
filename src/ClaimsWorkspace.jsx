import React, {useEffect,useState} from 'react';
import {Filter,ChevronDown} from 'lucide-react';

const RMD=['Año','Mes','Rmd_rating_id','#FECHA_ENC','#FECHA_ENT','NRO_PEDIDO','COD_CLIENTE_DISTRIBUIDOR','NOMBRE_CLIENTE','#SCORE','#COMMENT','DESC_SEGMENTO_MKT','DESC_SEGMENTO_VENTA','COD_DISTRIBUIDOR','DESC_DISTRIBUIDOR','RESPONSABLE','STATUS','FECHA RTA','OBSERVACIONES DEL RESPONSABLE','CLIENTE','LOCALIDAD','DIRECCION','TELEFONO','HORARIO','VISITADO','Dias resolucion','Cumplimiento SLA'];
const NPS=['FECHA','COD_CLIENTE_DISTRIBUIDOR','NOMBRE_CLIENTE','DESC_LOCALIDAD','SCORE','COD_DESC_SEGMENTO_MKT','COD_DESC_SEGMENTO_VENTA','COD_DISTRIBUIDOR','DDC_NAME','CATEGORIA','PRIMARY_DRIVER','SECONDARY_DRIVER','COMENTARIO','ESTADO','COD CLIENTE','LOCALIDAD','DIRECCION','TELEFONO','HORARIO','ACTION LOG','PLAN DE ACCION','EVIDENCIA','VISITADO','VISITADO_24','MES','AÑO','Fecha respuesta','Dias resolucion','Cumplimiento SLA'];
const SUMMARY=['Origen','Ticket','Cliente','Estado','Responsable','Fecha de resolucion','Observaciones'];
const BEES=['ID Ticket','N° Cliente','Nombre Cliente','Estado','Comentario del cliente','Foto en el ticket','Fecha de contestacion','Quien contesto el ticket','Respuesta','Action Log','Dias resolucion','Cumplimiento SLA'];
const mapped={Origen:'source',Ticket:'external_id',Cliente:'customer_name',Estado:'status',Responsable:'owner_name','Fecha de resolucion':'answered_at',Observaciones:'response',Rmd_rating_id:'external_id',COD_CLIENTE_DISTRIBUIDOR:'customer_id',NOMBRE_CLIENTE:'customer_name','#SCORE':'score',SCORE:'score','#COMMENT':'comment',COMENTARIO:'comment',STATUS:'status',ESTADO:'status',RESPONSABLE:'owner_name','FECHA RTA':'answered_at','Fecha respuesta':'answered_at','OBSERVACIONES DEL RESPONSABLE':'response','Dias resolucion':'resolution_days','Cumplimiento SLA':'internal_sla_status','ACTION LOG':'action_log'};
const aliases={'#FECHA_ENC':['Fecha Puntuacion'],'#FECHA_ENT':['Fecha Entrega'],'FECHA':['FECHA ENC'],'COD_DESC_SEGMENTO_MKT':['COD DESC SEGMENTO MKT'],'COD_DESC_SEGMENTO_VENTA':['COD DESC SEGMENTO VENTA'],'PRIMARY_DRIVER':['DRIVER PRIMARIO'],'SECONDARY_DRIVER':['DRIVER SECUNDARIO']};
Object.assign(mapped,{'ID Ticket':'external_id','N° Cliente':'customer_id','Nombre Cliente':'customer_name','Comentario del cliente':'comment','Fecha de contestacion':'answered_at','Quien contesto el ticket':'answered_by','Respuesta':'response','Action Log':'action_log',PRIMARY_DRIVER:'driver_primary',SECONDARY_DRIVER:'driver_secondary'});
const customerFields={Cliente:'legal_name',NOMBRE_CLIENTE:'legal_name',LOCALIDAD:'locality_name',DESC_LOCALIDAD:'locality_name',DIRECCION:'address',TELEFONO:'phone','COD CLIENTE':'customer_id',CLIENTE:'customer_id'};
const norm=v=>v.normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase();
export function fieldValue(c,k){
  if(Object.hasOwn(c.manual_data||{},k))return c.manual_data[k];
  if(mapped[k] && c[mapped[k]]!=null && c[mapped[k]]!=='')return c[mapped[k]];
  const names=[k,...(aliases[k]||[])].map(norm);
  const raw=Object.entries(c.raw||{}).find(([key])=>names.includes(norm(key)))?.[1];
  if(raw!=null&&raw!=='')return raw;
  return c.customer?.[customerFields[k]]??'';
}
const blank={source:'',status:'',owner:'',from:'',to:'',score:'',q:'',visited:'',sla:'',locality:''};
const date=v=>v?String(v).slice(0,10):'';

export default function ClaimsWorkspace({session,colors:C,usersView}){
  const [rows,setRows]=useState([]),[catalog,setCatalog]=useState({statuses:[],owners:[]});
  const [filters,setFilters]=useState(blank),[applied,setApplied]=useState(blank),[offset,setOffset]=useState(0),[total,setTotal]=useState(0);
  const [tab,setTab]=useState('claims'),[layout,setLayout]=useState('Resumen'),[message,setMessage]=useState(''),[busy,setBusy]=useState(false),[revision,setRevision]=useState(0);
  const [edit,setEdit]=useState(null),[draft,setDraft]=useState({});
  const [filtersOpen,setFiltersOpen]=useState(()=>window.innerWidth>760);
  useEffect(()=>{const media=window.matchMedia('(max-width:760px)');const change=()=>setFiltersOpen(!media.matches);media.addEventListener('change',change);return()=>media.removeEventListener('change',change);},[]);
  const writable=session.user.role!=='viewer',admin=session.user.role==='admin';
  const style={padding:8,border:`1px solid ${C.border}`,borderRadius:4,background:C.bg1,color:C.text0,minWidth:0,font:'inherit',boxSizing:'border-box'};
  const button={...style,cursor:'pointer'};
  async function api(path,method='GET',body){const r=await fetch('/api/'+path,{method,headers:{Authorization:`Bearer ${session.token}`,'Content-Type':'application/json'},body:body?JSON.stringify(body):undefined});const d=await r.json();if(!r.ok)throw Error(d.error?.message||'Error');return d;}
  async function reloadCatalog(){setCatalog(await api('claim-catalogs'));}
  useEffect(()=>{reloadCatalog().catch(e=>setMessage(e.message));},[session.token]);
  useEffect(()=>{let active=true;setBusy(true);api('claims?'+new URLSearchParams({...applied,offset})).then(d=>{if(active){setRows(d.claims);setTotal(d.claims[0]?.filtered_total||0);}}).catch(e=>{if(active)setMessage(e.message);}).finally(()=>{if(active)setBusy(false);});return()=>{active=false};},[applied,offset,revision,session.token]);
  const field=(label,element)=><label style={{display:'grid',gap:5,fontSize:12}}>{label}{element}</label>;
  const selector=(k,label,options)=>field(label,<select style={style} value={filters[k]} onChange={e=>setFilters({...filters,[k]:e.target.value})}><option value="">Todos</option>{options.map(o=><option key={o.value??o} value={o.value??o}>{o.label??o}</option>)}</select>);
  const cols=layout==='RMD'?RMD:layout==='NPS'?NPS:layout==='Bees Care.'?BEES:SUMMARY;
  async function save(){setBusy(true);try{await api('claims/'+edit.id,'PATCH',draft);setEdit(null);setOffset(0);setRevision(r=>r+1);setMessage('Cambios guardados');}catch(e){setMessage(e.message);}finally{setBusy(false);}}
  return <div style={{display:'grid',gap:16,color:C.text0,fontSize:13}}>
    <nav style={{display:'flex',gap:8,flexWrap:'wrap'}}>{['claims',...(admin?['statuses','owners','users']:[])].map(t=><button key={t} style={{...button,fontWeight:tab===t?700:400}} onClick={()=>{setTab(t);setMessage('');}}>{({claims:'Reclamos',statuses:'Estados',owners:'Responsables',users:'Usuarios'})[t]}</button>)}</nav>
    {message&&<div role="status">{message}</div>}
    {tab==='claims'&&<p style={{margin:0,color:C.text2}}>Reclamos con fecha de ingreso desde el 1 de enero de 2025. SLA de contestación: 3 días corridos desde el ingreso, incluidos sábados, domingos y feriados.</p>}
    {tab==='users'?usersView:tab!=='claims'?<Catalog key={tab} kind={tab} items={catalog[tab]} api={api} reload={reloadCatalog} style={style} report={setMessage}/>:<>
      <details className="claim-filters" open={filtersOpen} onToggle={e=>setFiltersOpen(e.currentTarget.open)}><summary><Filter size={16}/><span>Filtros{Object.values(applied).filter(Boolean).length?` (${Object.values(applied).filter(Boolean).length})`:''}</span><ChevronDown size={16}/></summary>
      <form onSubmit={e=>{e.preventDefault();setOffset(0);setApplied({...filters});if(window.innerWidth<=760)setFiltersOpen(false);}} style={{display:'grid',gridTemplateColumns:'repeat(auto-fit,minmax(150px,1fr))',gap:10,alignItems:'end'}}>
        {selector('source','Origen',['RMD','NPS','BEES_CARE'])}{selector('status','Estado',catalog.statuses.map(s=>s.name))}{selector('owner','Responsable',[{value:'__unassigned',label:'Sin asignar'},...catalog.owners.map(s=>s.name)])}
        {['from','to'].map(k=><React.Fragment key={k}>{field(k==='from'?'Ingreso desde':'Ingreso hasta',<input style={style} type="date" value={filters[k]} onChange={e=>setFilters({...filters,[k]:e.target.value})}/>)}</React.Fragment>)}
        {selector('score','Puntuacion',Array.from({length:11},(_,i)=>String(i)))}{selector('visited','Visitado',catalog.visited||[])}
        {selector('sla','Cumplimiento SLA',catalog.sla||[])}{selector('locality','Localidad',catalog.localities||[])}
        {field('Cliente, ticket o comentario',<input style={style} value={filters.q} onChange={e=>setFilters({...filters,q:e.target.value})}/>)}
        <button disabled={busy} style={button}>Aplicar filtros</button><button type="button" style={button} onClick={()=>{setFilters(blank);setApplied(blank);setOffset(0);}}>Limpiar</button>
      </form>
      </details>
      <div style={{display:'flex',gap:12,alignItems:'center'}}><span>{busy?'Cargando...':`${total} resultados`}</span>{field('Columnas',<select style={style} value={layout} onChange={e=>setLayout(e.target.value)}>{['Resumen','RMD','NPS','Bees Care.'].map(s=><option key={s}>{s}</option>)}</select>)}</div>
      <div style={{overflow:'auto',maxHeight:'65vh',border:`1px solid ${C.border}`}}><table className={layout==='Resumen'?'claims-table summary-table':'claims-table'} style={{borderCollapse:'collapse',width:'100%'}}><thead style={{position:'sticky',top:0,background:C.bg1}}><tr>{[...cols,'Acciones'].map(k=><th key={k} style={{padding:10,textAlign:'left',whiteSpace:'nowrap'}}>{k}</th>)}</tr></thead><tbody>{rows.map(c=><tr key={c.id}>{cols.map(k=><td key={k} style={{padding:10,borderTop:`1px solid ${C.border}`,minWidth:110,maxWidth:300,overflowWrap:'anywhere'}}>{mapped[k]==='answered_at'?date(fieldValue(c,k)):String(fieldValue(c,k))}</td>)}<td><button style={button} onClick={()=>{setEdit(c);setDraft({});}}>{writable?'Editar':'Ver'}</button></td></tr>)}</tbody></table>{!busy&&!rows.length&&<p style={{padding:12}}>Sin resultados.</p>}</div>
      <div style={{display:'flex',gap:12,alignItems:'center'}}><button style={button} disabled={busy||!offset} onClick={()=>setOffset(o=>o-50)}>Anterior</button><span>Pagina {offset/50+1}</span><button style={button} disabled={busy||offset+50>=total} onClick={()=>setOffset(o=>o+50)}>Siguiente</button></div>
    </>}
    {edit&&<div role="dialog" aria-modal="true" aria-label="Detalle del reclamo" style={{position:'fixed',inset:0,zIndex:1000,background:'rgba(0,0,0,.4)',display:'grid',placeItems:'center',padding:16}}><div style={{background:C.bg1,padding:20,borderRadius:8,width:'min(950px,100%)',maxHeight:'90vh',overflow:'auto',boxSizing:'border-box'}}>
      <div style={{display:'flex',justifyContent:'space-between',alignItems:'center'}}><h2 style={{fontSize:18}}>Reclamo {edit.external_id||edit.id}</h2><button style={button} onClick={()=>setEdit(null)}>Cerrar</button></div>
      {!edit.customer&&<p>Cliente sin coincidencia en el padron.</p>}
      <div style={{display:'grid',gridTemplateColumns:'repeat(auto-fit,minmax(200px,1fr))',gap:12}}>
        {field('Estado',<select disabled={!writable} style={style} value={draft.status??edit.status} onChange={e=>setDraft({...draft,status:e.target.value})}>{catalog.statuses.filter(s=>s.active||s.name===edit.status).map(s=><option disabled={!s.active} key={s.id}>{s.name}</option>)}</select>)}
        {field('Responsable',<select disabled={!writable} style={style} value={draft.owner_name??edit.owner_name??''} onChange={e=>setDraft({...draft,owner_name:e.target.value})}><option value="">Sin asignar</option>{catalog.owners.filter(s=>s.active||s.name===edit.owner_name).map(s=><option disabled={!s.active} key={s.id}>{s.name}</option>)}</select>)}
        {field(edit.source==='BEES_CARE'?'Fecha de contestacion':edit.source==='NPS'?'Fecha respuesta':'Fecha de respuesta (FECHA RTA)',<input disabled={!writable} style={style} type="date" value={date(draft.answered_at===undefined?edit.answered_at:draft.answered_at)} onChange={e=>setDraft({...draft,answered_at:e.target.value||null})}/>)}
        {field('Quien contesto el ticket',<input disabled={!writable} style={style} value={draft.answered_by??edit.answered_by??''} onChange={e=>setDraft({...draft,answered_by:e.target.value})}/>)}
        {field(edit.source==='BEES_CARE'?'Respuesta':'Observaciones del responsable',<textarea disabled={!writable} style={style} rows={4} value={draft.response??edit.response??''} onChange={e=>setDraft({...draft,response:e.target.value})}/>)}
        {['resolution_days','internal_sla_status','action_log'].map(k=><React.Fragment key={k}>{field(({resolution_days:'Dias resolucion',internal_sla_status:'Cumplimiento SLA',action_log:'Action Log'})[k],<input disabled={!writable} style={style} type={k==='resolution_days'?'number':'text'} min="0" value={draft[k]??edit[k]??''} onChange={e=>setDraft({...draft,[k]:e.target.value})}/>)}</React.Fragment>)}
        {[...new Set([...(edit.source==='RMD'?RMD:edit.source==='NPS'?NPS:[]),...Object.keys(edit.raw||{})])].filter(k=>!k.startsWith('_') && !['STATUS','ESTADO','RESPONSABLE','FECHA RTA','Fecha respuesta','OBSERVACIONES DEL RESPONSABLE','Dias resolucion','Cumplimiento SLA','ACTION LOG','Fecha de contestacion','Quien contesto el ticket','Respuesta','Action Log'].includes(k)).map(k=><React.Fragment key={k}>{field(k,<input style={style} disabled={!writable} value={draft.manual_data?.[k]??fieldValue(edit,k)} onChange={e=>setDraft({...draft,manual_data:{...draft.manual_data,[k]:e.target.value}})}/>)}</React.Fragment>)}
      </div>{edit.raw?._source_rows?.length>1&&<details style={{marginTop:16}}><summary>Filas de origen conservadas ({edit.raw._source_rows.length})</summary>{edit.raw._source_rows.map((r,i)=><div key={i} style={{padding:10,borderBottom:`1px solid ${C.border}`}}>{Object.entries(r).filter(([k,v])=>!k.startsWith('_')&&v!==''&&v!=null).map(([k,v])=><div key={k}><b>{k}: </b>{String(v)}</div>)}</div>)}</details>}<div style={{marginTop:16,display:'flex',gap:8}}>{writable&&<button style={button} disabled={busy||!Object.keys(draft).length} onClick={save}>Guardar cambios</button>}<button style={button} onClick={()=>setEdit(null)}>Cancelar</button></div>
    </div></div>}
  </div>;
}

function Catalog({kind,items,api,reload,style,report}){
  const [form,setForm]=useState({name:'',active:true,terminal:false}),[id,setId]=useState(null),[busy,setBusy]=useState(false);
  const reset=()=>{setId(null);setForm({name:'',active:true,terminal:false});};
  async function save(e){e.preventDefault();setBusy(true);try{await api(`claim-catalogs/${kind}${id?'/'+id:''}`,id?'PATCH':'POST',form);await reload();reset();report('Catalogo actualizado');}catch(e){report(e.message);}finally{setBusy(false);}}
  async function remove(item){if(!window.confirm(`Eliminar ${item.name}?`))return;setBusy(true);try{await api(`claim-catalogs/${kind}/${item.id}`,'DELETE');await reload();}catch(e){report(e.message);}finally{setBusy(false);}}
  return <section><h2 style={{fontSize:18}}>{kind==='statuses'?'Estados':'Responsables'}</h2><form onSubmit={save} style={{display:'flex',gap:12,alignItems:'center',flexWrap:'wrap'}}><input aria-label="Nombre" placeholder="Nombre" required maxLength={100} style={style} value={form.name} onChange={e=>setForm({...form,name:e.target.value})}/><label><input type="checkbox" checked={form.active} onChange={e=>setForm({...form,active:e.target.checked})}/> Activo</label>{kind==='statuses'&&<label><input type="checkbox" checked={form.terminal} onChange={e=>setForm({...form,terminal:e.target.checked})}/> Finaliza la gestion</label>}<button style={style} disabled={busy}>{id?'Guardar':'Crear'}</button>{id&&<button type="button" style={style} onClick={reset}>Cancelar</button>}</form>
    <div style={{overflow:'auto'}}><table style={{width:'100%',marginTop:16,textAlign:'left'}}><thead><tr><th>Nombre</th><th>Activo</th>{kind==='statuses'&&<th>Finaliza gestion</th>}<th>Acciones</th></tr></thead><tbody>{items.map(item=><tr key={item.id}><td>{item.name}</td><td>{item.active?'Si':'No'}</td>{kind==='statuses'&&<td>{item.terminal?'Si':'No'}</td>}<td><button style={style} disabled={busy} onClick={()=>{setId(item.id);setForm(item);}}>Editar</button> <button style={style} disabled={busy} onClick={()=>remove(item)}>Eliminar</button></td></tr>)}</tbody></table></div></section>;
}
