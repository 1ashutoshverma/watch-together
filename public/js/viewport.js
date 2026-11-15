// Pins the app to the visible area. When a phone keyboard opens, the visible area shrinks:
// we shrink the app to match (chat gets shorter, video stays on top) instead of letting the page scroll.
export function trackViewport() {
  const root = document.documentElement;
  const app = document.getElementById("app");
  const vv = window.visualViewport;
  let raf = 0;
  // Tallest visible height seen per orientation = height with no keyboard.
  const tallest = { portrait: 0, landscape: 0 };
  let orient = "portrait";

  function update() {
    raf = 0;
    const h = vv ? vv.height : window.innerHeight;
    const top = vv ? vv.offsetTop : 0;
    root.style.setProperty("--app-h", `${Math.round(h)}px`);
    app.style.transform = top ? `translateY(${Math.round(top)}px)` : "";
    const focused = /input|textarea/i.test(document.activeElement?.tagName || "");
    // Orientation only re-evaluated while not typing: an Android keyboard shrinks the page and would
    // otherwise make a portrait phone look "landscape".
    if (!focused) {
      orient = window.innerWidth > window.innerHeight ? "landscape" : "portrait";
      document.body.classList.toggle("phone-landscape", orient === "landscape" && window.innerHeight <= 500 && matchMedia("(pointer: coarse)").matches);
    }
    if (!focused) tallest[orient] = Math.max(tallest[orient], h);
    else tallest[orient] = tallest[orient] || h;
    document.body.classList.toggle("kb-open", focused && h < tallest[orient] * 0.8);
    // iOS still tries to scroll the page to reveal the input; undo it.
    if (window.scrollY) window.scrollTo(0, 0);
  }
  const schedule = () => raf || (raf = requestAnimationFrame(update));

  if (vv) {
    vv.addEventListener("resize", schedule);
    vv.addEventListener("scroll", schedule);
  }
  window.addEventListener("resize", schedule);
  window.addEventListener("orientationchange", () => setTimeout(update, 300));
  document.addEventListener("focusin", () => setTimeout(update, 50));
  document.addEventListener("focusout", () => setTimeout(update, 50));
  update();
}
