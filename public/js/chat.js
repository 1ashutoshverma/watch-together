// Chat panel plus the floating overlay used in big-screen / landscape mode.
export function createChat({ socket, me }) {
  const list = document.getElementById("messages");
  const empty = document.getElementById("msgEmpty");
  const typingEl = document.getElementById("typing");
  const overlay = document.getElementById("overlayMsgs");
  const page = document.getElementById("page");
  let typingTimer = null;
  let lastTypingSent = 0;
  let unread = 0;

  function bubble(m, cls = "") {
    const div = document.createElement("div");
    div.className = `msg ${m.name === me() ? "me" : "them"} ${cls}`;
    div.textContent = m.text;
    div.title = new Date(m.at).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
    return div;
  }

  function add(m, { live = true } = {}) {
    empty.hidden = true;
    history.push(m);
    if (history.length > 50) history.shift();
    const nearBottom = list.scrollHeight - list.scrollTop - list.clientHeight < 80;
    list.appendChild(bubble(m));
    if (nearBottom || m.name === me()) list.scrollTop = list.scrollHeight;
    if (!live) return;
    const recall = overlay.classList.contains("recall");
    const o = bubble(m, recall ? "keep" : "");
    overlay.appendChild(o);
    while (overlay.children.length > (recall ? 6 : 4)) overlay.firstChild.remove();
    if (!recall) setTimeout(() => o.remove(), 9500);
    if (m.name !== me() && page.classList.contains("chat-hidden")) unread++;
    if (m.name !== me()) typingEl.textContent = "";
  }

  function send(input) {
    const text = input.value.trim();
    if (!text) return;
    socket.emit("chat", text);
    input.value = "";
  }

  function wire(form, input) {
    form.addEventListener("submit", (e) => {
      e.preventDefault();
      send(input);
    });
    input.addEventListener("input", () => {
      const t = Date.now();
      if (t - lastTypingSent > 1500) {
        lastTypingSent = t;
        socket.emit("typing");
      }
    });
  }
  wire(document.getElementById("compose"), document.getElementById("msg"));
  const overlayInput = document.getElementById("overlayInput");
  wire(document.getElementById("overlayForm"), overlayInput);

  const history = [];
  overlayInput.addEventListener("focus", () => {
    overlay.innerHTML = "";
    history.slice(-6).forEach((m) => overlay.appendChild(bubble(m, "keep")));
    overlay.classList.add("recall");
  });
  overlayInput.addEventListener("blur", () => {
    overlay.classList.remove("recall");
    overlay.querySelectorAll(".keep").forEach((n) => n.remove());
  });


  function toggleHidden() {
    page.classList.toggle("chat-hidden");
    unread = 0;
  }

  socket.on("chat-history", (msgs) => {
    list.querySelectorAll(".msg").forEach((n) => n.remove());
    history.length = 0;
    empty.hidden = msgs.length > 0;
    msgs.forEach((m) => add(m, { live: false }));
    list.scrollTop = list.scrollHeight;
  });
  socket.on("chat", (m) => add(m));
  socket.on("typing", ({ name }) => {
    typingEl.textContent = `${name} is typing…`;
    clearTimeout(typingTimer);
    typingTimer = setTimeout(() => (typingEl.textContent = ""), 3000);
  });
  return { toggleHidden };
}
