const $ = (id) => document.getElementById(id);
chrome.storage.local.get(["server", "name", "token"]).then(({ server, name, token }) => {
  if (server) $("server").value = server;
  if (name) $("name").value = name;
  if (token) {
    $("msg").textContent = "Connected. Open Netflix, Hotstar, Prime or JioCinema.";
    $("msg").className = "msg ok";
  }
});

$("f").addEventListener("submit", async (e) => {
  e.preventDefault();
  const server = $("server").value.trim().replace(/\/+$/, "");
  const name = $("name").value.trim();
  $("msg").textContent = "Connecting…";
  $("msg").className = "msg";
  try {
    const r = await fetch(server + "/api/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name, password: $("password").value }),
    });
    const j = await r.json();
    if (!r.ok) throw new Error({ "wrong-password": "That password isn't right.", "rate-limited": "Too many wrong tries. Wait 15 minutes." }[j.error] || "Couldn't sign in.");
    await chrome.storage.local.set({ server, name, token: j.token });
    $("password").value = "";
    $("msg").textContent = "Connected. Open Netflix, Hotstar, Prime or JioCinema.";
    $("msg").className = "msg ok";
  } catch (err) {
    $("msg").textContent = err.message.startsWith("Failed to fetch") ? "Can't reach that link. Is the Mac running npm start?" : err.message;
    $("msg").className = "msg err";
  }
});
