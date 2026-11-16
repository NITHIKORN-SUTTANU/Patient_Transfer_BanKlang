import liff from '@line/liff'
import { readLineIdToken } from './lineAuthentication'

// The original ID token goes to the server verifier; decoded browser identity is never trusted.
export async function lineIdToken(liffId: string, reconnect = false): Promise<string> {
  const url = new URL(window.location.href)
  if (url.searchParams.get('line_reconnect') === '1') {
    reconnect = true
    url.searchParams.delete('line_reconnect')
    // Consume before OAuth redirect so returning from login cannot cause a logout loop.
    window.history.replaceState(window.history.state, '', url.href)
  }
  return readLineIdToken(liff, liffId, () => window.location.href, reconnect)
}
