import {
  CartesianGrid,
  Line,
  LineChart,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'

import { formatMoney } from '../../utils/formatters'

export default function SimulationBalanceChart({ data, decisionStartPoint, currency, formatValue }) {
  return (
    <ResponsiveContainer width="100%" height="100%">
      <LineChart data={data} margin={{ top: 18, right: 8, left: 0, bottom: 0 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="rgba(var(--app-ink-rgb),0.06)" />
        {decisionStartPoint && (
          <ReferenceLine
            x={decisionStartPoint.label}
            stroke="var(--app-danger)"
            strokeDasharray="4 4"
            label={{ value: 'Empieza el gasto', position: 'insideTopRight', fill: '#FCA5A5', fontSize: 10 }}
          />
        )}
        <XAxis dataKey="label" minTickGap={34} tick={{ fill: 'rgba(var(--app-ink-rgb),0.40)', fontSize: 10 }} />
        <YAxis
          width={66}
          tick={{ fill: 'rgba(var(--app-ink-rgb),0.40)', fontSize: 10 }}
          tickFormatter={(value) => formatMoney(value, {
            currency,
            notation: 'compact',
            minimumFractionDigits: 0,
            maximumFractionDigits: 1,
          })}
        />
        <Tooltip
          contentStyle={{ background: 'var(--app-popover)', border: '1px solid rgba(196,135,246,0.22)', borderRadius: 12 }}
          labelStyle={{ color: 'var(--app-text)', fontWeight: 700 }}
          labelFormatter={(label) => `Al cerrar ${label}`}
          formatter={(value, name) => [formatValue(value), name]}
        />
        <Line name="Dinero sin este gasto" type="monotone" dataKey="saldo_base" stroke="var(--app-green)" strokeWidth={2.2} dot={false} />
        <Line name="Dinero incluyendo este gasto" type="monotone" dataKey="saldo_escenario" stroke="var(--app-danger)" strokeWidth={2.8} dot={false} />
      </LineChart>
    </ResponsiveContainer>
  )
}