export default function ListControls({
  query,
  onQueryChange,
  placeholder = 'Buscar...',
  page,
  pageCount,
  onPrevPage,
  onNextPage,
  pageSize,
  onPageSizeChange,
  totalItems,
  filteredItems,
}) {
  return (
    <div
      style={{
        display: 'flex',
        gap: 10,
        alignItems: 'center',
        justifyContent: 'space-between',
        flexWrap: 'wrap',
        padding: '14px 20px 8px',
      }}
    >
      <input
        className="form-modal-input"
        value={query}
        onChange={(e) => onQueryChange(e.target.value)}
        placeholder={placeholder}
        style={{ maxWidth: 280 }}
      />

      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
        <span style={{ fontSize: 12, color: 'rgba(255,255,255,0.45)' }}>
          {filteredItems} de {totalItems}
        </span>
        <select
          className="form-modal-select"
          value={pageSize}
          onChange={(e) => onPageSizeChange(Number(e.target.value))}
          style={{ width: 86, padding: '8px 10px' }}
        >
          {[5, 10, 20, 50].map((n) => (
            <option key={n} value={n}>{n}/pág</option>
          ))}
        </select>
        <button className="btn-modal-cancel" onClick={onPrevPage} disabled={page <= 1} style={{ padding: '8px 10px' }}>
          Anterior
        </button>
        <span style={{ fontSize: 12, color: 'rgba(255,255,255,0.45)', minWidth: 68, textAlign: 'center' }}>
          {page}/{pageCount}
        </span>
        <button className="btn-modal-cancel" onClick={onNextPage} disabled={page >= pageCount} style={{ padding: '8px 10px' }}>
          Siguiente
        </button>
      </div>
    </div>
  )
}
