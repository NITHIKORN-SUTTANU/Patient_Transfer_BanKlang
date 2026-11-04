import { useEffect, useId, useRef, useState } from 'react'

type Place = { geometry: { coordinates: [number, number] }; properties: Record<string, string> }
const placeName = (place: Place) => [...new Set([place.properties.name, place.properties.street, place.properties.city, place.properties.state, place.properties.country].filter(Boolean))].join(' · ') || 'เลือกสถานที่นี้'

export function PlaceSearch({ latitude, longitude, onSelect }: { latitude: number; longitude: number; onSelect: (latitude: number, longitude: number, label?: string) => void }) {
  const listId = useId()
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<Place[]>([])
  const [open, setOpen] = useState(false)
  const [active, setActive] = useState(-1)
  const [searching, setSearching] = useState(false)
  const [error, setError] = useState('')
  const [composing, setComposing] = useState(false)
  const bias = useRef({ latitude, longitude })
  const cache = useRef(new Map<string, Place[]>())
  useEffect(() => { bias.current = { latitude, longitude } }, [latitude, longitude])
  useEffect(() => {
    if (!open || composing || query.trim().length < 2) return
    const controller = new AbortController()
    const timer = window.setTimeout(async () => {
      setSearching(true)
      setError('')
      try {
        const { latitude: lat, longitude: lon } = bias.current
        const key = `${query.trim()}|${lat.toFixed(2)}|${lon.toFixed(2)}`
        let places = cache.current.get(key)
        if (!places) {
          const url = new URL(import.meta.env.VITE_MAP_SEARCH_URL || 'https://photon.komoot.io/api/')
          // Photon's public service supports local names via 'default', but rejects 'th'.
          url.search = new URLSearchParams({ q: query.trim().normalize('NFC'), lang: 'default', countrycode: 'TH', limit: '5', lat: String(lat), lon: String(lon) }).toString()
          const response = await fetch(url, { signal: AbortSignal.any([controller.signal, AbortSignal.timeout(12000)]) })
          if (!response.ok) throw new Error('Search failed')
          const data = await response.json() as { features: Place[] }
          places = data.features.filter(place => Number.isFinite(place.geometry?.coordinates?.[0]) && Number.isFinite(place.geometry?.coordinates?.[1]))
          if (controller.signal.aborted) return
          if (cache.current.size >= 30) cache.current.clear()
          cache.current.set(key, places)
        }
        if (controller.signal.aborted) return
        setResults(places)
        if (!places.length) setError('ไม่พบสถานที่ ลองใช้ชื่อหมู่บ้าน วัด หรือโรงพยาบาลใกล้เคียง')
      } catch {
        if (!controller.signal.aborted) setError('ค้นหาไม่สำเร็จ กรุณาลองพิมพ์อีกครั้ง หรือเลือกจุดบนแผนที่')
      } finally { if (!controller.signal.aborted) setSearching(false) }
    }, 450)
    return () => { window.clearTimeout(timer); controller.abort() }
  }, [query, open, composing])
  function select(place: Place) {
    const [lon, lat] = place.geometry.coordinates
    setQuery(placeName(place)); setOpen(false); setActive(-1); setSearching(false); setResults([])
    onSelect(lat, lon, placeName(place))
  }
  const expanded = open && query.trim().length >= 2
  return <div className="pickup-place-search" onBlur={event => { if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setOpen(false) }}>
    <label className="booking-field"><input aria-label="ค้นหาสถานที่" lang="th" role="combobox" autoComplete="off" aria-autocomplete="list" aria-expanded={expanded} aria-controls={listId} aria-activedescendant={expanded && active >= 0 ? `${listId}-${active}` : undefined} aria-describedby={`${listId}-status`} value={query} maxLength={200} placeholder="ค้นหาสถานที่ เช่น หมู่บ้านบ้านกลาง" onFocus={() => { setOpen(true); setActive(-1) }} onCompositionStart={() => setComposing(true)} onCompositionEnd={() => setComposing(false)} onChange={event => { setQuery(event.target.value); setOpen(true); setResults([]); setError(''); setActive(-1); setSearching(event.target.value.trim().length >= 2) }} onKeyDown={event => {
      if (event.nativeEvent.isComposing) return
      if (event.key === 'Escape') { event.preventDefault(); setOpen(false); setActive(-1) }
      if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
        event.preventDefault(); setOpen(true)
        if (results.length) setActive(index => event.key === 'ArrowDown' ? (index + 1) % results.length : (index <= 0 ? results.length - 1 : index - 1))
      }
      if (event.key === 'Enter') { event.preventDefault(); if (expanded && results.length) select(results[active >= 0 ? active : 0]) }
    }} /></label>
    {expanded && <ul id={listId} role="listbox" className="pickup-map-results" aria-label="สถานที่แนะนำ">{results.map((place, index) => <li role="option" id={`${listId}-${index}`} key={index} aria-selected={active === index} onPointerDown={event => event.preventDefault()} onClick={() => select(place)}>{placeName(place)}</li>)}</ul>}
    <p id={`${listId}-status`} role="status" className="pickup-search-status">{expanded ? searching ? 'กำลังค้นหาสถานที่แนะนำ…' : error || (results.length ? `พบ ${results.length} สถานที่ · เลือกสถานที่จากรายการ` : '') : 'พิมพ์อย่างน้อย 2 ตัวอักษรเพื่อดูสถานที่แนะนำ'}</p>
  </div>
}
