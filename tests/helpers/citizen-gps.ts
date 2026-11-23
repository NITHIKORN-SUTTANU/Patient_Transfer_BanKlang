import type { Page } from '@playwright/test'

export async function chooseCitizenPickup(page: Page, latitude: number, longitude: number) {
  if (await page.getByRole('button', { name: 'กำลังค้นหาตำแหน่ง…', exact: true }).count()) {
    await page.getByRole('radio', { name: 'กรอกที่อยู่แทนแผนที่', exact: true }).check()
    await page.getByRole('radio', { name: 'เลือกจุดบนแผนที่', exact: true }).check()
  }
  await page.evaluate(({ latitude, longitude }) => {
    Object.defineProperty(navigator, 'geolocation', { configurable: true, value: {
      getCurrentPosition: (success: PositionCallback) => success({
        coords: { latitude, longitude, accuracy: 5 },
      } as GeolocationPosition),
    } })
  }, { latitude, longitude })
  await page.getByRole('button', { name: /ใช้ตำแหน่งปัจจุบัน/ }).click()
}
