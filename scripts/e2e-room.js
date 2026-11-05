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

function findRefs(snap, label) {
  const refs = [];
  for (const line of snap.split("\n")) {
    if (line.toLowerCase().includes(label.toLowerCase())) {
      const m = line.match(/\[ref=(\S+?)\]/);
      if (m) refs.push({ ref: m[1], line: line.trim() });
    }
  }
  return refs;
}

function findBoxes(snap) {
  const out = [];
  for (const line of snap.split("\n")) {
    if (line.includes("textbox") || line.includes("combobox")) {
      const labelM = line.match(/(?:textbox|combobox) "?([^"\[]+)"? \[/);
      const refM = line.match(/\[ref=(\S+?)\]/);
      if (refM) out.push({ label: labelM ? labelM[1].trim() : "?", ref: refM[1], line: line.trim() });
    }
  }
  return out;
}

// Install error handler
ab('eval "window.__errors = []; window.addEventListener(\'error\', e => { window.__errors.push({msg: e.message, file: e.filename, line: e.lineno, stack: e.error ? e.error.stack : null}); }); window.addEventListener(\'unhandledrejection\', e => { window.__errors.push({msg: \'unhandledrejection: \' + (e.reason && e.reason.message || e.reason), stack: e.reason && e.reason.stack}); }); \'installed\'"');

// Go to Rooms
let snap = ab("snapshot -i");
const roomsNav = findRefs(snap, "Rooms");
console.log("Rooms nav:", roomsNav[0]);
ab(`click @${roomsNav[0].ref}`);
ab("wait 800");

// Click "Start new" or "New"
snap = ab("snapshot -i");
const startNew = findRefs(snap, "Start new")[0] || findRefs(snap, "New Chat Rooms")[0] || findRefs(snap, "New Rooms")[0];
console.log("Start new button:", startNew);
if (startNew) {
  ab(`click @${startNew.ref}`);
  ab("wait 800");
}

// Click "New Room" tab
snap = ab("snapshot -i");
const roomTab = findRefs(snap, "New Room")[0];
console.log("New Room tab:", roomTab);
if (roomTab) {
  ab(`click @${roomTab.ref}`);
  ab("wait 500");
  snap = ab("snapshot -i");
}

// Find name input
const boxes = findBoxes(snap);
console.log("Boxes:", boxes.map((b) => ({ label: b.label, ref: b.ref })));
const nameBox = boxes.find((b) => b.label.includes("dev") || b.label.includes("name") || b.label.includes("e.g."));
const descBox = boxes.find((b) => b.label.includes("about") || b.label.includes("description"));
console.log("Name box:", nameBox, "Desc box:", descBox);

if (nameBox) {
  ab(`fill @${nameBox.ref} "octra-test-room"`);
}
if (descBox) {
  ab(`fill @${descBox.ref} "Test room for OctraChat"`);
}
ab("wait 500");

// Click Create room
snap = ab("snapshot -i");
const createBtn = findRefs(snap, "Create room")[0];
console.log("Create room button:", createBtn);
if (createBtn) {
  ab(`click @${createBtn.ref}`);
  ab("wait 2000");
}

console.log("\n=== After room create ===");
const url = ab("get url").trim();
console.log("URL:", url);
const body = ab('eval "document.body.innerText.slice(0, 600)"').trim();
try { JSON.parse(body); } catch {}
console.log("Body:", body.slice(0, 600));

console.log("\n=== Captured errors ===");
const errs = ab('eval "JSON.stringify(window.__errors || [])"').trim();
console.log(errs.slice(0, 4000));

ab("screenshot /tmp/shots/07-room-create-result.png --full");
