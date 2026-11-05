// Generate a test contact identity
import { generateMnemonic, buildIdentityFromMnemonic, encodeCurvePub } from "../src/lib/octra/crypto";

(async () => {
  const m = generateMnemonic(256);
  const id = await buildIdentityFromMnemonic(m);
  console.log(JSON.stringify({
    address: id.address,
    curvePub: encodeCurvePub(id.curvePublicKey),
    mnemonic: m,
  }));
})();
