const demoPlates = new Set([
  'DEMO-ONLY-01',
  'DEMO-STRETCHER-01',
  'SYNTHETIC-01',
  'SYNTHETIC-02',
])

export function vehicleLabel({ name, plate }: { name: string; plate?: string }) {
  return !plate || demoPlates.has(plate) ? name : `${name} · ${plate}`
}
