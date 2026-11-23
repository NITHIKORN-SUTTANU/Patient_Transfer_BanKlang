export const APPOINTMENT_OPEN = '06:00'
export const APPOINTMENT_CLOSE = '16:00'

export function isAppointmentClock(clock: string) {
  if (!/^\d{2}:[0-5]\d(?::[0-5]\d(?:\.\d{1,3})?)?$/.test(clock)) return false
  const [hours, minutes, seconds = '0'] = clock.split(':')
  const value = Number(hours) * 3600 + Number(minutes) * 60 + Number(seconds)
  return value >= 6 * 3600 && value <= 16 * 3600
}
