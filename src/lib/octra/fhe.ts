/**
 * FHE Preview — Additive Homomorphic Encryption (Paillier)
 * ------------------------------------------------------------------
 * Octra network's lite_node exposes libpvac (HFHE) for on-chain FHE.
 * For this client-side preview we implement Paillier encryption, which
 * is a true additive homomorphic scheme that runs natively in JS BigInt.
 *
 * Use case: anonymous polls inside a Circle.
 *   - Each member encrypts their vote (0 or 1).
 *   - Anyone can aggregate: product of all ciphertexts mod N^2
 *     = Enc(sum of all votes), without seeing individual votes.
 *   - The circle admin (key holder) decrypts only the final tally.
 *
 * Parameters: 512-bit modulus (two 256-bit primes) — sufficient security
 * for a preview, fast enough to generate in ~1s.
 */

function randomBigInt(bits: number): bigint {
  const bytes = Math.ceil(bits / 8);
  const u8 = new Uint8Array(bytes);
  crypto.getRandomValues(u8);
  let s = "";
  for (const b of u8) s += b.toString(16).padStart(2, "0");
  let n = BigInt("0x" + s);
  n |= (1n << BigInt(bits - 1)) | (1n << BigInt(bits - 2));
  return n;
}

function modPow(base: bigint, exp: bigint, mod: bigint): bigint {
  if (mod === 1n) return 0n;
  let result = 1n;
  base = base % mod;
  while (exp > 0n) {
    if (exp & 1n) result = (result * base) % mod;
    exp >>= 1n;
    base = (base * base) % mod;
  }
  return result;
}

function gcd(a: bigint, b: bigint): bigint {
  while (b !== 0n) {
    [a, b] = [b, a % b];
  }
  return a < 0n ? -a : a;
}

function lcm(a: bigint, b: bigint): bigint {
  return (a * b) / gcd(a, b);
}

function isProbablePrime(n: bigint, rounds = 20): boolean {
  if (n < 2n) return false;
  if (n === 2n || n === 3n) return true;
  if (n % 2n === 0n) return false;
  let d = n - 1n;
  let r = 0n;
  while (d % 2n === 0n) {
    d /= 2n;
    r++;
  }
  const witnesses = [
    2n, 3n, 5n, 7n, 11n, 13n, 17n, 19n, 23n, 29n, 31n, 37n, 41n, 43n, 47n,
    53n, 59n, 61n, 67n, 71n,
  ];
  for (let i = 0; i < rounds; i++) {
    const a = witnesses[i % witnesses.length];
    if (a >= n) continue;
    let x = modPow(a, d, n);
    if (x === 1n || x === n - 1n) continue;
    let ok = false;
    for (let j = 0n; j < r - 1n; j++) {
      x = (x * x) % n;
      if (x === n - 1n) {
        ok = true;
        break;
      }
    }
    if (!ok) return false;
  }
  return true;
}

function randomPrime(bits: number): bigint {
  for (let attempt = 0; attempt < 5000; attempt++) {
    const candidate = randomBigInt(bits) | 1n;
    if (isProbablePrime(candidate)) return candidate;
  }
  throw new Error("Failed to find prime in reasonable attempts");
}

function L(x: bigint, n: bigint): bigint {
  return (x - 1n) / n;
}

function modInverse(a: bigint, m: bigint): bigint {
  let [old_r, r] = [a, m];
  let [old_s, s] = [1n, 0n];
  while (r !== 0n) {
    const q = old_r / r;
    [old_r, r] = [r, old_r - q * r];
    [old_s, s] = [s, old_s - q * s];
  }
  if (old_s < 0n) old_s += m;
  return old_s;
}

export interface PaillierPublicKey {
  n: string;
  g: string;
  bits: number;
}

export interface PaillierPrivateKey {
  lambda: string;
  mu: string;
  bits: number;
}

export interface PaillierKeyPair {
  pub: PaillierPublicKey;
  priv: PaillierPrivateKey;
}

export async function generatePaillierKeys(
  primeBits = 256
): Promise<PaillierKeyPair> {
  await new Promise((r) => setTimeout(r, 0));

  const p = randomPrime(primeBits);
  let q = randomPrime(primeBits);
  if (p === q) q = randomPrime(primeBits);

  const n = p * q;
  const n2 = n * n;
  const lambda = lcm(p - 1n, q - 1n);
  const g = n + 1n;

  const gL = L(modPow(g, lambda, n2), n);
  const mu = modInverse(gL, n);

  return {
    pub: { n: n.toString(16), g: g.toString(16), bits: primeBits * 2 },
    priv: { lambda: lambda.toString(16), mu: mu.toString(16), bits: primeBits * 2 },
  };
}

export interface PaillierCiphertext {
  c: string;
}

export function paillierEncrypt(
  pub: PaillierPublicKey,
  plaintext: bigint
): PaillierCiphertext {
  const n = BigInt("0x" + pub.n);
  const n2 = n * n;
  const g = BigInt("0x" + pub.g);

  let r: bigint;
  do {
    r = randomBigInt(pub.bits / 2);
    r = r % n;
  } while (gcd(r, n) !== 1n);

  const gm = modPow(g, plaintext, n2);
  const rn = modPow(r, n, n2);
  const c = (gm * rn) % n2;
  return { c: c.toString(16) };
}

export function paillierDecrypt(
  pub: PaillierPublicKey,
  priv: PaillierPrivateKey,
  ciphertext: PaillierCiphertext
): bigint {
  const n = BigInt("0x" + pub.n);
  const n2 = n * n;
  const lambda = BigInt("0x" + priv.lambda);
  const mu = BigInt("0x" + priv.mu);
  const c = BigInt("0x" + ciphertext.c);

  const cl = modPow(c, lambda, n2);
  const l = L(cl, n);
  return (l * mu) % n;
}

export function paillierAdd(
  pub: PaillierPublicKey,
  ciphertexts: PaillierCiphertext[]
): PaillierCiphertext {
  if (ciphertexts.length === 0) {
    return paillierEncrypt(pub, 0n);
  }
  const n = BigInt("0x" + pub.n);
  const n2 = n * n;
  let product = 1n;
  for (const ct of ciphertexts) {
    const c = BigInt("0x" + ct.c);
    product = (product * c) % n2;
  }
  return { c: product.toString(16) };
}

export function paillierMulScalar(
  pub: PaillierPublicKey,
  ct: PaillierCiphertext,
  k: bigint
): PaillierCiphertext {
  const n2 = BigInt("0x" + pub.n) ** 2n;
  const c = BigInt("0x" + ct.c);
  return { c: modPow(c, k, n2).toString(16) };
}
