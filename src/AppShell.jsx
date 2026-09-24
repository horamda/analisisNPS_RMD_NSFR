import React,{useEffect,useRef,useState} from 'react';
import {LayoutDashboard,Truck,MessageSquare,PackageCheck,ClipboardList,Upload,BrainCircuit,FileChartColumn,Menu,X,Sun,Moon,LogOut,ArrowUpRight,RefreshCw,ChevronRight,Users,CheckCircle2,Clock3} from 'lucide-react';
import './app-shell.css';
import SlaDashboard from './SlaDashboard.jsx';

const modules=[
  {id:'home',label:'Inicio',icon:LayoutDashboard,group:'Espacio de trabajo'},
  {id:'reclamos',label:'Reclamos',icon:ClipboardList,group:'Espacio de trabajo'},
  {id:'importaciones',label:'Importaciones',icon:Upload,group:'Espacio de trabajo'},
  {id:'rmd',label:'RMD',icon:Truck,group:'Indicadores'},
  {id:'nps',label:'NPS',icon:MessageSquare,group:'Indicadores'},
  {id:'nsfr',label:'NS FR',icon:PackageCheck,group:'Indicadores'},
  {id:'ia',label:'Analisis IA',icon:BrainCircuit,group:'Analisis'},
  {id:'informe',label:'Informe ejecutivo',icon:FileChartColumn,group:'Analisis'},
];
const subtitles={home:'Operacion y seguimiento',reclamos:'Seguimiento de clientes',importaciones:'Archivos y cargas historicas',rmd:'Experiencia de entrega',nps:'Experiencia del cliente',nsfr:'Nivel de servicio',ia:'Analisis de indicadores',informe:'Resultados y seguimiento ejecutivo'};

export default function AppShell({tab,onNavigate,theme,onTheme,session,onLogout,children}){
  const [open,setOpen]=useState(false);const menuRef=useRef(null);const trigger=useRef(null);
  const current=modules.find(m=>m.id===tab)||modules[0];
  const allowed=modules.filter(m=>m.id!=='importaciones'||session.user.role==='admin');
  useEffect(()=>{setOpen(false);window.scrollTo({top:0});},[tab]);
  useEffect(()=>{const media=window.matchMedia('(min-width:761px)');const resize=()=>{if(media.matches)setOpen(false);};media.addEventListener('change',resize);return()=>media.removeEventListener('change',resize);},[]);
  useEffect(()=>{
    if(!open)return;
    const previous=document.body.style.overflow;document.body.style.overflow='hidden';
    const focusable=()=>[...menuRef.current.querySelectorAll('button')];focusable()[0]?.focus();
    function key(e){if(e.key==='Escape'){setOpen(false);trigger.current?.focus();}if(e.key==='Tab'){const items=focusable(),first=items[0],last=items.at(-1);if(e.shiftKey&&document.activeElement===first){e.preventDefault();last.focus();}else if(!e.shiftKey&&document.activeElement===last){e.preventDefault();first.focus();}}}
    document.addEventListener('keydown',key);return()=>{document.body.style.overflow=previous;document.removeEventListener('keydown',key);};
  },[open]);
  return <div className="app-shell" data-theme={theme}>
    <a className="skip-link" href="#workspace-main">Ir al contenido</a>
    {open&&<button className="nav-backdrop" aria-label="Cerrar menu" onClick={()=>setOpen(false)}/>}
    <aside className={`app-sidebar ${open?'is-open':''}`} ref={menuRef}>
      <div className="app-brand"><span className="brand-symbol">DP</span><div><strong>Del Palacio</strong><span>Gestion operativa</span></div><button className="icon-button mobile-close" aria-label="Cerrar menu" onClick={()=>setOpen(false)}><X size={20}/></button></div>
      <nav aria-label="Modulos">{['Espacio de trabajo','Indicadores','Analisis'].map(group=><div className="nav-group" key={group}><p>{group}</p>{allowed.filter(m=>m.group===group).map(({id,label,icon:Icon})=><button key={id} className={`nav-item ${id===tab?'active':''}`} aria-current={id===tab?'page':undefined} onClick={()=>{setOpen(false);onNavigate(id);}}><Icon size={19}/><span>{label}</span>{id===tab&&<ChevronRight size={15}/>}</button>)}</div>)}</nav>
      <div className="sidebar-footer"><div className="user-profile"><span className="user-avatar">{(session.user.display_name||session.user.username||'U').slice(0,2).toUpperCase()}</span><div><strong>{session.user.display_name||session.user.username}</strong><span>{({admin:'Administrador',user:'Gestion',viewer:'Consulta'})[session.user.role]}</span></div></div><button className="nav-item" onClick={onLogout}><LogOut size={18}/>Cerrar sesion</button></div>
    </aside>
    <div className="app-body"><header className="workspace-topbar"><div className="breadcrumb"><button ref={trigger} className="icon-button mobile-menu" aria-label="Abrir menu" aria-expanded={open} onClick={()=>setOpen(true)}><Menu size={21}/></button><span>Operacion</span><ChevronRight size={15}/><strong>{current.label}</strong></div><button className="icon-button" title={theme==='dark'?'Activar modo claro':'Activar modo oscuro'} aria-label={theme==='dark'?'Activar modo claro':'Activar modo oscuro'} onClick={onTheme}>{theme==='dark'?<Sun size={20}/>:<Moon size={20}/>}</button></header>
      <main id="workspace-main" className="workspace-main"><div className="page-heading"><div><p>{subtitles[tab]}</p><h1>{current.label}</h1></div>{tab==='home'&&<button className="primary-action" onClick={()=>onNavigate('reclamos')}><ClipboardList size={17}/>Ver reclamos<ArrowUpRight size={17}/></button>}</div>{children}</main>
    </div>
  </div>;
}

export function ModuleMetrics({items,loading,fromSheets}){
  return <section className="module-metrics" aria-label="Indicadores del modulo"><div className="metric-strip">{items.map(item=><div key={item.label} className="module-metric"><span>{item.label}</span><strong style={{color:item.color}}>{loading?'...':item.val}</strong><small>{item.sub}</small></div>)}</div><p className="data-caption"><span className={`status-dot ${fromSheets?'live':''}`}/>{loading?'Actualizando indicadores':fromSheets?'Fuente: Google Sheets':'Fuente: datos locales de respaldo'}</p></section>;
}

export function Overview({session,onNavigate}){
  const [summary,setSummary]=useState(null),[error,setError]=useState(''),[busy,setBusy]=useState(true);
  async function load(signal){setBusy(true);setError('');try{const r=await fetch('/api/dashboard/summary',{signal,headers:{Authorization:`Bearer ${session.token}`}});const d=await r.json();if(!r.ok)throw Error(d.error?.message||'No se pudo cargar el resumen');setSummary(d.summary);}catch(e){if(e.name!=='AbortError')setError(e.message);}finally{if(!signal?.aborted)setBusy(false);}}
  useEffect(()=>{const controller=new AbortController();load(controller.signal);return()=>controller.abort();},[session.token]);
  const cards=[{label:'Reclamos abiertos',value:summary?.claims?.abiertos,icon:Clock3,accent:'amber'}, {label:'Gestion finalizada',value:summary?.claims?.cerrados,icon:CheckCircle2,accent:'green'},{label:'Clientes activos',value:summary?.customers?.active,icon:Users,accent:'blue'}];
  return <div className="overview">
    {error&&<div className="overview-error" role="alert">{error}<button className="text-action" onClick={()=>load()}><RefreshCw size={16}/>Reintentar</button></div>}
    <section className="overview-stats" aria-label="Resumen de gestion">{cards.map(({label,value,icon:Icon,accent})=><div className={`overview-stat ${accent}`} key={label}><div><span>{label}</span><Icon size={19}/></div><strong>{busy?'...':value==null?'—':Number(value).toLocaleString('es-AR')}</strong></div>)}</section>
    <section className="module-directory"><div className="section-heading"><h2>Indicadores de servicio</h2><span>RMD / NPS / NS FR</span></div><div className="module-links">{modules.filter(m=>['rmd','nps','nsfr'].includes(m.id)).map(({id,label,icon:Icon})=><button key={id} className="module-link" onClick={()=>onNavigate(id)}><span className={`module-icon ${id}`}><Icon size={24}/></span><div><strong>{label}</strong><span>{subtitles[id]}</span></div><ArrowUpRight size={20}/></button>)}</div></section>
    <div className="overview-columns"><section><div className="section-heading"><h2>Reclamos por origen</h2><button className="text-action" onClick={()=>onNavigate('reclamos')}>Ver todos<ArrowUpRight size={16}/></button></div><div className="source-breakdown">{summary?.claims?.bySource?.map((s,i)=><div className="source-row" key={s.source}><div><span>{s.source.replaceAll('_',' ')}</span><strong>{s.total.toLocaleString('es-AR')}</strong></div><div className="source-track"><span style={{width:`${summary.claims.total?100*s.total/summary.claims.total:0}%`,background:['var(--accent)','var(--info)','var(--warning)'][i%3]}}/></div></div>)}{!busy&&!summary?.claims?.bySource?.length&&<p className="empty-note">Sin reclamos disponibles</p>}</div></section>
      <section><div className="section-heading"><h2>Ultimas cargas</h2>{session.user.role==='admin'&&<button className="text-action" onClick={()=>onNavigate('importaciones')}>Importaciones<ArrowUpRight size={16}/></button>}</div><div className="recent-imports">{summary?.imports?.slice(0,5).map(item=><div className="import-row" key={item.source}><span className="import-icon"><Upload size={17}/></span><div><strong>{item.source.replaceAll('_',' ')}</strong><span>{new Date(item.last_import).toLocaleString('es-AR',{dateStyle:'short',timeStyle:'short'})}</span></div><span>{item.batches} lotes</span></div>)}{!busy&&!summary?.imports?.length&&<p className="empty-note">Sin cargas registradas</p>}</div></section></div>
    <SlaDashboard rows={summary?.sla} busy={busy} error={error}/>
    <section className="analysis-links">{modules.filter(m=>['ia','informe'].includes(m.id)).map(({id,label,icon:Icon})=><button key={id} className="text-action" onClick={()=>onNavigate(id)}><Icon size={18}/>{label}<ArrowUpRight size={16}/></button>)}</section>
  </div>;
}
