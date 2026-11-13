import liff from '@line/liff'

// The original ID token goes to the server verifier; decoded browser identity is never trusted.
export async function lineIdToken(liffId: string): Promise<string> {
  await liff.init({ liffId, withLoginOnExternalBrowser: true })
  if (!liff.isLoggedIn()) {
    liff.login({ redirectUri: window.location.href })
    throw new Error('LINE login required')
  }
  const token = liff.getIDToken()
  if (!token) throw new Error('LINE openid scope required')
  return token
}
