export type ServiceSymbolKind = 'vehicle' | 'person' | 'calendar' | 'settings' | 'home' | 'route' | 'history' | 'people' | 'list' | 'shield' | 'phone' | 'pin' | 'check' | 'clock' | 'hospital' | 'walk' | 'wheel' | 'bed'

export function ServiceSymbol({ kind = 'vehicle' }: { kind?: ServiceSymbolKind }) {
  const paths = {
    vehicle: <><path d="M5 17H3V8a2 2 0 0 1 2-2h10l5 5v6h-2M9 17h5M15 6v5h5" /><circle cx="7" cy="17" r="2" /><circle cx="16" cy="17" r="2" /><path d="M7 9v4m-2-2h4" /></>,
    person: <><circle cx="12" cy="7" r="4" /><path d="M4 21v-3a8 8 0 0 1 16 0v3M9 17h6" /></>,
    calendar: <><rect x="3" y="5" width="18" height="16" rx="3" /><path d="M7 3v4m10-4v4M3 11h18m-13 5 3 3 5-5" /></>,
    settings: <><rect x="3" y="3" width="18" height="18" rx="4" /><path d="M7 8h10M7 16h10M10 6v4m4 4v4" /></>,
    home: <><path d="m3 10 9-7 9 7v10a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1Z" /><path d="M9 21v-8h6v8" /></>,
    route: <><circle cx="6" cy="5" r="2" /><circle cx="18" cy="19" r="2" /><path d="M6 7v8a4 4 0 0 0 4 4h6M18 17V9a4 4 0 0 0-4-4h-2" /></>,
    history: <><path d="M3 11a9 9 0 1 1 2.5 7M3 4v7h7M12 7v5l3 2" /></>,
    people: <><circle cx="9" cy="7" r="3" /><path d="M3 21v-3a6 6 0 0 1 12 0v3M16 4a3 3 0 0 1 0 6m3 11v-3a6 6 0 0 0-2-4" /></>,
    list: <><rect x="4" y="3" width="16" height="18" rx="3" /><path d="M8 8h8M8 12h8M8 16h5" /></>,
    shield: <><path d="m12 3 8 3v6c0 5-8 9-8 9s-8-4-8-9V6Z" /><path d="m8 12 3 3 5-6" /></>,
    phone: <path d="m8 3 2 5-3 2a14 14 0 0 0 7 7l2-3 5 2v3a2 2 0 0 1-2 2A18 18 0 0 1 3 5a2 2 0 0 1 2-2Z" />,
    pin: <><path d="M19 10c0 5-7 11-7 11S5 15 5 10a7 7 0 0 1 14 0Z" /><circle cx="12" cy="10" r="2.5" /></>,
    check: <><circle cx="12" cy="12" r="9" /><path d="m8 12 3 3 5-6" /></>,
    clock: <><circle cx="12" cy="12" r="9" /><path d="M12 7v5h4" /></>,
    hospital: <><rect x="4" y="3" width="16" height="18" rx="2" /><path d="M9 21v-5h6v5M12 6v6m-3-3h6" /></>,
    walk: <><circle cx="13" cy="4" r="2" /><path d="m7 13 3-5h4l3 5h3M12 8l-2 7-4 6m4-6 5 1 2 5" /></>,
    wheel: <><circle cx="14" cy="4" r="2" /><path d="m12 8-1 5h6l3 7h2M12 8h5M8 10a6 6 0 1 0 7 8" /></>,
    bed: <><path d="M3 18V7m18 11v-7H3m0 5h18M3 18v3m18-3v3M5 7h5v4" /><path d="M10 8h8a3 3 0 0 1 3 3" /></>,
  }
  return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{paths[kind]}</svg>
}
