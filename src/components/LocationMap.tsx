import { lazy, Suspense } from 'react'
import type { ComponentProps } from 'react'
import type { PickupMap as MapComponent } from './PickupMap'

const Map = lazy(() => import('./PickupMap').then(module => ({ default: module.PickupMap })))

export function PickupMap(props: ComponentProps<typeof MapComponent>) {
  return <Suspense fallback={<p role="status">กำลังเปิดแผนที่…</p>}><Map {...props} /></Suspense>
}
