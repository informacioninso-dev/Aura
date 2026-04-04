import { useEffect, useMemo, useState } from 'react'
import { Calculator, CheckCircle, XCircle, Save, Trash2, CreditCard } from 'lucide-react'
import { AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend, ReferenceLine } from 'recharts'

import { getApiErrorMessage } from '../../api/errors'
import api from '../../api/client'
import ListControls from '../../components/ui/ListControls'
import DateQuickActions from '../../components/ui/DateQuickActions'
import FeedbackAlert from '../../components/ui/FeedbackAlert'
import ConfirmDialog from '../../components/ui/ConfirmDialog'
import { useAuth } from '../../context/useAuth'
import { DATE_INPUT_MAX, DATE_INPUT_MIN } from '../../utils/dateBounds'
import { formatMoney } from '../../utils/formatters'
import '../../components/ui/app.css'

const MESES = ['Ene', 'Feb', 'Mar', 'Abr', 'May', 'Jun', 'Jul', 'Ago', 'Sep', 'Oct', 'Nov', 'Dic']
const FACTOR_FRECUENCIA = {
  diario: 30,
  semanal: 4.33,
  quincenal: 2,
  mensual: 1,
  bimestral: 0.5,
  trimestral: 0.333,
  semestral: 0.167,
  anual: 0.083,
}
const COLCHON_STORAGE_KEY = 'simulador_colchon_minimo'
const SIMULADOR_PAST_MONTHS = 6
const PROJECTION_MODE_LABELS = {
  automatica: 'Automatica',
  simple: 'Simple',
  personalizada: 'Personalizada',
}

function parseLocalDate(value) {
  const [y, m, d] = value.split('-').map(Number)
  return new Date(y, m - 1, d)
}

function startOfMonth(date) {
  return new Date(date.getFullYear(), date.getMonth(), 1)
}

function endOfMonth(date) {
  return new Date(date.getFullYear(), date.getMonth() + 1, 0)
}

function overlapsMonth(item, monthDate) {
  if (!item.activo) return false
  const monthStart = startOfMonth(monthDate)
  const monthEnd = endOfMonth(monthDate)
  const ini = parseLocalDate(item.fecha_inicio)
  const fin = item.fecha_fin ? parseLocalDate(item.fecha_fin) : null
  return ini <= monthEnd && (!fin || fin >= monthStart)
}

function occursInMonth(item, monthDate, dateField = 'fecha') {
  const dateValue = item?.[dateField]
  if (!dateValue) return false
  const targetDate = parseLocalDate(dateValue)
  const monthStart = startOfMonth(monthDate)
  const monthEnd = endOfMonth(monthDate)
  return targetDate >= monthStart && targetDate <= monthEnd
}

function formatDateLocal(date) {
  const y = date.getFullYear()
  const m = String(date.getMonth() + 1).padStart(2, '0')
  const d = String(date.getDate()).padStart(2, '0')
  return `${y}-${m}-${d}`
}

function calcularCuota(monto, tasaAnual, plazoMeses) {
  if (!monto || !tasaAnual || !plazoMeses) return 0
  const r = Number(tasaAnual) / 100 / 12
  const n = Number(plazoMeses)
  const p = Number(monto)
  if (!r) return p / n
  return (p * (r * Math.pow(1 + r, n))) / (Math.pow(1 + r, n) - 1)
}

function roundMoneyNumber(value) {
  const numeric = Number(value)
  if (!Number.isFinite(numeric)) return 0
  return Number(numeric.toFixed(2))
}

function getInitialColchonMinimo() {
  if (typeof window === 'undefined') return ''
  const savedValue = window.localStorage.getItem(COLCHON_STORAGE_KEY)
  if (!savedValue) return ''
  const parsed = Number(savedValue)
  if (!Number.isFinite(parsed) || parsed <= 0) return ''
  return String(parsed)
}

function construirFlujoBaseSimple(ingresos, ingresosPuntuales, gastosCorrientes, gastosNoCorrientes, diferidos) {
  const hoy = new Date()
  return Array.from({ length: 24 }, (_, i) => {
    const fecha = new Date(hoy.getFullYear(), hoy.getMonth() + i, 1)
    const mes = `${MESES[fecha.getMonth()]} ${fecha.getFullYear()}`

    const totalIngresos = ingresos
      .filter((item) => overlapsMonth(item, fecha))
      .reduce((sum, item) => sum + Number(item.monto) * (FACTOR_FRECUENCIA[item.frecuencia] || 1), 0)

    const totalIngresosPuntuales = ingresosPuntuales
      .filter((item) => occursInMonth(item, fecha))
      .reduce((sum, item) => sum + Number(item.monto), 0)

    const totalGastosCorrientes = gastosCorrientes
      .filter((item) => overlapsMonth(item, fecha))
      .reduce((sum, item) => sum + Number(item.monto) * (FACTOR_FRECUENCIA[item.frecuencia] || 1), 0)

    const totalGastosPuntuales = gastosNoCorrientes
      .filter((item) => occursInMonth(item, fecha))
      .reduce((sum, item) => sum + Number(item.monto), 0)

    const totalDiferidos = diferidos
      .filter((item) => overlapsMonth(item, fecha))
      .reduce((sum, item) => sum + Number(item.cuota_mensual), 0)

    const gastos = roundMoneyNumber(totalGastosCorrientes + totalGastosPuntuales + totalDiferidos)
    const ingresosMes = roundMoneyNumber(totalIngresos + totalIngresosPuntuales)
    return {
      mes,
      ingresos: ingresosMes,
      gastos,
      balance: roundMoneyNumber(ingresosMes - gastos),
    }
  })
}

function construirFlujoBaseDesdeProyeccion(series = [], desiredMonths = series.length) {
  const normalized = series.map((point) => ({
    mes: point.label,
    ingresos: roundMoneyNumber(point.monthly_ingresos || 0),
    gastos: roundMoneyNumber(point.monthly_gastos || 0),
    balance: roundMoneyNumber(point.projected_gap || 0),
  }))

  if (normalized.length === 0 || desiredMonths <= normalized.length) {
    return normalized
  }

  const lastPoint = normalized[normalized.length - 1]
  const extended = [...normalized]
  while (extended.length < desiredMonths) {
    extended.push({ ...lastPoint })
  }
  return extended
}

const EMPTY_FORM = {
  nombre: '',
  monto: '',
  banco: '',
  tasa_anual: '',
  plazo_meses: '12',
  colchon_minimo: getInitialColchonMinimo(),
  fecha_inicio: formatDateLocal(new Date()),
}

function resolveSaldoInicial(responseData) {
  if (!responseData) return 0
  const monto = Number(responseData.monto)
  return Number.isFinite(monto) ? roundMoneyNumber(monto) : 0
}

export default function Simulador() {
  const { user } = useAuth()
  const advancedProjectionEnabled = Boolean(user?.feature_access?.advanced_projection_enabled)
  const advancedProjectionMaxMonths = Number(user?.feature_access?.advanced_projection_months || 60)

  const [bancos, setBancos] = useState([])
  const [simulaciones, setSimulaciones] = useState([])
  const [flujoBase, setFlujoBase] = useState([])
  const [saldoInicial, setSaldoInicial] = useState(0)
  const [simulationProjectionMeta, setSimulationProjectionMeta] = useState({
    mode: advancedProjectionEnabled ? (user?.projection_mode || 'automatica') : 'simple',
    variableProjectionApplied: !advancedProjectionEnabled,
    historyMonthsUsed: 0,
    minVariableHistoryMonths: 3,
  })
  const [form, setForm] = useState(EMPTY_FORM)
  const [resultado, setResultado] = useState(null)

  const [loadingData, setLoadingData] = useState(true)
  const [simulating, setSimulating] = useState(false)
  const [guardando, setGuardando] = useState(false)
  const [agregando, setAgregando] = useState(false)
  const [deletingId, setDeletingId] = useState(null)
  const [confirmDeleteId, setConfirmDeleteId] = useState(null)

  const [diferidoOk, setDiferidoOk] = useState(false)
  const [feedback, setFeedback] = useState({ type: '', message: '' })

  const [query, setQuery] = useState('')
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(10)

  useEffect(() => {
    loadInitialData()
  }, [])

  async function cargarFlujoBase({ monthsNeeded = 24 } = {}) {
    if (advancedProjectionEnabled) {
      const months = Math.min(Math.max(24, monthsNeeded), advancedProjectionMaxMonths)
      const { data } = await api.get(`/finanzas/proyeccion-acumulada/?months=${months}&past_months=${SIMULADOR_PAST_MONTHS}`)
      const projectedSeries = (data.series || []).filter((point) => !point.is_real).slice(0, months)
      const nextSaldoInicial = resolveSaldoInicial({
        monto: projectedSeries[0]?.opening_balance ?? data.starting_balance ?? 0,
      })
      const nextFlujoBase = construirFlujoBaseDesdeProyeccion(projectedSeries, monthsNeeded)
      const nextMeta = {
        mode: data.projection_mode || user?.projection_mode || 'automatica',
        variableProjectionApplied: data.variable_projection_applied !== false,
        historyMonthsUsed: Number(data.history_months_used || 0),
        minVariableHistoryMonths: Number(data.min_variable_history_months || 3),
      }
      setSaldoInicial(nextSaldoInicial)
      setFlujoBase(nextFlujoBase)
      setSimulationProjectionMeta(nextMeta)
      return { flujoBase: nextFlujoBase, saldoInicial: nextSaldoInicial, meta: nextMeta }
    }

    const [ingresosRes, ingresosPuntualesRes, gastosRes, gastosPuntualesRes, diferidosRes, saldoRes] = await Promise.all([
      api.get('/finanzas/ingresos/'),
      api.get('/finanzas/ingresos-puntuales/'),
      api.get('/finanzas/gastos-corrientes/'),
      api.get('/finanzas/gastos-no-corrientes/'),
      api.get('/finanzas/diferidos/'),
      api.get('/finanzas/saldo-mes/actual/'),
    ])
    const nextSaldoInicial = resolveSaldoInicial(saldoRes.data)
    const nextFlujoBase = construirFlujoBaseSimple(
      ingresosRes.data,
      ingresosPuntualesRes.data,
      gastosRes.data,
      gastosPuntualesRes.data,
      diferidosRes.data,
    )
    const nextMeta = {
      mode: 'simple',
      variableProjectionApplied: true,
      historyMonthsUsed: 0,
      minVariableHistoryMonths: 3,
    }
    setSaldoInicial(nextSaldoInicial)
    setFlujoBase(nextFlujoBase)
    setSimulationProjectionMeta(nextMeta)
    return { flujoBase: nextFlujoBase, saldoInicial: nextSaldoInicial, meta: nextMeta }
  }

  async function loadInitialData() {
    setLoadingData(true)
    try {
      const [bancosRes, simulacionesRes] = await Promise.all([
        api.get('/simulador/bancos/'),
        api.get('/simulador/simulaciones/'),
      ])

      setBancos(bancosRes.data)
      setSimulaciones(simulacionesRes.data)
      await cargarFlujoBase({ monthsNeeded: 24 })
      if (!getInitialColchonMinimo() && simulacionesRes.data.length > 0 && Number(simulacionesRes.data[0].colchon_minimo) > 0) {
        setForm((prev) => ({ ...prev, colchon_minimo: String(simulacionesRes.data[0].colchon_minimo) }))
      }
    } catch (err) {
      setFeedback({ type: 'error', message: getApiErrorMessage(err, 'No se pudo cargar el simulador.') })
    } finally {
      setLoadingData(false)
    }
  }

  async function recargarFlujoBase() {
    try {
      await cargarFlujoBase({ monthsNeeded: Math.max(24, Number(form.plazo_meses || 24)) })
    } catch (err) {
      setFeedback({ type: 'error', message: getApiErrorMessage(err, 'No se pudo actualizar el flujo base.') })
    }
  }

  function handleBanco(id) {
    const banco = bancos.find((b) => b.id === Number(id))
    setForm((prev) => ({
      ...prev,
      banco: id,
      tasa_anual: banco ? banco.tasa_anual_minima : prev.tasa_anual,
    }))
  }

  async function simular(e) {
    e.preventDefault()
    if (simulating) return
    setFeedback({ type: '', message: '' })
    setSimulating(true)

    try {
      const monto = Number(form.monto)
      const tasa = Number(form.tasa_anual)
      const plazo = Number(form.plazo_meses)
      const colchonMinimo = Number(form.colchon_minimo)
      if (!monto || monto <= 0 || Number.isNaN(tasa) || tasa < 0 || !plazo || plazo <= 0 || !colchonMinimo || colchonMinimo <= 0) {
        setFeedback({ type: 'error', message: 'Completa monto, tasa, plazo y minimo libre con valores validos.' })
        return
      }
      if (typeof window !== 'undefined') {
        window.localStorage.setItem(COLCHON_STORAGE_KEY, String(colchonMinimo))
      }

      const cuota = roundMoneyNumber(calcularCuota(monto, tasa, plazo))
      const totalPagar = roundMoneyNumber(cuota * plazo)
      const totalIntereses = roundMoneyNumber(totalPagar - monto)

      const hoy = new Date()
      const inicio = parseLocalDate(form.fecha_inicio)
      const finPrestamo = new Date(inicio.getFullYear(), inicio.getMonth() + plazo, 1)

      const horizonMonths = Math.max(24, plazo)
      let currentFlujoBase = flujoBase
      let currentSaldoInicial = saldoInicial

      try {
        const baseData = await cargarFlujoBase({ monthsNeeded: horizonMonths })
        currentFlujoBase = baseData.flujoBase
        currentSaldoInicial = baseData.saldoInicial
      } catch (err) {
        setFeedback({ type: 'error', message: getApiErrorMessage(err, 'No se pudo calcular la base de la simulacion.') })
        return
      }

      let saldoBaseAcumulado = currentSaldoInicial
      let saldoSimAcumulado = currentSaldoInicial

      const flujoConPrestamo = Array.from({ length: horizonMonths }, (_, i) => {
        const fecha = new Date(hoy.getFullYear(), hoy.getMonth() + i, 1)
        const mes = `${MESES[fecha.getMonth()]} ${fecha.getFullYear()}`
        const tieneCuota = fecha >= inicio && fecha < finPrestamo
        const base = currentFlujoBase[i] || { ingresos: 0, gastos: 0, balance: 0 }
        const gastosSim = roundMoneyNumber(base.gastos + (tieneCuota ? cuota : 0))
        const balanceSimMensual = roundMoneyNumber(base.ingresos - gastosSim)
        const saldoBaseInicio = saldoBaseAcumulado
        const saldoSimInicio = saldoSimAcumulado
        const arrastreInicio = saldoSimInicio
        saldoBaseAcumulado = roundMoneyNumber(saldoBaseAcumulado + base.balance)
        saldoSimAcumulado = roundMoneyNumber(saldoSimAcumulado + balanceSimMensual)
        const ingresosVisibles = roundMoneyNumber(base.ingresos + Math.max(arrastreInicio, 0))
        const gastosVisibles = roundMoneyNumber(gastosSim + Math.max(-arrastreInicio, 0))

        return {
          mes,
          ingresos: base.ingresos,
          ingresosVisibles,
          gastosSim,
          gastosVisibles,
          balanceSim: balanceSimMensual,
          balanceBase: base.balance,
          saldoBaseInicio,
          saldoBaseFin: saldoBaseAcumulado,
          saldoSimInicio,
          saldoSimFin: saldoSimAcumulado,
        }
      })

      const mesesConDeficit = flujoConPrestamo.filter((fila) => fila.saldoSimFin < 0)
      const mesesBajoColchon = flujoConPrestamo.filter((fila) => fila.saldoSimFin < colchonMinimo)
      const balanceMinimo = flujoConPrestamo.length > 0
        ? flujoConPrestamo.reduce((min, fila) => Math.min(min, fila.saldoSimFin), flujoConPrestamo[0].saldoSimFin)
        : 0
      const primerMesEnRojo = mesesConDeficit[0]?.mes || null
      const primerMesBajoColchon = mesesBajoColchon[0]?.mes || null

      setResultado({
        cuota,
        totalPagar,
        totalIntereses,
        flujoConPrestamo,
        mesesConDeficit,
        mesesBajoColchon,
        colchonMinimo,
        balanceMinimo,
        primerMesEnRojo,
        primerMesBajoColchon,
        horizonMonths,
        saldoInicial: currentSaldoInicial,
        factible: mesesConDeficit.length === 0 && mesesBajoColchon.length === 0,
      })
    } finally {
      setSimulating(false)
    }
  }

  async function guardarSimulacion() {
    if (!resultado || guardando) return
    setGuardando(true)
    setFeedback({ type: '', message: '' })
    try {
      await api.post('/simulador/simulaciones/', {
        nombre: form.nombre,
        monto: form.monto,
        banco: form.banco || null,
        tasa_anual: form.tasa_anual,
        plazo_meses: form.plazo_meses,
        colchon_minimo: form.colchon_minimo,
        cuota_mensual: resultado.cuota.toFixed(2),
        total_a_pagar: resultado.totalPagar.toFixed(2),
        total_intereses: resultado.totalIntereses.toFixed(2),
        fecha_inicio: form.fecha_inicio,
      })

      const { data } = await api.get('/simulador/simulaciones/')
      setSimulaciones(data)
      setFeedback({ type: 'success', message: 'Simulacion guardada correctamente.' })
    } catch (err) {
      setFeedback({ type: 'error', message: getApiErrorMessage(err, 'No se pudo guardar la simulacion.') })
    } finally {
      setGuardando(false)
    }
  }

  async function agregarComoDiferido() {
    if (!resultado || agregando) return
    setAgregando(true)
    setFeedback({ type: '', message: '' })

    try {
      const ini = parseLocalDate(form.fecha_inicio)
      const fin = new Date(ini.getFullYear(), ini.getMonth() + (Number(form.plazo_meses) - 1), ini.getDate())

      await api.post('/finanzas/diferidos/', {
        descripcion: form.nombre,
        categoria: 'otro',
        monto_total: form.monto,
        num_cuotas: form.plazo_meses,
        cuota_mensual: resultado.cuota.toFixed(2),
        fecha_inicio: form.fecha_inicio,
        fecha_fin: formatDateLocal(fin),
        activo: true,
      })

      await recargarFlujoBase()
      setDiferidoOk(true)
      setFeedback({ type: 'success', message: 'Gasto a cuotas agregado a tu plan.' })
      setTimeout(() => setDiferidoOk(false), 3500)
    } catch (err) {
      setFeedback({ type: 'error', message: getApiErrorMessage(err, 'No se pudo agregar el gasto a cuotas.') })
    } finally {
      setAgregando(false)
    }
  }

  function openDeleteConfirm(id) {
    if (deletingId) return
    setConfirmDeleteId(id)
  }

  async function eliminarSimulacion() {
    const id = confirmDeleteId
    if (!id || deletingId) return
    setConfirmDeleteId(null)
    setDeletingId(id)
    setFeedback({ type: '', message: '' })
    try {
      await api.delete(`/simulador/simulaciones/${id}/`)
      setSimulaciones((prev) => prev.filter((item) => item.id !== id))
      setFeedback({ type: 'success', message: 'Simulacion eliminada correctamente.' })
    } catch (err) {
      setFeedback({ type: 'error', message: getApiErrorMessage(err, 'No se pudo eliminar la simulacion.') })
    } finally {
      setDeletingId(null)
    }
  }

  const moneda = user?.moneda_preferida || 'USD'
  const fmt = (value) => formatMoney(value, { currency: moneda })
  const simulationModeLabel = PROJECTION_MODE_LABELS[simulationProjectionMeta.mode] || 'Simple'
  const simulationModeNote = advancedProjectionEnabled
    ? `Usa tu modo actual de proyeccion: ${simulationModeLabel}.`
    : 'Usa una lectura simple de tu flujo actual.'

  const filteredSimulaciones = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return simulaciones

    return simulaciones.filter((s) => (
      s.nombre.toLowerCase().includes(q)
      || (s.banco_nombre || '').toLowerCase().includes(q)
      || String(s.monto).toLowerCase().includes(q)
      || String(s.plazo_meses).toLowerCase().includes(q)
      || String(s.colchon_minimo || '').toLowerCase().includes(q)
    ))
  }, [simulaciones, query])

  const pageCount = Math.max(1, Math.ceil(filteredSimulaciones.length / pageSize))
  const safePage = Math.min(page, pageCount)
  const start = (safePage - 1) * pageSize
  const paginatedSimulaciones = filteredSimulaciones.slice(start, start + pageSize)

  return (
    <div>
      <div className="page-header">
        <h1 className="page-title">Simulador de prestamos</h1>
        <p className="page-subtitle">Mira si una cuota te cabe antes de tomarla.</p>
        <p className="dashboard-chart-note" style={{ marginTop: 6 }}>
          {simulationModeNote}
          {advancedProjectionEnabled && !simulationProjectionMeta.variableProjectionApplied
            ? ` Aun no hay suficientes extras para meter variable futura, asi que usa tu base fija.`
            : ''}
        </p>
      </div>

      <FeedbackAlert type={feedback.type || 'error'} message={feedback.message} />

      {loadingData ? (
        <div className="card" style={{ textAlign: 'center', padding: 32, color: 'rgba(255,255,255,0.45)' }}>
          Cargando simulador...
        </div>
      ) : (
        <>
          <div className="simulador-main-grid">
            <div className="card">
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 20 }}>
                <Calculator size={18} style={{ color: '#C487F6' }} />
                <h2 style={{ fontWeight: 700, fontSize: 15 }}>Haz una simulacion</h2>
              </div>

              <form onSubmit={simular}>
                <div className="form-modal-group">
                  <label className="form-modal-label">Que quieres financiar?</label>
                  <input
                    className="form-modal-input"
                    required
                    placeholder="Ej: telefono, moto, viaje"
                    value={form.nombre}
                    onChange={(e) => setForm({ ...form, nombre: e.target.value })}
                  />
                </div>

                <div className="form-modal-group">
                  <label className="form-modal-label">Monto</label>
                  <input
                    className="form-modal-input"
                    type="number"
                    required
                    min="1"
                    step="0.01"
                    placeholder="0"
                    value={form.monto}
                    onChange={(e) => setForm({ ...form, monto: e.target.value })}
                  />
                </div>

                <div className="form-modal-group">
                  <label className="form-modal-label">Banco <span>(opcional)</span></label>
                  <select className="form-modal-select" value={form.banco} onChange={(e) => handleBanco(e.target.value)}>
                    <option value="">- Sin banco -</option>
                    {bancos.map((b) => (
                      <option key={b.id} value={b.id}>{b.nombre} ({b.tasa_anual_minima}% - {b.tasa_anual_maxima}% anual)</option>
                    ))}
                  </select>
                </div>

                <div className="form-modal-row">
                  <div className="form-modal-group">
                    <label className="form-modal-label">Tasa anual (%)</label>
                    <input
                      className="form-modal-input"
                      type="number"
                      required
                      min="0"
                      step="0.01"
                      placeholder="8.5"
                      value={form.tasa_anual}
                      onChange={(e) => setForm({ ...form, tasa_anual: e.target.value })}
                    />
                  </div>

                  <div className="form-modal-group">
                    <label className="form-modal-label">Plazo (meses)</label>
                    <input
                      className="form-modal-input"
                      type="number"
                      required
                      min="1"
                      max="360"
                      placeholder="12"
                      value={form.plazo_meses}
                      onChange={(e) => setForm({ ...form, plazo_meses: e.target.value })}
                    />
                  </div>
                </div>

                <div className="form-modal-group">
                  <label className="form-modal-label">Minimo libre que quieres dejar al mes</label>
                  <input
                    className="form-modal-input"
                    type="number"
                    required
                    min="1"
                    step="0.01"
                    placeholder="Ej: 300"
                    value={form.colchon_minimo}
                    onChange={(e) => setForm({ ...form, colchon_minimo: e.target.value })}
                  />
                  <p style={{ marginTop: 6, fontSize: 11, color: 'rgba(255,255,255,0.45)' }}>
                    Es tu piso de tranquilidad despues de gastos y cuota.
                  </p>
                </div>

                <div className="form-modal-group">
                  <label className="form-modal-label">Empieza en</label>
                  <div className="date-input-wrap">
                    <input
                      className="form-modal-input"
                      type="date"
                      required
                      min={DATE_INPUT_MIN}
                      max={DATE_INPUT_MAX}
                      value={form.fecha_inicio}
                      onChange={(e) => setForm({ ...form, fecha_inicio: e.target.value })}
                    />
                  </div>
                  <DateQuickActions value={form.fecha_inicio} onChange={(value) => setForm({ ...form, fecha_inicio: value })} disabled={agregando || simulating} />
                </div>

                <button type="submit" className="btn-modal-save" disabled={simulating} style={{ width: '100%', padding: '12px 0', marginTop: 4 }}>
                  {simulating ? 'Simulando...' : 'Simular'}
                </button>
              </form>
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
              {resultado ? (
                <>
                  <div
                    className="card"
                    style={{
                      padding: 20,
                      background: resultado.factible ? 'rgba(16,185,129,0.08)' : 'rgba(248,113,113,0.08)',
                      border: `1px solid ${resultado.factible ? 'rgba(16,185,129,0.25)' : 'rgba(248,113,113,0.25)'}`,
                    }}
                  >
                    <div className="sim-result-status">
                      {resultado.factible
                        ? <CheckCircle size={36} style={{ color: '#10B981', flexShrink: 0 }} />
                        : <XCircle size={36} style={{ color: '#F87171', flexShrink: 0 }} />}
                      <div>
                        <p style={{ fontWeight: 800, fontSize: 18, color: resultado.factible ? '#10B981' : '#F87171' }}>
                          {resultado.factible ? 'Te alcanza' : 'No te alcanza'}
                        </p>
                          <p style={{ color: 'rgba(255,255,255,0.50)', fontSize: 13 }}>
                            {resultado.factible
                            ? `Esta cuota mantiene tu saldo acumulado por encima de ${fmt(resultado.colchonMinimo)} durante toda la proyeccion.`
                            : resultado.mesesConDeficit.length > 0
                              ? `No te alcanza: ${resultado.mesesConDeficit.length} mes(es) quedarian en negativo. El primero seria ${resultado.primerMesEnRojo}.`
                              : `No te alcanza: ${resultado.mesesBajoColchon.length} mes(es) quedarian por debajo de tu minimo libre acumulado. El primero seria ${resultado.primerMesBajoColchon}.`}
                          </p>
                      </div>
                    </div>
                  </div>

                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 12 }}>
                    {[
                      { label: 'Saldo inicial', value: fmt(resultado.saldoInicial), color: '#C487F6' },
                      { label: 'Cuota al mes', value: fmt(resultado.cuota), color: '#FFFFFF' },
                      { label: 'Total', value: fmt(resultado.totalPagar), color: '#F87171' },
                      { label: 'Intereses', value: fmt(resultado.totalIntereses), color: '#C487F6' },
                      { label: 'Minimo libre', value: fmt(resultado.colchonMinimo), color: '#FBBF24' },
                      {
                        label: 'Saldo acumulado mas bajo',
                        value: fmt(resultado.balanceMinimo),
                        color: resultado.balanceMinimo >= resultado.colchonMinimo ? '#10B981' : '#F87171',
                      },
                    ].map((stat) => (
                      <div key={stat.label} className="card" style={{ padding: 16, textAlign: 'center' }}>
                        <p style={{ fontSize: 11, color: 'rgba(255,255,255,0.40)', marginBottom: 6 }}>{stat.label}</p>
                        <p style={{ fontWeight: 700, color: stat.color, fontSize: 14 }}>{stat.value}</p>
                      </div>
                    ))}
                  </div>

                  <button
                    onClick={guardarSimulacion}
                    disabled={guardando}
                    className="btn-modal-cancel"
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      gap: 8,
                      width: '100%',
                      padding: '12px 0',
                      border: '1.5px solid rgba(196,135,246,0.30)',
                      color: '#C487F6',
                    }}
                  >
                    <Save size={16} /> {guardando ? 'Guardando...' : 'Guardar simulacion'}
                  </button>

                  {resultado.factible && (
                    diferidoOk ? (
                      <div
                        style={{
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          gap: 8,
                          padding: '12px 0',
                          background: 'rgba(16,185,129,0.10)',
                          border: '1.5px solid rgba(16,185,129,0.25)',
                          borderRadius: 12,
                          color: '#10B981',
                          fontSize: 14,
                          fontWeight: 600,
                        }}
                      >
                        <CheckCircle size={16} /> Ya quedo en gastos a cuotas.
                      </div>
                    ) : (
                      <button
                        onClick={agregarComoDiferido}
                        disabled={agregando}
                        className="btn-modal-save"
                        style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, width: '100%', padding: '12px 0' }}
                      >
                        <CreditCard size={16} /> {agregando ? 'Agregando...' : 'Agregar como gasto a cuotas'}
                      </button>
                    )
                  )}
                </>
              ) : (
                <div
                  className="card"
                  style={{
                    display: 'flex',
                    flexDirection: 'column',
                    alignItems: 'center',
                    justifyContent: 'center',
                    minHeight: 300,
                    color: 'rgba(255,255,255,0.25)',
                  }}
                >
                  <p style={{ fontSize: 14 }}>Completa arriba y toca Simular</p>
                </div>
              )}
            </div>
          </div>

          {resultado && (
            <div className="card" style={{ marginBottom: 20 }}>
              <div className="card-header">
                <h2 className="card-title">Flujo con prestamo · 24 meses</h2>
              </div>
              <div style={{ marginBottom: 14, fontSize: 12, color: 'rgba(255,255,255,0.50)' }}>
                La curva incorpora tu saldo inicial como arrastre visible: saldo positivo suma a ingresos y saldo negativo carga a egresos.
              </div>
              <ResponsiveContainer width="100%" height={280}>
                <AreaChart data={resultado.flujoConPrestamo} margin={{ top: 5, right: 10, left: 10, bottom: 0 }}>
                  <defs>
                    <linearGradient id="gSimIng" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="#10B981" stopOpacity={0.35} />
                      <stop offset="95%" stopColor="#10B981" stopOpacity={0} />
                    </linearGradient>
                    <linearGradient id="gSimGas" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="#F87171" stopOpacity={0.35} />
                      <stop offset="95%" stopColor="#F87171" stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.06)" />
                  <XAxis dataKey="mes" tick={{ fill: 'rgba(255,255,255,0.35)', fontSize: 11 }} />
                  <YAxis tick={{ fill: 'rgba(255,255,255,0.35)', fontSize: 11 }} tickFormatter={(v) => fmt(v)} width={90} />
                  <Tooltip
                    contentStyle={{ background: 'rgba(26,37,64,0.95)', border: '1px solid rgba(196,135,246,0.2)', borderRadius: 12 }}
                    labelStyle={{ color: '#FFFFFF', marginBottom: 4, fontWeight: 700 }}
                    formatter={(v, n) => [
                      fmt(v),
                      n === 'ingresosVisibles'
                        ? 'Ingresos + arrastre'
                        : 'Egresos + cuotas + arrastre',
                    ]}
                  />
                  <Legend formatter={(v) => (
                    v === 'ingresosVisibles' ? 'Ingresos + arrastre' : 'Egresos + cuotas + arrastre'
                  )} />
                  <ReferenceLine y={0} stroke="rgba(255,255,255,0.20)" strokeDasharray="4 4" />
                  <ReferenceLine
                    y={resultado.colchonMinimo}
                    stroke="#FBBF24"
                    strokeDasharray="6 4"
                    label={{ value: 'Minimo libre', fill: '#FBBF24', position: 'right', fontSize: 11 }}
                  />
                  <Area type="monotone" dataKey="ingresosVisibles" stroke="#10B981" fill="url(#gSimIng)" strokeWidth={2.5} />
                  <Area type="monotone" dataKey="gastosVisibles" stroke="#F87171" fill="url(#gSimGas)" strokeWidth={2.5} />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          )}

          <div className="card" style={{ padding: 0 }}>
            <div className="card-header" style={{ padding: '18px 24px 0' }}>
              <h2 className="card-title">Simulaciones guardadas</h2>
            </div>

            {simulaciones.length === 0 ? (
              <div className="empty-state" style={{ paddingBottom: 26 }}>
                <p className="empty-text">Aun no guardas simulaciones</p>
                <p className="empty-sub">Simula algo y guardalo para compararlo despues.</p>
              </div>
            ) : (
              <>
                <ListControls
                  query={query}
                  onQueryChange={(value) => { setQuery(value); setPage(1) }}
                  placeholder="Buscar por nombre, banco o minimo..."
                  page={safePage}
                  pageCount={pageCount}
                  onPrevPage={() => setPage((prev) => Math.max(1, prev - 1))}
                  onNextPage={() => setPage((prev) => Math.min(pageCount, prev + 1))}
                  pageSize={pageSize}
                  onPageSizeChange={(size) => { setPageSize(size); setPage(1) }}
                  totalItems={simulaciones.length}
                  filteredItems={filteredSimulaciones.length}
                />

                <div className="table-wrap" style={{ border: 'none' }}>
                  <table className="table">
                    <thead>
                      <tr>{['Nombre', 'Monto', 'Banco', 'Tasa', 'Plazo', 'Colchon', 'Cuota', ''].map((h) => <th key={h}>{h}</th>)}</tr>
                    </thead>
                    <tbody>
                      {paginatedSimulaciones.map((s) => (
                        <tr key={s.id}>
                          <td style={{ fontWeight: 600 }}>{s.nombre}</td>
                          <td>{fmt(s.monto)}</td>
                          <td>{s.banco_nombre || '-'}</td>
                          <td>{s.tasa_anual}%</td>
                          <td>{s.plazo_meses} m</td>
                          <td>{s.colchon_minimo ? fmt(s.colchon_minimo) : '-'}</td>
                          <td className="table-amount positive">{fmt(s.cuota_mensual)}</td>
                          <td className="table-actions-cell">
                            <button
                              className="btn-icon danger"
                              disabled={deletingId === s.id}
                              onClick={() => openDeleteConfirm(s.id)}
                            >
                              <Trash2 size={15} />
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </>
            )}
          </div>
        </>
      )}

      <ConfirmDialog
        open={confirmDeleteId !== null}
        title="Eliminar simulacion"
        message="Esta simulacion se eliminara de tu historial guardado."
        confirmText="Eliminar"
        cancelText="Cancelar"
        loading={deletingId !== null}
        onConfirm={eliminarSimulacion}
        onClose={() => setConfirmDeleteId(null)}
      />
    </div>
  )
}
