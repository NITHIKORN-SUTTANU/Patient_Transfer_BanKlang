import { lazy, Suspense } from 'react'
import type { ComponentProps } from 'react'
import type { PickupMap as MapComponent } from './PickupMap'

const Map = lazy(() => import('./PickupMap').then(module => ({ default: module.PickupMap })))

export function PickupMap(props: ComponentProps<typeof MapComponent>) {
  return <Suspense fallback={<div className="pickup-map-placeholder" role="status">กำลังเปิดแผนที่…</div>}><Map {...props} /></Suspense>
}
