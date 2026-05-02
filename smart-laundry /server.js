const express = require("express");
const cors = require("cors");
const fs = require("fs");
const path = require("path");

const app = express();
const PORT = 3000;

const TEXTBELT_API_KEY = "984c2db9c5ceceb42b8c11732dfac6101ca99d52b4lUkJzbeJf1nP45zrJ9c4gcW";

app.use(cors());
app.use(express.json());
app.use(express.static(__dirname));

const DATA_FILE = path.join(__dirname, "machines.json");

function loadMachines() {
  if (!fs.existsSync(DATA_FILE)) {
    const defaultState = {
      washer1: { id: "washer1", type: "washer", label: "Washer 1", status: "available", session: null },
      washer2: { id: "washer2", type: "washer", label: "Washer 2", status: "available", session: null },
      dryer1:  { id: "dryer1",  type: "dryer",  label: "Dryer 1",  status: "available", session: null },
      dryer2:  { id: "dryer2",  type: "dryer",  label: "Dryer 2",  status: "available", session: null },
    };
    saveMachines(defaultState);
    return defaultState;
  }
  return JSON.parse(fs.readFileSync(DATA_FILE, "utf8"));
}

function saveMachines(data) {
  fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2));
}

async function sendText(phone, message) {
  const cleanPhone = phone.replace(/\D/g, "");
  const finalPhone = cleanPhone.length === 11 && cleanPhone.startsWith("1")
    ? cleanPhone.slice(1)
    : cleanPhone;
  console.log(`📨 Sending text to ${finalPhone}: ${message}`);
  try {
    const response = await fetch("https://textbelt.com/text", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ phone: finalPhone, message, key: TEXTBELT_API_KEY }),
    });
    const data = await response.json();
    console.log("Textbelt response:", data);
    return data.success;
  } catch (err) {
    console.error("❌ Text error:", err.message);
    return false;
  }
}

app.get("/api/machines", (req, res) => { res.json(loadMachines()); });

app.get("/api/machines/:id", (req, res) => {
  const machines = loadMachines();
  const machine = machines[req.params.id];
  if (!machine) return res.status(404).json({ error: "Machine not found" });
  res.json(machine);
});

app.post("/api/machines/:id/claim", async (req, res) => {
  const machines = loadMachines();
  const machine = machines[req.params.id];
  if (!machine) return res.status(404).json({ error: "Machine not found" });
  if (machine.status === "in_use") return res.status(400).json({ error: "Machine already in use" });

  const { name, phone, duration, dryerSettings, movable, notes } = req.body;
  const session = {
    name, phone, duration: parseInt(duration),
    dryerSettings, movable, notes,
    startTime: Date.now(), reminderSent: false,
    originalOwner: { name, phone },
  };
  machine.status = "in_use";
  machine.session = session;
  saveMachines(machines);

  const msg = `Hey ${name}! 🧺 Laundy here. You've claimed ${machine.label}! ⏱ ${duration} min wash | 🌡 Dryer pref: ${dryerSettings.replace(/_/g, " ")} | ${movable === "YES" ? "✅ OK to move" : "🚫 Please don't move"}. We'll remind you 5 mins before it's done!${notes ? ` | 📝 "${notes}"` : ""}`;
  await sendText(phone, msg);

  const reminderDelay = (parseInt(duration) - 5) * 60 * 1000;
  if (reminderDelay > 0) {
    setTimeout(async () => {
      const m = loadMachines();
      const current = m[req.params.id];
      if (current && current.status === "in_use" && !current.session.reminderSent) {
        await sendText(current.session.phone, `⏰ Hey ${current.session.name}! Laundy here — your laundry on ${machine.label} finishes in 5 minutes! Come pick it up 🧺`);
        current.session.reminderSent = true;
        saveMachines(m);
      }
    }, reminderDelay);
  }
  res.json({ success: true });
});

app.post("/api/machines/:id/claim-dryer", async (req, res) => {
  const machines = loadMachines();
  const machine = machines[req.params.id];
  if (!machine) return res.status(404).json({ error: "Machine not found" });
  if (machine.status === "in_use") return res.status(400).json({ error: "Machine already in use" });

  const { name, phone, duration, movable, notes, movedLaundry, movedFromMachine, isOwnLaundry } = req.body;
  let originalOwner = { name, phone };

  if (movedLaundry === "YES" && movedFromMachine) {
    const sourceMachine = machines[movedFromMachine];
    if (sourceMachine && sourceMachine.session) {
      const washerOwner = sourceMachine.session.originalOwner;
      if (isOwnLaundry === "YES") {
        originalOwner = { name, phone };
        await sendText(phone, `Hey ${name}! 🔄 Laundy here — you've moved your own laundry from ${sourceMachine.label} to ${machine.label}! ⏱ New dry cycle: ${duration} mins. We'll remind you 5 mins before it's done!${notes ? ` | 📝 "${notes}"` : ""}`);
      } else {
        originalOwner = washerOwner;
        await sendText(washerOwner.phone, `Hey ${washerOwner.name}! 🔄 Laundy here — someone moved your laundry from ${sourceMachine.label} to ${machine.label}! ⏱ New dry cycle: ${duration} mins. We'll remind you 5 mins before it's done!${notes ? ` They left a note: "${notes}"` : ""}`);
        await sendText(phone, `Hey ${name}! 👍 Laundy here — you moved laundry from ${sourceMachine.label} to ${machine.label}. The owner has been notified!${notes ? ` Your note: "${notes}"` : ""}`);
      }
      sourceMachine.status = "available";
      sourceMachine.session = null;
    } else {
      await sendText(phone, `Hey ${name}! 🌀 Laundy here. You've started ${machine.label}! ⏱ ${duration} min dry cycle | ${movable === "YES" ? "✅ OK to move" : "🚫 Please don't move"}. We'll remind you 5 mins before it's done!${notes ? ` | 📝 "${notes}"` : ""}`);
    }
  } else {
    await sendText(phone, `Hey ${name}! 🌀 Laundy here. You've started ${machine.label}! ⏱ ${duration} min dry cycle | ${movable === "YES" ? "✅ OK to move" : "🚫 Please don't move"}. We'll remind you 5 mins before it's done!${notes ? ` | 📝 "${notes}"` : ""}`);
  }

  const session = {
    name, phone, duration: parseInt(duration),
    movable, notes, movedLaundry, movedFromMachine, isOwnLaundry,
    startTime: Date.now(), reminderSent: false, originalOwner,
  };
  machine.status = "in_use";
  machine.session = session;
  saveMachines(machines);

  const reminderDelay = (parseInt(duration) - 5) * 60 * 1000;
  if (reminderDelay > 0) {
    setTimeout(async () => {
      const m = loadMachines();
      const current = m[req.params.id];
      if (current && current.status === "in_use" && !current.session.reminderSent) {
        const owner = current.session.originalOwner;
        await sendText(owner.phone, `⏰ Hey ${owner.name}! Laundy here — your laundry on ${machine.label} finishes in 5 minutes! Come pick it up 🧺`);
        current.session.reminderSent = true;
        saveMachines(m);
      }
    }, reminderDelay);
  }
  res.json({ success: true });
});

app.post("/api/machines/:id/send-note", async (req, res) => {
  const machines = loadMachines();
  const machine = machines[req.params.id];
  if (!machine || machine.status !== "in_use") return res.status(400).json({ error: "Machine not in use" });
  const { senderName, note } = req.body;
  const owner = machine.session.originalOwner;
  const msg = `💬 Hey ${owner.name}! Laundy here — message from another student about your laundry on ${machine.label}: "${note}" — Sent by ${senderName}`;
  const success = await sendText(owner.phone, msg);
  res.json({ success });
});

app.post("/api/machines/:id/free", (req, res) => {
  const machines = loadMachines();
  if (!machines[req.params.id]) return res.status(404).json({ error: "Not found" });
  machines[req.params.id].status = "available";
  machines[req.params.id].session = null;
  saveMachines(machines);
  res.json({ success: true });
});

app.post("/api/machines/:id/remind", async (req, res) => {
  const machines = loadMachines();
  const machine = machines[req.params.id];
  if (!machine || machine.status !== "in_use") return res.status(400).json({ error: "Not in use" });
  const owner = machine.session.originalOwner;
  const msg = `⏰ Hey ${owner.name}! Laundy here — your laundry on ${machine.label} finishes in 5 minutes! Come pick it up 🧺`;
  const success = await sendText(owner.phone, msg);
  if (success) { machine.session.reminderSent = true; saveMachines(machines); }
  res.json({ success });
});

app.listen(PORT, () => {
  console.log(`🚀 Laundy server running at http://localhost:${PORT}`);
  console.log(`\n📱 Machine pages:`);
  console.log(`   http://localhost:${PORT}/machine.html?id=washer1`);
  console.log(`   http://localhost:${PORT}/machine.html?id=washer2`);
  console.log(`   http://localhost:${PORT}/machine.html?id=dryer1`);
  console.log(`   http://localhost:${PORT}/machine.html?id=dryer2`);
  console.log(`\n📊 Status: http://localhost:${PORT}/status.html`);
  console.log(`🔧 Admin:  http://localhost:${PORT}/admin.html`);
});
