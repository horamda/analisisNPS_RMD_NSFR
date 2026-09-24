export function formatImportReport(result) {
  if (result.alreadyImported) return 'Este archivo ya fue importado con las reglas actuales.';
  const parts = [
    `${result.total || 0} filas conservadas`,
    `${result.inserted || 0} reclamos nuevos`,
    `${result.updated || 0} existentes`,
    `${result.duplicateRows || 0} filas consolidadas`,
    `${result.withoutManagement || 0} sin necesidad de gestión`,
    `${result.ambiguous || 0} pendientes de revisión`,
  ];
  for (const [reason, count] of Object.entries(result.issues || {})) parts.push(`${reason}: ${count}`);
  if (result.skipped && !Object.keys(result.issues || {}).length) parts.push(`${result.skipped} filas excluidas`);
  if (result.withoutSla) parts.push(`${result.withoutSla} reclamos sin evaluación SLA`);
  return parts.join('. ') + '.';
}
