const { execSync } = require("child_process");

function ab(cmd) {
  try {
    return execSync(`agent-browser ${cmd}`, {
      encoding: "utf-8",
      timeout: 30000,
      stdio: ["pipe", "pipe", "pipe"],
    });
  } catch (e) {
    return (e.stdout || "") + (e.stderr || "");
  }
}

// Start fresh
ab("open http://127.0.0.1:3000/setup");
ab("wait 1500");

// Parse mnemonic from innerText (JSON-quoted)
let t = ab('eval "document.body.innerText"').trim();
try { t = JSON.parse(t); } catch {}

const re = /(\d{2})\n([a-z]+)/g;
const words = [];
let m;
while ((m = re.exec(t)) !== null && words.length < 24) {
  words.push({ i: parseInt(m[1], 10), w: m[2] });
}
console.log("Words parsed:", words.length);
const w7 = words.find((w) => w.i === 7)?.w;
const w14 = words.find((w) => w.i === 14)?.w;
const w21 = words.find((w) => w.i === 21)?.w;
console.log("W7:", w7, "W14:", w14, "W21:", w21);

if (!w7 || !w14 || !w21) { console.log("FAIL"); process.exit(1); }

// Find and click the "I saved it" button — use first button with that label
// The agent-browser snapshot returns refs as @eNN. Let's just snapshot and parse.
const snap = ab("snapshot -i");
// Use a simpler regex — just look for the ref token after "I saved it"
const savedMatch = snap.match(/I saved it.*?\[ref=(\S+?)\]/);
console.log("savedMatch:", savedMatch);
if (!savedMatch) { console.log("FAIL: no saved button"); process.exit(1); }
ab(`click @${savedMatch[1]}`);
ab("wait 1000");

// Verify step — snapshot and parse
const snap2 = ab("snapshot -i");
console.log("\nVerify snapshot:\n" + snap2.slice(0, 1200));

// Find Word #7, #14, #21 textbox refs by scanning lines
function findRef(snap, label) {
  // Lines look like: - textbox "Word #7" [ref=e41]
  const lines = snap.split("\n");
  for (const line of lines) {
    if (line.includes(label)) {
      const m = line.match(/\[ref=(\S+?)\]/);
      if (m) return m[1];
    }
  }
  return null;
}

const ref7 = findRef(snap2, "Word #7");
const ref14 = findRef(snap2, "Word #14");
const ref21 = findRef(snap2, "Word #21");
const refCont = findRef(snap2, "Continue");
console.log("refs:", { ref7, ref14, ref21, refCont });

if (!ref7 || !ref14 || !ref21) { console.log("FAIL: missing inputs"); process.exit(1); }

ab(`fill @${ref7} "${w7}"`);
ab(`fill @${ref14} "${w14}"`);
ab(`fill @${ref21} "${w21}"`);
ab("wait 600");

// Re-snapshot to find the now-enabled Continue button
const snap3 = ab("snapshot -i");
const refCont2 = findRef(snap3, "Continue");
console.log("Continue ref after fill:", refCont2);
ab(`click @${refCont2}`);
ab("wait 800");

// PIN step
console.log("\n=== PIN step ===");
let pinText = ab('eval "document.body.innerText"').trim();
try { pinText = JSON.parse(pinText); } catch {}
console.log(pinText.slice(0, 500));

const snap4 = ab("snapshot -i");
console.log("\nPIN snapshot:\n" + snap4.slice(0, 1000));

// Find all textboxes
function findTextBoxes(snap) {
  const out = [];
  const lines = snap.split("\n");
  for (const line of lines) {
    if (line.includes("textbox")) {
      const labelM = line.match(/textbox "?([^"\[]+)"? \[/);
      const refM = line.match(/\[ref=(\S+?)\]/);
      if (refM) out.push({ label: labelM ? labelM[1] : "?", ref: refM[1] });
    }
  }
  return out;
}

const pinBoxes = findTextBoxes(snap4);
console.log("PIN textboxes:", pinBoxes);

if (pinBoxes.length >= 2) {
  const pin = "TestPin2024!secure";
  ab(`fill @${pinBoxes[0].ref} "${pin}"`);
  ab(`fill @${pinBoxes[1].ref} "${pin}"`);
  ab("wait 500");
  // Click Continue
  const snap5 = ab("snapshot -i");
  const cont = findRef(snap5, "Continue");
  if (cont) {
    ab(`click @${cont}`);
    ab("wait 800");
  }
}

// Label step
console.log("\n=== Label step ===");
let labelTxt = ab('eval "document.body.innerText"').trim();
try { labelTxt = JSON.parse(labelTxt); } catch {}
console.log(labelTxt.slice(0, 400));

const snap6 = ab("snapshot -i");
const labelBoxes = findTextBoxes(snap6);
console.log("Label textboxes:", labelBoxes);
if (labelBoxes.length >= 1) {
  ab(`fill @${labelBoxes[0].ref} "Test Wallet"`);
  ab("wait 400");
}

// Find a Create/Submit button
const snap7 = ab("snapshot -i");
function findButton(snap, kw) {
  const lines = snap.split("\n");
  for (const line of lines) {
    if (line.includes("button") && line.toLowerCase().includes(kw.toLowerCase())) {
      const m = line.match(/\[ref=(\S+?)\]/);
      if (m) return m[1];
    }
  }
  return null;
}

const createBtn = findButton(snap7, "create") || findButton(snap7, "finish") || findButton(snap7, "submit");
console.log("Create button ref:", createBtn);
if (createBtn) {
  ab(`click @${createBtn}`);
  ab("wait 3000");
}

console.log("\n=== Final state ===");
console.log("URL:", ab("get url").trim());
console.log("Body text:");
let finalText = ab('eval "document.body.innerText.slice(0, 800)"').trim();
try { finalText = JSON.parse(finalText); } catch {}
console.log(finalText.slice(0, 800));

ab("screenshot /tmp/shots/02-after-create.png --full");
console.log("\nScreenshot saved.");
ab("errors");
