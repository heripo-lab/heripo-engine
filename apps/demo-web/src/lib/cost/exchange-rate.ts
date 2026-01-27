/**
 * Exchange rate utilities for currency conversion
 */

export const FALLBACK_RATE = 1450;

export interface ExchangeRateResult {
  rate: number;
  isFallback: boolean;
}

interface FrankfurterResponse {
  rates: {
    KRW?: number;
  };
}

/**
 * Fetch current USD to KRW exchange rate
 *
 * Uses frankfurter.app (free, ECB-based) API.
 * Falls back to default rate on error.
 *
 * @returns Exchange rate result with fallback indicator
 */
export async function fetchUsdToKrw(): Promise<ExchangeRateResult> {
  try {
    const res = await fetch(
      'https://api.frankfurter.app/latest?from=USD&to=KRW',
    );
    if (!res.ok) {
      return { rate: FALLBACK_RATE, isFallback: true };
    }
    const data = (await res.json()) as FrankfurterResponse;
    const rate = data.rates.KRW;
    if (!rate) {
      return { rate: FALLBACK_RATE, isFallback: true };
    }
    return { rate, isFallback: false };
  } catch {
    return { rate: FALLBACK_RATE, isFallback: true };
  }
}
