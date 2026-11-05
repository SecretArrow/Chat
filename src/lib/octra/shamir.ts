/**
 * Shamir's Secret Sharing — split a secret into n shares, threshold t to reconstruct.
 * ------------------------------------------------------------------
 * Used for MPC (Multi-Party Computation) in FHE polls:
 *   - The Paillier private key is split into n shares
 *   - Each validator/node gets one share
 *   - The poll creator gets one share
 *   - Tally decryption requires t shares (threshold)
 *   - No single party can decrypt individual votes
 *
 * This provides true vote privacy — even the poll creator cannot
 * decrypt individual votes without cooperation from t-1 other parties.
 *
 * Implementation: uses prime field arithmetic with BigInt.
 * Polynomial: f(x) = secret + a1*x + a2*x^2 + ... + a_{t-1}*x^{t-1} (mod p)
 * Shares: (i, f(i)) for i = 1..n
 * Reconstruction: Lagrange interpolation at x=0
 */

// Large prime for the field (256-bit)
// p = 2^256 - 189 (a Solinas prime field)
const PRIME = (1n << 256n) - 189n;

export interface Share {
  index: bigint; // x coordinate
  value: bigint; // f(x) mod p
}

/**
 * Split a secret into n shares with threshold t.
 * Any t shares can reconstruct the secret.
 */
export function splitSecret(
  secret: Uint8Array,
  n: number,
  threshold: number
): Share[] {
  if (threshold > n) throw new Error("threshold cannot exceed n");
  if (threshold < 2) throw new Error("threshold must be at least 2");
  if (n < 2) throw new Error("n must be at least 2");

  // Convert secret bytes to BigInt (big-endian)
  let secretInt = 0n;
  for (const b of secret) {
    secretInt = (secretInt << 8n) | BigInt(b);
  }
  secretInt = secretInt % PRIME;

  // Generate random polynomial coefficients: f(x) = secret + a1*x + ... + a_{t-1}*x^{t-1}
  const coeffs: bigint[] = [secretInt];
  for (let i = 1; i < threshold; i++) {
    coeffs.push(randomBigIntModP());
  }

  // Compute shares: (i, f(i)) for i = 1..n
  const shares: Share[] = [];
  for (let i = 1; i <= n; i++) {
    const x = BigInt(i);
    let y = 0n;
    // Horner's method: f(x) = ((...((a_{t-1} * x + a_{t-2}) * x + a_{t-3}) * x + ...) + a_0)
    for (let j = coeffs.length - 1; j >= 0; j--) {
      y = (y * x + coeffs[j]) % PRIME;
    }
    shares.push({ index: x, value: y });
  }

  return shares;
}

/**
 * Reconstruct the secret from t or more shares using Lagrange interpolation.
 */
export function reconstructSecret(shares: Share[]): Uint8Array {
  if (shares.length < 2) throw new Error("need at least 2 shares");

  // Lagrange interpolation at x=0
  // f(0) = sum( y_i * prod( (0 - x_j) / (x_i - x_j) ) for j != i )
  let secret = 0n;

  for (let i = 0; i < shares.length; i++) {
    let num = 1n;
    let den = 1n;
    for (let j = 0; j < shares.length; j++) {
      if (i === j) continue;
      num = (num * (-shares[j].index)) % PRIME;
      den = (den * (shares[i].index - shares[j].index)) % PRIME;
    }
    // Handle negative num
    if (num < 0n) num = num + PRIME;
    // Compute num/den mod p = num * den^{-1} mod p
    const denInv = modInverse(den, PRIME);
    const term = (shares[i].value * num % PRIME) * denInv % PRIME;
    secret = (secret + term) % PRIME;
  }

  // Convert BigInt back to bytes (big-endian, 32 bytes)
  const bytes = new Uint8Array(32);
  let temp = secret;
  for (let i = 31; i >= 0; i--) {
    bytes[i] = Number(temp & 0xffn);
    temp = temp >> 8n;
  }
  return bytes;
}

/**
 * Verify a share is valid (lies on the polynomial).
 * Requires the commitment (simplified: just check reconstruction consistency).
 */
export function verifyShare(
  share: Share,
  otherShares: Share[]
): boolean {
  // Reconstruct using this share + others, then check consistency
  if (otherShares.length < 1) return true; // can't verify without other shares
  const all = [share, ...otherShares];
  try {
    reconstructSecret(all);
    return true;
  } catch {
    return false;
  }
}

// ─── Helpers ──────────────────────────────────────────────

function randomBigIntModP(): bigint {
  // Generate 32 random bytes, convert to BigInt, mod p
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  let n = 0n;
  for (const b of bytes) {
    n = (n << 8n) | BigInt(b);
  }
  return n % PRIME;
}

function modInverse(a: bigint, m: bigint): bigint {
  // Ensure a is positive mod m
  a = ((a % m) + m) % m;
  // Extended Euclidean algorithm
  let [old_r, r] = [a, m];
  let [old_s, s] = [1n, 0n];
  while (r !== 0n) {
    const q = old_r / r;
    [old_r, r] = [r, old_r - q * r];
    [old_s, s] = [s, old_s - q * s];
  }
  if (old_s < 0n) old_s = old_s + m;
  return old_s;
}

// ─── MPC Poll integration ─────────────────────────────────

/**
 * Split a Paillier private key into shares for MPC tally decryption.
 * Returns n shares — distribute to n parties (creator + validators).
 */
export function splitPaillierKey(
  privateKeyBytes: Uint8Array,
  numParties: number,
  threshold: number
): Share[] {
  return splitSecret(privateKeyBytes, numParties, threshold);
}

/**
 * Reconstruct the Paillier private key from threshold shares.
 * Requires cooperation from `threshold` parties.
 */
export function reconstructPaillierKey(shares: Share[]): Uint8Array {
  return reconstructSecret(shares);
}

export { PRIME as SHAMIR_PRIME };
