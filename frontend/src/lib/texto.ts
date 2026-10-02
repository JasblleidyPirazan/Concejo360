// SIMI guarda muchos títulos en MAYÚSCULA SOSTENIDA; se convierten a mayúscula
// inicial al cargar (no con CSS) para que también salgan así en el CSV.

const SIGLAS = new Set([
  'POT', 'PAE', 'EPM', 'EDU', 'ESU', 'SIMI', 'UNE', 'ISVIMED', 'INDER', 'ICBF', 'DIAN', 'SENA', 'ITM',
  'JAL', 'JAC', 'ONG', 'IPS', 'EPS', 'ESE', 'TIC', 'VIH', 'PDT', 'PDM', 'DAGRD', 'SISBEN', 'SISBÉN',
  'BRT', 'UVA', 'UVAS', 'MIO', 'IVA', 'ICA', 'POAI', 'NNA', 'LGBT', 'LGBTI', 'LGBTIQ', 'PQRS', 'PQRSD',
  'CAI', 'UNP', 'DANE', 'CTI', 'ODS', 'SITVA', 'EAFIT', 'APP', 'PEMP', 'ACI', 'EMVARIAS', 'AMVA',
  'ESP', 'SAS', 'S.A.', 'E.S.P.', 'II', 'III', 'IV', 'VI', 'VII', 'VIII', 'IX', 'XI', 'XII', 'XX', 'XXI',
]);

const NOMBRES_PROPIOS = [
  'Comisión Legal para la Equidad de las Mujeres',
  'Empresas Públicas de Medellín',
  'Área Metropolitana del Valle de Aburrá',
  'Distrito de Medellín',
  'Alcaldía de Medellín',
  'Concejo de Medellín',
  'Metro Ligero de la 80',
  'Metro de Medellín',
  'Valle de Aburrá',
  'San Antonio de Prado',
  'San Cristóbal',
  'Santa Elena',
  'Parque Arví',
  'Hidroituango',
  'Buen Comienzo',
  'Altavista',
  'Palmitas',
  'Moravia',
  'Medellín',
  'Antioquia',
  'Colombia',
  'Bogotá',
  'Alcaldía',
  'Concejo',
];

const VARIANTES: Record<string, string> = { a: '[aá]', e: '[eé]', i: '[ií]', o: '[oó]', u: '[uúü]' };

function patronSinTildes(frase: string): RegExp {
  const cuerpo = frase
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    .replace(/[aeiou]/g, (v) => VARIANTES[v]);
  return new RegExp(`(?<![\\p{L}\\d])${cuerpo}(?![\\p{L}\\d])`, 'giu');
}

const PATRONES_NOMBRES = NOMBRES_PROPIOS.map((nombre) => ({ nombre, patron: patronSinTildes(nombre) }));

function estaEnMayusculaSostenida(texto: string): boolean {
  const letras = texto.replace(/[^\p{L}]/gu, '');
  if (letras.length < 4) return false;
  const mayusculas = letras.replace(/[^\p{Lu}]/gu, '').length;
  return mayusculas / letras.length >= 0.7;
}

function conservarPalabra(palabra: string): boolean {
  const limpia = palabra.replace(/^[^\p{L}\d]+|[^\p{L}\d.]+$/gu, '');
  return /\d/.test(limpia) || SIGLAS.has(limpia);
}

export function aMayusculaInicial(texto: unknown): string {
  const original = String(texto ?? '').trim();
  if (!estaEnMayusculaSostenida(original)) return original;

  let resultado = original
    .split(/(\s+)/)
    .map((p) => (/^\s+$/.test(p) || conservarPalabra(p) ? p : p.toLowerCase()))
    .join('');

  for (const { nombre, patron } of PATRONES_NOMBRES) {
    resultado = resultado.replace(patron, nombre);
  }

  return resultado.replace(/(^|[.!?]\s+)(\p{Ll})/gu, (_m, previo, letra) => previo + letra.toUpperCase());
}
