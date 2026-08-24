const LANCZOS_G = 7;
const HALF_LOG_TWO_PI = 0.9189385332046727;
const LANCZOS_COEFFICIENTS = [
  0.9999999999998099,
  676.5203681218851,
  -1259.1392167224028,
  771.3234287776531,
  -176.6150291621406,
  12.507343278686905,
  -0.13857109526572012,
  9.984369578019572e-6,
  1.5056327351493116e-7,
] as const;

function assertNonNegativeSafeInteger(value: number, name: string): void {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new RangeError(`${name} must be a non-negative safe integer.`);
  }
}

/**
 * Natural logarithm of |Gamma(x)| using the g=7 Lanczos approximation.
 *
 * HINA's MDL objective only calls this with positive integers, but supporting
 * the real-valued reflection branch makes the helper independently testable
 * and mirrors scipy.special.gammaln more closely.
 */
export function logGamma(value: number): number {
  if (Number.isNaN(value)) {
    return Number.NaN;
  }
  if (value === Number.POSITIVE_INFINITY) {
    return Number.POSITIVE_INFINITY;
  }
  if (!Number.isFinite(value)) {
    return Number.NaN;
  }
  if (value <= 0 && Number.isInteger(value)) {
    return Number.POSITIVE_INFINITY;
  }

  if (value < 0.5) {
    return (
      Math.log(Math.PI) -
      Math.log(Math.abs(Math.sin(Math.PI * value))) -
      logGamma(1 - value)
    );
  }

  const shifted = value - 1;
  let series = LANCZOS_COEFFICIENTS[0];
  for (let index = 1; index < LANCZOS_COEFFICIENTS.length; index += 1) {
    series += LANCZOS_COEFFICIENTS[index]! / (shifted + index);
  }

  const scale = shifted + LANCZOS_G + 0.5;
  return (
    HALF_LOG_TWO_PI +
    (shifted + 0.5) * Math.log(scale) -
    scale +
    Math.log(series)
  );
}

/** Return log(n choose k), with log(0) represented as -Infinity. */
export function logChoose(n: number, k: number): number {
  assertNonNegativeSafeInteger(n, "n");
  assertNonNegativeSafeInteger(k, "k");

  if (k > n) {
    return Number.NEGATIVE_INFINITY;
  }
  if (k === 0 || k === n) {
    return 0;
  }

  const symmetricK = Math.min(k, n - k);
  return (
    logGamma(n + 1) -
    logGamma(symmetricK + 1) -
    logGamma(n - symmetricK + 1)
  );
}

/** Return the logarithm of the multiset coefficient (n multichoose k). */
export function logMultiset(n: number, k: number): number {
  assertNonNegativeSafeInteger(n, "n");
  assertNonNegativeSafeInteger(k, "k");

  if (k === 0) {
    return 0;
  }
  if (n === 0) {
    return Number.NEGATIVE_INFINITY;
  }

  return logChoose(n + k - 1, k);
}
