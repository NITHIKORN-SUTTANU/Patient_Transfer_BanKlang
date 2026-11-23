export function PaginationControls({
  totalItems,
  pageSize = 50,
  page,
  onPageChange,
  label = 'การแบ่งหน้าตาราง',
}: {
  totalItems: number
  pageSize?: number
  page: number
  onPageChange: (nextPage: number) => void
  label?: string
}) {
  const totalPages = Math.max(1, Math.ceil(totalItems / pageSize))
  if (totalItems <= pageSize) return null
  const safePage = Math.min(Math.max(1, page), totalPages)
  const start = (safePage - 1) * pageSize + 1
  const end = Math.min(totalItems, safePage * pageSize)

  return (
    <nav className="service-pagination" aria-label={label}>
      <span className="service-pagination-summary">
        แสดง {start}–{end} จาก {totalItems} รายการ (หน้า {safePage}/{totalPages})
      </span>
      <div className="service-pagination-actions">
        <button
          type="button"
          className="booking-button booking-secondary service-pagination-btn"
          disabled={safePage <= 1}
          onClick={() => onPageChange(safePage - 1)}
        >
          ← ก่อนหน้า
        </button>
        <button
          type="button"
          className="booking-button booking-secondary service-pagination-btn"
          disabled={safePage >= totalPages}
          onClick={() => onPageChange(safePage + 1)}
        >
          ถัดไป →
        </button>
      </div>
    </nav>
  )
}
