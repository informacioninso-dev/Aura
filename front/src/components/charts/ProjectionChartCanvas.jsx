import {
  Area,
  AreaChart,
  CartesianGrid,
  Legend,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'

export default function ProjectionChartCanvas({
  data,
  height,
  compact = false,
  full = false,
  currentMonthLabel,
  formatAxis,
  renderTooltip,
  renderLegend,
  showIncome,
  showExpense,
}) {
  const suffix = full ? 'F' : ''
  const fontSize = full ? 10 : 11
  const incomeRealGradient = `gIngReal${suffix}`
  const incomeProjectedGradient = `gIngProj${suffix}`
  const expenseRealGradient = `gGastoReal${suffix}`
  const expenseProjectedGradient = `gGastoProj${suffix}`

  return (
    <ResponsiveContainer width="100%" height={height}>
      <AreaChart data={data} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
        <defs>
          <linearGradient id={incomeRealGradient} x1="0" y1="0" x2="0" y2="1">
            <stop offset="5%" stopColor="var(--app-green)" stopOpacity={0.25} />
            <stop offset="95%" stopColor="var(--app-green)" stopOpacity={0} />
          </linearGradient>
          <linearGradient id={incomeProjectedGradient} x1="0" y1="0" x2="0" y2="1">
            <stop offset="5%" stopColor="var(--app-green)" stopOpacity={0.10} />
            <stop offset="95%" stopColor="var(--app-green)" stopOpacity={0} />
          </linearGradient>
          <linearGradient id={expenseRealGradient} x1="0" y1="0" x2="0" y2="1">
            <stop offset="5%" stopColor="var(--app-danger)" stopOpacity={0.25} />
            <stop offset="95%" stopColor="var(--app-danger)" stopOpacity={0} />
          </linearGradient>
          <linearGradient id={expenseProjectedGradient} x1="0" y1="0" x2="0" y2="1">
            <stop offset="5%" stopColor="var(--app-danger)" stopOpacity={0.10} />
            <stop offset="95%" stopColor="var(--app-danger)" stopOpacity={0} />
          </linearGradient>
        </defs>
        <CartesianGrid strokeDasharray="3 3" stroke="rgba(var(--app-ink-rgb),0.06)" />
        <XAxis
          dataKey="label"
          interval={full ? 'preserveStartEnd' : undefined}
          tick={{ fill: 'rgba(var(--app-ink-rgb),0.35)', fontSize }}
        />
        <YAxis tick={{ fill: 'rgba(var(--app-ink-rgb),0.35)', fontSize: 11 }} tickFormatter={formatAxis} width={82} />
        {currentMonthLabel && (
          <ReferenceLine
            x={currentMonthLabel}
            stroke="rgba(var(--app-ink-rgb),0.25)"
            strokeDasharray="4 4"
            label={{ value: 'Hoy', position: 'insideTopRight', fill: 'rgba(var(--app-ink-rgb),0.40)', fontSize: 11 }}
          />
        )}
        <ReferenceLine y={0} stroke="rgba(248,113,113,0.35)" strokeDasharray="4 3" />
        <Tooltip
          content={renderTooltip}
          contentStyle={{ background: 'var(--app-popover)', border: '1px solid rgba(196,135,246,0.2)', borderRadius: 12 }}
          labelStyle={{ color: 'var(--app-text)', marginBottom: 6, fontWeight: 700 }}
        />
        {(!compact || full) && <Legend content={renderLegend} />}
        {showIncome && (
          <>
            <Area connectNulls={false} type="monotone" dataKey="ing_real" stroke="var(--app-green)" strokeWidth={full ? 2 : 2.5} fill={`url(#${incomeRealGradient})`} dot={false} />
            <Area connectNulls={false} type="monotone" dataKey="ing_proj" stroke="var(--app-green)" strokeWidth={full ? 1.5 : 2} fill={`url(#${incomeProjectedGradient})`} strokeDasharray="5 4" dot={false} />
          </>
        )}
        {showExpense && (
          <>
            <Area connectNulls={false} type="monotone" dataKey="gasto_real" stroke="var(--app-danger)" strokeWidth={full ? 2 : 2.5} fill={`url(#${expenseRealGradient})`} dot={false} />
            <Area connectNulls={false} type="monotone" dataKey="gasto_proj" stroke="var(--app-danger)" strokeWidth={full ? 1.5 : 2} fill={`url(#${expenseProjectedGradient})`} strokeDasharray="5 4" dot={false} />
          </>
        )}
      </AreaChart>
    </ResponsiveContainer>
  )
}