import React, {useState} from 'react';

const months = ['Enero','Febrero','Marzo','Abril','Mayo','Junio','Julio','Agosto','Septiembre','Octubre','Noviembre','Diciembre'];
const label = type => type.replaceAll('_',' ');
const percent = (within, evaluated) => evaluated ? `${(100 * within / evaluated).toLocaleString('es-AR',{maximumFractionDigits:1})}%` : 'Sin evaluación';

export default function SlaDashboard({rows = [], busy, error}) {
  const [type,setType] = useState(''), [year,setYear] = useState(''), [month,setMonth] = useState('');
  const years = [...new Set(rows.map(r=>r.year).filter(Boolean))].sort((a,b)=>b-a);
  const types = [...new Set(rows.map(r=>r.type))].sort();
  const filtered = rows.filter(r=>(!type||r.type===type)&&(!year||String(r.year)===year)&&(!month||String(r.month)===month));
  const totals = filtered.reduce((a,r)=>({within:a.within+r.within,outside:a.outside+r.outside,unknown:a.unknown+r.unknown}),{within:0,outside:0,unknown:0});
  const evaluated = totals.within + totals.outside;
  const matrix = [...new Map(filtered.filter(r=>r.year && r.month).map(r=>[`${r.type}-${r.year}`,{type:r.type,year:r.year}])).values()]
    .sort((a,b)=>b.year-a.year || a.type.localeCompare(b.type));
  const visibleMonths = months.map((name,i)=>({name,number:i+1})).filter(m=>!month || String(m.number)===month);
  return <section className="sla-dashboard" aria-labelledby="sla-heading" aria-busy={busy}>
    <div className="section-heading"><h2 id="sla-heading">Cumplimiento de SLA</h2><span>Reclamos que requieren gestión</span></div>
    <div className="sla-filters">
      <label>Tipo<select value={type} onChange={e=>setType(e.target.value)}><option value="">Todos los tipos</option>{types.map(t=><option key={t} value={t}>{label(t)}</option>)}</select></label>
      <label>Año<select value={year} onChange={e=>setYear(e.target.value)}><option value="">Todos los años</option>{years.map(y=><option key={y} value={y}>{y}</option>)}</select></label>
      <label>Mes<select value={month} onChange={e=>setMonth(e.target.value)}><option value="">Todos los meses</option>{months.map((m,i)=><option key={m} value={i+1}>{m}</option>)}</select></label>
      <button className="text-action" onClick={()=>{setType('');setYear('');setMonth('');}}>Limpiar filtros</button>
    </div>
    {busy ? <p role="status">Cargando cumplimiento…</p> : error ? <p role="status">No se pudo cargar el cumplimiento de SLA.</p> : <>
      <div className="sla-totals" aria-live="polite">
        <div><span>Cumplimiento</span><strong>{percent(totals.within,evaluated)}</strong></div>
        <div><span>Dentro del SLA</span><strong>{totals.within.toLocaleString('es-AR')}</strong></div>
        <div><span>Fuera del SLA</span><strong>{totals.outside.toLocaleString('es-AR')}</strong></div>
        <div><span>Sin evaluación</span><strong>{totals.unknown.toLocaleString('es-AR')}</strong></div>
      </div>
      {matrix.length > 0 && <div className="sla-table-wrap" tabIndex={0} role="region" aria-label="Matriz mensual de cumplimiento de SLA"><table className="sla-table sla-matrix">
        <caption>Cumplimiento de cada SLA mes por mes · — indica sin registros</caption>
        <thead><tr><th scope="col">SLA / Año</th>{visibleMonths.map(m=><th scope="col" key={m.number}>{m.name.slice(0,3)}</th>)}<th scope="col">Total del período</th></tr></thead>
        <tbody>{matrix.map(group=>{
          const records = filtered.filter(r=>r.type===group.type && r.year===group.year && r.month);
          const within = records.reduce((sum,r)=>sum+r.within,0);
          const count = records.reduce((sum,r)=>sum+r.evaluated,0);
          return <tr key={`${group.type}-${group.year}`}><th scope="row">{label(group.type)} · {group.year}</th>{visibleMonths.map(m=>{
            const r = records.find(r=>Number(r.month)===m.number);
            return <td key={m.number} title={r ? `${r.within} dentro / ${r.outside} fuera / ${r.unknown} sin evaluación` : 'Sin registros'}><span className={r?.evaluated ? 'sla-cell evaluated' : 'sla-cell'}>{r ? percent(r.within,r.evaluated) : '—'}</span></td>;
          })}<td><strong>{percent(within,count)}</strong></td></tr>;
        })}</tbody>
      </table></div>}
      {filtered.length ? <details className="sla-details"><summary>Ver detalle de casos por mes</summary><div className="sla-table-wrap" tabIndex={0} role="region" aria-label="Cumplimiento por tipo, mes y año"><table className="sla-table">
        <thead><tr><th scope="col">Tipo</th><th scope="col">Año</th><th scope="col">Mes</th><th scope="col">Dentro</th><th scope="col">Fuera</th><th scope="col">Sin evaluación</th><th scope="col">Cumplimiento</th></tr></thead>
        <tbody>{filtered.map(r=><tr key={`${r.type}-${r.year}-${r.month}`}><th scope="row">{label(r.type)}</th><td>{r.year ?? 'Sin fecha'}</td><td>{months[r.month-1] ?? 'Sin fecha'}</td><td>{r.within}</td><td>{r.outside}</td><td>{r.unknown}</td><td><div className="sla-percentage"><strong>{percent(r.within,r.evaluated)}</strong>{r.evaluated>0&&<div className="source-track" aria-hidden="true"><span style={{width:`${r.percentage}%`,background:'var(--accent)'}}/></div>}</div></td></tr>)}</tbody>
      </table></div></details> : <p className="empty-note">Sin reclamos para los filtros seleccionados.</p>}
    </>}
    <p className="sla-note"><strong>Plazo de SLA: 3 días corridos desde el ingreso del reclamo hasta su contestación.</strong> Incluye sábados, domingos y feriados. Cumplimiento = OK / (OK + NO OK). El indicador utiliza el campo «Cumplimiento SLA» guardado; no recalcula automáticamente el plazo a partir de las fechas. Los valores vacíos o no reconocidos se muestran sin evaluación y se excluyen del porcentaje. Mes y año corresponden a la fecha de ingreso.</p>
  </section>;
}
