import { writeFile } from 'node:fs/promises'
import { generateRealisticSeedBookings, SEED_DRIVERS, SEED_VEHICLES } from '../../src/data/realisticSeed.ts'
import { generateRealisticSeedCSV, parseSeedBookingsCSV } from '../../src/utils/seedCsvImport.ts'
import { isDemoState } from '../../src/utils/validateDemoState.ts'

const bookings = generateRealisticSeedBookings(320)
const csv = generateRealisticSeedCSV(bookings)
const parsed = parseSeedBookingsCSV(csv)

if (parsed.errors.length > 0 || parsed.bookings.length !== 320) {
  throw new Error(`Seed CSV roundtrip failed: ${parsed.errors.join('; ')} (count=${parsed.bookings.length})`)
}

const demoState = {
  version: 1,
  selectedActor: null,
  bookings: parsed.bookings,
  vehicles: SEED_VEHICLES,
  drivers: SEED_DRIVERS,
}

if (!isDemoState(demoState)) {
  throw new Error('Generated seed bookings do not pass isDemoState validation')
}

await writeFile(new URL('../../public/seed-bookings-banklang.csv', import.meta.url), csv, 'utf8')
console.log(`Generated public/seed-bookings-banklang.csv with ${parsed.bookings.length} validated bookings.`)
