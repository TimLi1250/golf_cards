export const MATCH_TRAVEL_DURATION_MS = 250;
export const NON_MATCH_TRAVEL_DURATION_MS = 650;

export const SAFE_GIF_DURATION_MS = 4_270;
export const OUT_GIF_DURATION_MS = 4_320;

export function matchTravelDuration(correct: boolean): number {
  return correct ? MATCH_TRAVEL_DURATION_MS : NON_MATCH_TRAVEL_DURATION_MS;
}

export function waitForMatchTravel(durationMs: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, durationMs));
}
