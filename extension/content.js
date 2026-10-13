(() => {
  let timer;
  let lastSignature = "";
  let lastSent = 0;
  let stopped = false;
  let inFlight = false;

  async function scan(force = false) {
    if (stopped || inFlight) return;
    const snapshot = DiscordReader.readSnapshot(document, location);
    const signature = JSON.stringify(snapshot);
    if (!force && signature === lastSignature && Date.now() - lastSent < 25000)
      return;
    inFlight = true;
    try {
      await chrome.runtime.sendMessage({ type: "SNAPSHOT", snapshot });
      lastSignature = signature;
      lastSent = Date.now();
    } catch (error) {
      // Reloading the extension invalidates old content scripts until Discord is refreshed.
      if (error.message?.includes("Extension context invalidated")) {
        stopped = true;
        observer.disconnect();
        clearInterval(heartbeat);
      }
    } finally {
      inFlight = false;
    }
  }

  const schedule = () => {
    if (timer || stopped) return;
    timer = setTimeout(() => {
      timer = null;
      scan();
    }, 350);
  };
  const observer = new MutationObserver(schedule);
  observer.observe(document.documentElement, {
    subtree: true,
    childList: true,
    characterData: true,
    attributes: true,
    attributeFilter: [
      "class",
      "aria-label",
      "href",
      "src",
      "data-unread-count",
    ],
  });
  const heartbeat = setInterval(() => scan(), 15000);
  document.addEventListener("visibilitychange", schedule);
  document.addEventListener("scroll", schedule, true);
  window.addEventListener("focus", schedule);
  window.addEventListener("popstate", schedule);
  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.type !== "SCAN") return;
    scan(true).then(() => sendResponse({ ok: !stopped }));
    return true;
  });
  scan(true);
})();
