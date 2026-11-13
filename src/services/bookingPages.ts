export interface BookingPage<T> { bookings: T[]; nextCursor?: string | null }

// Rebuild the loaded range on refresh so stale rows disappear after reassignment,
// completion or scope changes. Publish only a complete successful range.
export async function bookingPages<T extends { id: string }>(request: <R>(path: string) => Promise<R>, path: string, pages: number) {
  const rows = new Map<string, T>()
  let cursor: string | null | undefined
  const seen = new Set<string>()
  for (let page = 0; page < pages; page++) {
    const result = await request<BookingPage<T>>(path + (cursor ? `?cursor=${encodeURIComponent(cursor)}` : ''))
    for (const row of result.bookings) rows.set(row.id, row)
    cursor = result.nextCursor
    if (!cursor) break
    if (seen.has(cursor)) throw new Error('Repeated booking cursor')
    seen.add(cursor)
  }
  return { bookings: [...rows.values()], hasMore: !!cursor }
}
