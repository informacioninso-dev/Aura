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
    <div className="list-controls">
      <input
        className="form-modal-input list-controls-search"
        value={query}
        onChange={(e) => onQueryChange(e.target.value)}
        placeholder={placeholder}
      />

      <div className="list-controls-meta">
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
        <span className="list-controls-page">
          {page}/{pageCount}
        </span>
        <button className="btn-modal-cancel" onClick={onNextPage} disabled={page >= pageCount} style={{ padding: '8px 10px' }}>
          Siguiente
        </button>
      </div>
    </div>
  )
}
