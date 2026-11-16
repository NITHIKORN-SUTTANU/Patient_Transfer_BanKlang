export interface LineLoginSdk {
  init(config: { liffId: string; withLoginOnExternalBrowser: boolean }): Promise<unknown>
  isLoggedIn(): boolean
  isInClient(): boolean
  getIDToken(): string | null
  getDecodedIDToken(): { exp?: number } | null
  logout(): void
  login(config: { redirectUri: string }): void
  openWindow(config: { url: string; external: boolean }): void
}

export class LineConnectionError extends Error {
  constructor() { super('กรุณายืนยันตัวตนผ่าน LINE ใหม่ หากเปิดใน LINE ให้กดเชื่อมต่ออีกครั้งเพื่อเข้าสู่ระบบในเบราว์เซอร์') }
}

// Decoded expiry is only a renewal hint. The server still verifies the original token with LINE.
export async function readLineIdToken(sdk: LineLoginSdk, liffId: string, currentUrl: () => string, reconnect = false, now = Date.now): Promise<string> {
  await sdk.init({ liffId, withLoginOnExternalBrowser: false })
  const loggedIn = sdk.isLoggedIn()
  const expiry = loggedIn ? sdk.getDecodedIDToken()?.exp : undefined
  const expired = typeof expiry === 'number' && expiry * 1000 <= now() + 30000
  if (reconnect || expired || !loggedIn) {
    if (sdk.isInClient()) {
      // LIFF browser login is managed by LINE. Explicit recovery uses a fresh external login.
      if (reconnect) {
        const target = new URL('/booking', currentUrl())
        target.searchParams.set('line_reconnect', '1')
        sdk.openWindow({ url: target.href, external: true })
      }
      throw new LineConnectionError()
    }
    if (loggedIn) sdk.logout()
    sdk.login({ redirectUri: currentUrl() })
    throw new LineConnectionError()
  }
  const token = sdk.getIDToken()
  if (!token) throw new LineConnectionError()
  return token
}
