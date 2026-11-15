// Estimates server clock offset so countdowns and positions line up on both devices.
let offset = 0;

export function serverNow() {
  return Date.now() + offset;
}

export function syncClock(socket) {
  const samples = [];
  const once = () =>
    new Promise((resolve) => {
      const t0 = Date.now();
      socket.timeout(3000).emit("time-sync", (err, server) => {
        if (!err) {
          const t1 = Date.now();
          samples.push({ rtt: t1 - t0, off: server - (t0 + t1) / 2 });
        }
        resolve();
      });
    });
  (async () => {
    for (let i = 0; i < 5; i++) await once();
    if (!samples.length) return;
    samples.sort((a, b) => a.rtt - b.rtt);
    offset = samples[0].off;
  })();
}
