import { PlaceSearch } from './PlaceSearch'
import { ServiceSymbol } from './ServiceSymbol'
import { useEffect, useRef, useState } from 'react'
import * as maplibregl from 'maplibre-gl'
import workerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url'
import type { BookingDetails } from '../services/booking'
import 'maplibre-gl/dist/maplibre-gl.css'
import './pickup-map.css'

const defaultCenter: [number, number] = [99.008456, 18.578321]
maplibregl.setWorkerUrl(workerUrl)

export function PickupMap({ value, onChange, locationName = 'จุดรับ' }: { value: BookingDetails['pickup']; onChange?: (latitude: number, longitude: number, label?: string) => void; locationName?: string }) {
  const container = useRef<HTMLDivElement>(null)
  const map = useRef<maplibregl.Map | null>(null)
  const marker = useRef<maplibregl.Marker | null>(null)
  const initial = useRef(value)
  const callback = useRef(onChange)
  const [message, setMessage] = useState('กำลังโหลดแผนที่…')
  const [failed, setFailed] = useState(false)
  const [loading, setLoading] = useState(true)
  const [attempt, setAttempt] = useState(0)
  const camera = useRef<{ center: [number, number]; zoom: number } | null>(null)
  const automaticRetries = useRef(0)
  const synchronizing = useRef(false)
  useEffect(() => { callback.current = onChange }, [onChange])
  useEffect(() => {
    let disposed = false
    let retryTimer: number | undefined
    const timers: { loading?: number } = {}
    const retryAutomatically = () => {
      if (disposed || retryTimer !== undefined || automaticRetries.current >= 2) return
      retryTimer = window.setTimeout(() => {
        if (disposed) return
        automaticRetries.current += 1
        setMessage('กำลังโหลดแผนที่…')
        setFailed(false)
        setLoading(true)
        setAttempt(previous => previous + 1)
      }, 1000 * 2 ** automaticRetries.current)
    }
    const stopTimers = () => {
      disposed = true
      window.clearTimeout(retryTimer)
      window.clearTimeout(timers.loading)
    }
    const center: [number, number] = initial.current?.latitude !== undefined && initial.current.longitude !== undefined ? [initial.current.longitude, initial.current.latitude] : defaultCenter
    let instance: maplibregl.Map
    try {
      instance = new maplibregl.Map({
        container: container.current!, center: camera.current?.center ?? center, zoom: camera.current?.zoom ?? 15, maxZoom: 19,
        style: {
          version: 8,
          sources: { osm: { type: 'raster', tiles: [import.meta.env.VITE_MAP_TILE_URL || 'https://tile.openstreetmap.org/{z}/{x}/{y}.png'], tileSize: 256, maxzoom: 19, attribution: '© <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap</a> contributors' } },
          layers: [{ id: 'osm', type: 'raster', source: 'osm' }],
        },
        attributionControl: { compact: false }, dragRotate: false, pitchWithRotate: false,
      })
    } catch {
      queueMicrotask(() => {
        if (disposed) return
        setFailed(true); setMessage(callback.current ? 'อุปกรณ์นี้เปิดแผนที่ไม่ได้ กรุณาค้นหาสถานที่ด้านบน' : 'อุปกรณ์นี้เปิดแผนที่ไม่ได้ กรุณาเปิดนำทางด้วย Google Maps')
        retryAutomatically()
      })
      return stopTimers
    }
    map.current = instance
    if (!callback.current) marker.current = new maplibregl.Marker({ color: '#176448' }).setLngLat(center).addTo(instance)
    instance.addControl(new maplibregl.NavigationControl({ showCompass: false }), 'top-right')
    let hasError = false
    const failedTiles = new Set<string>()
    const showFailure = () => {
      if (disposed) return
      hasError = true
      if (container.current) container.current.dataset.ready = 'false'
      setFailed(true)
      setMessage(callback.current ? 'โหลดแผนที่ไม่สำเร็จ กรุณาลองใหม่ หรือค้นหาสถานที่ด้านบน' : 'โหลดแผนที่ไม่สำเร็จ กรุณาลองใหม่ หรือเปิดนำทางด้วย Google Maps')
      retryAutomatically()
    }
    // A stalled request must not leave the map loading forever.
    timers.loading = window.setTimeout(showFailure, 12000)
    instance.on('load', () => { if (!hasError) setMessage('') })
    instance.on('sourcedata', event => {
      if (event.sourceId === 'osm' && event.tile?.state === 'loaded') {
        window.clearTimeout(timers.loading)
        failedTiles.delete(event.tile.tileID.key)
        if (failedTiles.size) return
        window.clearTimeout(retryTimer)
        retryTimer = undefined
        hasError = false
        setFailed(false)
        setLoading(false)
        setMessage('')
      }
    })
    instance.on('movestart', () => {
      failedTiles.clear()
      if (container.current) container.current.dataset.ready = 'false'
    })
    instance.on('idle', () => { if (container.current && !hasError) container.current.dataset.ready = 'true' })
    instance.on('error', event => {
      const tile = (event as unknown as { tile?: { tileID: { key: string } } }).tile
      failedTiles.add(tile?.tileID.key ?? 'source')
      showFailure()
    })
    instance.on('moveend', event => {
      // Resizing or recentering the map must not select a pickup or clear GPS accuracy.
      if (synchronizing.current || !event.originalEvent) return
      const point = instance.getCenter()
      callback.current?.(point.lat, point.lng)
    })
    instance.on('click', event => {
      if (!callback.current) return
      callback.current(event.lngLat.lat, event.lngLat.lng)
      instance.jumpTo({ center: event.lngLat })
    })
    // Dialogs and responsive layouts can change size after the map is created.
    const observer = new ResizeObserver(() => instance.resize())
    observer.observe(container.current!)
    return () => {
      stopTimers()
      const point = instance.getCenter()
      camera.current = { center: [point.lng, point.lat], zoom: instance.getZoom() }
      observer.disconnect(); instance.remove(); map.current = null; marker.current = null
    }
  }, [attempt])
  useEffect(() => {
    if (value?.latitude === undefined || value.longitude === undefined || !map.current) return
    marker.current?.setLngLat([value.longitude, value.latitude])
    const center = map.current.getCenter()
    if (Math.abs(center.lat - value.latitude) > 0.0000001 || Math.abs(center.lng - value.longitude) > 0.0000001) {
      synchronizing.current = true
      map.current.jumpTo({ center: [value.longitude, value.latitude] })
      synchronizing.current = false
    }
  }, [value?.latitude, value?.longitude])
  return <section className="pickup-map-panel">
    {onChange && <PlaceSearch latitude={value?.latitude ?? defaultCenter[1]} longitude={value?.longitude ?? defaultCenter[0]} onSelect={onChange} />}
    <div className={`pickup-map-frame${failed ? ' pickup-map-failed' : ''}`} role="region" aria-label={`แผนที่${locationName}`} tabIndex={onChange ? 0 : undefined} onKeyDown={event => {
      if (!onChange || event.target !== event.currentTarget || !['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Enter', ' '].includes(event.key)) return
      event.preventDefault()
      const latitude = value?.latitude ?? defaultCenter[1]
      const longitude = value?.longitude ?? defaultCenter[0]
      onChange(Math.max(-85, Math.min(85, latitude + (event.key === 'ArrowUp' ? 0.0002 : event.key === 'ArrowDown' ? -0.0002 : 0))), ((longitude + (event.key === 'ArrowRight' ? 0.0002 : event.key === 'ArrowLeft' ? -0.0002 : 0) + 540) % 360) - 180)
    }}>
      <div ref={container} className="pickup-map-canvas" />
      {loading && !failed && <div className="pickup-map-loading" role="status">กำลังโหลดแผนที่…</div>}
      {onChange && <span className="pickup-map-center" aria-hidden="true">●</span>}
      {onChange && <span className="pickup-map-hint">เลื่อนแผนที่ให้หมุดตรง{locationName}</span>}
      {failed && <div className="pickup-map-retry"><div className="pickup-map-retry-card"><span className="pickup-map-retry-icon"><ServiceSymbol kind="pin" /></span><p className="pickup-map-retry-title">โหลดแผนที่ไม่สำเร็จ</p><p className="pickup-map-retry-description">กรุณาตรวจสอบอินเทอร์เน็ต แล้วลองอีกครั้ง</p><button type="button" className="booking-button" onClick={() => { automaticRetries.current = 0; setMessage('กำลังโหลดแผนที่…'); setFailed(false); setLoading(true); setAttempt(previous => previous + 1) }}>ลองโหลดแผนที่อีกครั้ง</button></div><p role="status" className="pickup-map-error-caption">{onChange ? 'หรือค้นหาชื่อสถานที่ด้านบน' : message}</p></div>}
    </div>
    {!onChange && value?.latitude !== undefined && value.longitude !== undefined && <p className="pickup-map-coordinates">พิกัด {value.latitude.toFixed(6)}, {value.longitude.toFixed(6)}</p>}
    {onChange && <p className="booking-small">ค้นหาชื่อสถานที่ หรือแตะบนแผนที่เพื่อเลือก{locationName}</p>}
  </section>
}
