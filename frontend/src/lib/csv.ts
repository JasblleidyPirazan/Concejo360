type Fila = Record<string, unknown>;

const escapar = (valor: unknown): string => {
  if (valor == null) return '';
  const s = String(valor);
  return /[",\n;]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

export function aCsv(filas: Fila[], columnas?: string[]): string {
  if (!filas.length) return '';
  const cols = columnas || Object.keys(filas[0]);
  const lineas = [cols.join(',')];
  for (const fila of filas) {
    lineas.push(cols.map((c) => escapar(fila[c])).join(','));
  }
  return lineas.join('\n');
}

export function descargarCsv(nombre: string, filas: Fila[], columnas?: string[]): void {
  const csv = aCsv(filas, columnas);
  if (!csv) return;
  // BOM para que Excel en es-CO abra el UTF-8 con tildes correctas
  const blob = new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `${nombre}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}
