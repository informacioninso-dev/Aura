import { ChevronLeft, ChevronRight, Search } from 'lucide-react'

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
  sortField,
  sortDir,
  onSortChange,
  sortOptions,
}) {
  function handleSort(value) {
    if (!onSortChange) return
    onSortChange(value, sortField === value && sortDir === 'desc' ? 'asc' : 'desc')
  }

  return (
    <div className="list-controls">

      {/* Fila 1 — buscador full width */}
      <div className="list-controls-search-wrap">
        <Search size={14} className="list-controls-search-icon" />
        <input
          className="list-controls-search"
          value={query}
          onChange={(e) => onQueryChange(e.target.value)}
          placeholder={placeholder}
        />
      </div>

      {/* Fila 2 — sort + paginación */}
      <div className="list-controls-bar">
        <div className="list-controls-sort">
          {sortOptions?.map(({ value, label }) => {
            const active = sortField === value
            return (
              <button
                key={value}
                type="button"
                className={`list-sort-btn ${active ? 'active' : ''}`}
                onClick={() => handleSort(value)}
              >
                {label}
                {active && <span className="list-sort-arrow">{sortDir === 'asc' ? ' ↑' : ' ↓'}</span>}
              </button>
            )
          })}
        </div>

        <div className="list-controls-right">
          <span className="list-controls-count">
            {filteredItems !== totalItems ? `${filteredItems} de ${totalItems}` : `${totalItems} reg.`}
          </span>
          <select
            className="list-controls-pagesize"
            value={pageSize}
            onChange={(e) => onPageSizeChange(Number(e.target.value))}
          >
            {[5, 10, 20, 50].map((n) => (
              <option key={n} value={n}>{n} / pág</option>
            ))}
          </select>
          <div className="list-controls-pager">
            <button type="button" className="list-nav-btn" onClick={onPrevPage} disabled={page <= 1}>
              <ChevronLeft size={15} />
            </button>
            <span className="list-controls-page">{page} / {pageCount}</span>
            <button type="button" className="list-nav-btn" onClick={onNextPage} disabled={page >= pageCount}>
              <ChevronRight size={15} />
            </button>
          </div>
        </div>
      </div>

    </div>
  )
}
