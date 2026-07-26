import { ChevronDown, ChevronLeft, ChevronRight, ChevronUp, Search } from 'lucide-react'

export default function ListControls({
  children,
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
  showSearch = true,
  showSort = true,
  showPagination = true,
}) {
  function handleSort(value) {
    if (!onSortChange) return
    onSortChange(value, sortField === value && sortDir === 'desc' ? 'asc' : 'desc')
  }

  return (
    <div className="list-controls">
      {children ? (
        <div style={{ display: 'flex', justifyContent: 'center' }}>
          {children}
        </div>
      ) : null}

      {showSearch && (
        <div className="list-controls-search-wrap">
          <Search size={14} className="list-controls-search-icon" />
          <input
            className="list-controls-search"
            value={query}
            onChange={(e) => onQueryChange(e.target.value)}
            placeholder={placeholder}
          />
        </div>
      )}

      {(showSort || showPagination) && (
        <div className="list-controls-bar">
          <div className="list-controls-sort">
            {showSort && sortOptions?.map(({ value, label }) => {
              const active = sortField === value
              return (
                <button
                  key={value}
                  type="button"
                  className={`list-sort-btn ${active ? 'active' : ''}`}
                  onClick={() => handleSort(value)}
                >
                  {label}
                  {active && (
                    <span className="list-sort-arrow" aria-hidden="true">
                      {sortDir === 'asc' ? <ChevronUp size={13} /> : <ChevronDown size={13} />}
                    </span>
                  )}
                </button>
              )
            })}
          </div>

          {showPagination && (
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
                  <option key={n} value={n}>{n} / pag.</option>
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
          )}
        </div>
      )}
    </div>
  )
}
