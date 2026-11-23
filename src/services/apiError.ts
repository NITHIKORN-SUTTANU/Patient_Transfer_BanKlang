export class ApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly field?: string,
    public readonly code?: string,
    public readonly serverMessage?: string,
    public readonly alternativeTimes?: string[],
  ) {
    super(`API request failed (${status})`)
  }
}
