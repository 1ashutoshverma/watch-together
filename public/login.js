const form = document.getElementById("form");
const nameEl = document.getElementById("name");
const err = document.getElementById("err");
try { nameEl.value = localStorage.getItem("wt-name") || ""; } catch {}
(nameEl.value ? document.getElementById("password") : nameEl).focus();

const MESSAGES = {
  "wrong-password": "That password isn't right.",
  "rate-limited": "Too many wrong tries. Wait 15 minutes and try again.",
  "name-required": "Add your name.",
};

form.addEventListener("submit", async (e) => {
  e.preventDefault();
  err.textContent = "";
  const name = nameEl.value.trim();
  try {
    const r = await fetch("/api/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name, password: document.getElementById("password").value }),
    });
    const j = await r.json();
    if (!r.ok) return (err.textContent = MESSAGES[j.error] || "Couldn't sign in.");
    try { localStorage.setItem("wt-name", name); } catch {}
    location.replace("/");
  } catch {
    err.textContent = "Can't reach the Mac. Is the server running?";
  }
});
