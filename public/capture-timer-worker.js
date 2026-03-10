// Web Worker timer — immune to background tab throttling.
// Browsers throttle setInterval to ~1Hz in background tabs,
// but Worker timers run at full speed regardless of tab visibility.

let intervalId = null;

self.onmessage = (e) => {
  if (e.data.type === "start") {
    if (intervalId) clearInterval(intervalId);
    intervalId = setInterval(() => {
      self.postMessage({ type: "tick" });
    }, e.data.interval || 80);
  } else if (e.data.type === "stop") {
    if (intervalId) {
      clearInterval(intervalId);
      intervalId = null;
    }
  }
};
