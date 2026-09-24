// Keep every source row while presenting all reasons on a single claim.
export function mergeClaimRows(first, next) {
  const all = [...(first.raw?._source_rows || [first.raw]), ...(next.raw?._source_rows || [next.raw])];
  const rows = [...new Map(all.map(row => [JSON.stringify(row), row])).values()];
  const merged = {...first, raw: {...first.raw, _source_rows: rows}};
  for (const key of ['subject', 'driver_primary', 'driver_secondary', 'comment']) {
    merged[key] = [...new Set([first[key], next[key]].filter(Boolean).flatMap(v => v.split('\n')))].join('\n');
  }
  for (const key of ['answered_at','answered_by','response','action_log','resolution_days','internal_sla_status','owner_name','closed_at']) {
    if (merged[key] === '' || merged[key] == null) merged[key] = next[key];
  }
  return merged;
}
