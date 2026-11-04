# Pickup maps

The existing React/Vite booking flow uses MapLibre GL JS with OpenStreetMap raster tiles. The pickup screen has a fixed center pin, click/drag selection, keyboard arrow support, place recommendations as users type, GPS recentering, and manual coordinate entry. The address/landmark field stays separate from search; patient and contact details are not sent to search providers.

Coordinates are saved as `pickup.latitude` and `pickup.longitude`. GPS selections also retain accuracy in meters. The legacy `x` and `y` fields remain for compatibility with stored demo data. Existing bookings without coordinates show a contact-the-booker message to drivers instead of inventing a GPS position. New bookings display the actual location and a Google Maps directions link.

Without a saved location, the map initially shows the Lamphun area. This is a browsing starting point, not a detected user position. Users select a location or request GPS and then confirm their pickup.

## Providers

The prototype runs without an API key:

- Tiles: `https://tile.openstreetmap.org/{z}/{x}/{y}.png`. Keep visible attribution and browser caching; no offline downloads or prefetching. See the [tile usage policy](https://operations.osmfoundation.org/policies/tiles/).
- Search: `https://photon.komoot.io/api/`. Suggestions start after two characters and a 450ms pause in typing, with a maximum of five results, a location bias, a small in-memory cache, and a 12-second timeout. Superseded requests are cancelled; keyboard arrows, Enter, and Escape operate the suggestion list. Search waits until IME composition finishes. The public demo has no availability guarantee and may throttle requests; see [Photon's provider guidance](https://github.com/komoot/photon#demo-server).

Before a wider rollout, configure a suitable hosted tile service and a hosted or self-managed Photon service.

Search accepts Thai text, restricts results to Thailand (`countrycode=TH`), and requests local place names (`lang=default`) regardless of the browser language. The public Photon server rejects `lang=th`; its supported languages are `default`, `de`, `en`, and `fr`. Local names generally give Thai labels for places in Thailand, but missing Thai names in the source data may still appear in another language.

Vite build-time settings:

```dotenv
VITE_MAP_TILE_URL=https://your-provider.example/tiles/{z}/{x}/{y}.png
VITE_MAP_SEARCH_URL=https://your-photon.example/api/
```

The tile URL must return 256px Web Mercator raster tiles. If replacing OpenStreetMap attribution with another provider's required attribution, update the map style in `src/components/PickupMap.tsx`. The search endpoint must return Photon GeoJSON features. Restart the development server after changing settings.

GPS requires HTTPS or localhost and browser permission. Map tiles and search require internet access; coordinate entry remains available if WebGL or the network fails.

The shared map retries failed loads automatically at most twice (1-second then 2-second delay), preserving the camera and saved pin. A 12-second initial loading timeout exposes recovery instead of leaving a stalled request loading indefinitely. Manual Retry starts a fresh retry budget. Successful tiles clear their own errors; one successful tile does not hide other failed tiles in the current view. This applies to booking, parking, dispatcher, and driver maps; it cannot guarantee public tile-provider availability.

## Shared car parking and departure estimates

Admin → settings → CFG-01 → Manage lets the admin save one parking pin for all cars. The location is stored as optional `settings.parking` coordinates; older browser data remains valid without a pin. No default map center is saved as the parking location until the admin selects it.

Assignments with parking and pickup coordinates estimate parking-to-pickup minutes from Haversine distance × 1.3 at an assumed 30 km/h, rounded up. This is a mock estimate, not road routing or traffic data. The dispatcher can override it under travel-time details. Missing coordinates retain the existing manual travel-time fallback. Pickup-to-hospital travel remains manually specified (35 minutes initially).

Times are calculated backward: hospital arrival = appointment minus 20 minutes; pickup = arrival minus pickup-to-hospital minutes; parking departure = pickup minus parking-to-pickup minutes. Moving parking changes departure, while pickup stays tied to the hospital leg. Parking changes flag approved assigned jobs for review without overwriting their current schedules. Review starts with an estimate from the latest parking pin.
