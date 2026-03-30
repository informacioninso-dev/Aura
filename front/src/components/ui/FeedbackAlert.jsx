export default function FeedbackAlert({ type = 'error', message }) {
  if (!message) return null

  const palette = type === 'success'
    ? {
        bg: 'rgba(16,185,129,0.10)',
        border: '1px solid rgba(16,185,129,0.25)',
        color: '#10B981',
      }
    : {
        bg: 'rgba(248,113,113,0.10)',
        border: '1px solid rgba(248,113,113,0.25)',
        color: '#FCA5A5',
      }

  return (
    <div
      style={{
        background: palette.bg,
        border: palette.border,
        color: palette.color,
        borderRadius: 12,
        padding: '12px 16px',
        fontSize: 13,
        marginBottom: 16,
      }}
    >
      {message}
    </div>
  )
}
