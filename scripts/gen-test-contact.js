// Generate a second test identity (for use as a DM contact in the e2e test)
const { execSync } = require("child_process");
const out = execSync(
  "npx tsx -e \"" +
  "import { generateMnemonic, buildIdentityFromMnemonic, encodeCurvePub } from './src/lib/octra/crypto';" +
  "(async () => {" +
  "  const m = generateMnemonic(256);" +
  "  const id = await buildIdentityFromMnemonic(m);" +
  "  console.log(JSON.stringify({ address: id.address, curvePub: encodeCurvePub(id.curvePublicKey), mnemonic: m }));" +
  "})();" +
  "\"",
  { encoding: "utf-8", timeout: 30000, cwd: "/home/z/my-project/octrachat" }
);
console.log(out.trim());
