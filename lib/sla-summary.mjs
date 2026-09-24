// Only explicit evaluations participate in the denominator; missing is not failure.
export function summarizeSla(rows) {
  const groups = new Map();
  for (const row of rows) {
    const key = JSON.stringify([row.source, row.year, row.month]);
    if (!groups.has(key)) groups.set(key, {type: row.source, year: row.year, month: row.month, within: 0, outside: 0, unknown: 0, total: 0});
    const group = groups.get(key);
    const status = String(row.internal_sla_status || '').trim().toUpperCase().replace(/\s+/g, ' ');
    const count = Number(row.total);
    group[status === 'OK' ? 'within' : status === 'NO OK' ? 'outside' : 'unknown'] += count;
    group.total += count;
  }
  return [...groups.values()].map(group => ({...group, evaluated: group.within + group.outside,
    percentage: group.within + group.outside ? 100 * group.within / (group.within + group.outside) : null}));
}
