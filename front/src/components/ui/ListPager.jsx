import { ChevronLeft, ChevronRight } from 'lucide-react'

/**
 * Paginacion para el pie de una lista (la paginacion no va en la cabecera).
 * Reusa las clases de list-controls. Se oculta solo si hay una sola pagina
 * y pocos registros, para no ensuciar listas cortas.
 */
export default function ListPager({
  page,
  pageCount,
  onPrevPage,
  onNextPage,
  pageSize,
  onPageSizeChange,
  totalItems,
  filteredItems,
}) {
  if (pageCount <= 1 && (filteredItems ?? totalItems) <= (pageSize ?? 10)) return null

  return (
    <div className="list-pager">
      <span className="list-controls-count">
        {filteredItems !== totalItems ? `${filteredItems} de ${totalItems}` : `${totalItems} reg.`}
      </span>
      {onPageSizeChange && (
        <select
          className="list-controls-pagesize"
          value={pageSize}
          onChange={(e) => onPageSizeChange(Number(e.target.value))}
        >
          {[5, 10, 20, 50].map((n) => (
            <option key={n} value={n}>{n} / pag.</option>
          ))}
        </select>
      )}
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
  )
}
