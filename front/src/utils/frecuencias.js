export const FRECUENCIAS = ['diario', 'semanal', 'quincenal', 'mensual', 'bimestral', 'trimestral', 'semestral', 'anual']

export const FREQ_FACTOR = {
  diario: 30,
  semanal: 4.33,
  quincenal: 2,
  mensual: 1,
  bimestral: 0.5,
  trimestral: 0.333,
  semestral: 0.167,
  anual: 0.083,
}

// Frecuencias que ocurren cada N meses con el monto completo (no prorrateado),
// en el mismo mes que fecha_inicio cada N meses (ej. matricula anual en enero).
export const PERIODO_MESES = {
  bimestral: 2,
  trimestral: 3,
  semestral: 6,
  anual: 12,
}

/**
 * Monto que corresponde a un ingreso/gasto recurrente en un mes dado (anio, mes con mes 1-12).
 *
 * - diario/semanal/quincenal/mensual: ocurren una o varias veces dentro del mes,
 *   se usa FREQ_FACTOR para obtener el equivalente mensual.
 * - bimestral/trimestral/semestral/anual: el monto completo aparece solo en los
 *   meses de recurrencia (cada N meses desde fecha_inicio); 0 el resto.
 */
export function montoEfectivoMes(monto, frecuencia, fechaInicio, anio, mes) {
  const valor = Number(monto) || 0
  const periodo = PERIODO_MESES[frecuencia]
  if (!periodo) {
    return valor * (FREQ_FACTOR[frecuencia] ?? 1)
  }

  const inicio = new Date(fechaInicio + 'T00:00:00')
  const diff = (anio - inicio.getFullYear()) * 12 + (mes - (inicio.getMonth() + 1))
  if (diff < 0 || diff % periodo !== 0) return 0
  return valor
}
