import {
  emptyState,
  applySnapshot,
  setWatch,
  dismissAll,
  badgeFor,
  totals,
  channelActivity,
  isWatched,
  isId,
  serverOnlyActivity,
} from "./model.js";

const discordTabs = () => chrome.tabs.query({ url: "https://discord.com/*" });
const stateFromDisk = async () =>
  (await chrome.storage.local.get("state")).state || emptyState();
let queue = Promise.resolve();
const serialize = (task) => {
  const result = queue.then(task);
  queue = result.catch((error) => console.error("Discord Checker:", error));
  return result;
};

async function renderBadge(state) {
  const activity = totals(state);
  await chrome.action.setBadgeBackgroundColor({
    color: state.settings.paused ? "#6b7280" : "#5865f2",
  });
  await chrome.action.setBadgeText({ text: badgeFor(state) });
  await chrome.action.setTitle({
    title: state.settings.paused
      ? "Discord Checker — paused"
      : `Discord Checker — ${activity.count}${activity.unknown ? "+" : ""} known new messages; ${activity.activeChannels} channels and ${activity.activeServers} server summaries with activity`,
  });
}

async function save(state) {
  await chrome.storage.local.set({ state });
  await renderBadge(state);
}

async function openDiscord(serverId, channelId) {
  const path = isId(serverId)
    ? `/channels/${serverId}${isId(channelId) ? `/${channelId}` : ""}`
    : "/channels/@me";
  const url = `https://discord.com${path}`;
  const tabs = await discordTabs();
  const tab =
    tabs.find((item) => item.url === url) ||
    tabs.find((item) => item.active) ||
    tabs[0];
  if (tab) {
    await chrome.tabs.update(tab.id, { url, active: true });
    await chrome.windows.update(tab.windowId, { focused: true });
  } else await chrome.tabs.create({ url });
}

async function notifyChanges(before, after) {
  if (!after.settings.notifications || after.settings.paused) return;
  for (const channel of Object.values(after.channels)) {
    if (!isWatched(after, channel)) continue;
    const activity = channelActivity(channel);
    const old = before.channels[channel.id]
      ? channelActivity(before.channels[channel.id])
      : { active: false, count: 0 };
    // A sidebar's unread dot is an event only when it changes from read to unread.
    if (!activity.active || (old.active && activity.count <= old.count))
      continue;
    const notificationId = `channel:${channel.serverId}:${channel.id}`;
    const throttle =
      (await chrome.storage.session.get("notificationTimes"))
        .notificationTimes || {};
    if (Date.now() - (throttle[channel.id] || 0) < 30000) continue;
    throttle[channel.id] = Date.now();
    await chrome.storage.session.set({ notificationTimes: throttle });
    await chrome.notifications.create(notificationId, {
      type: "basic",
      iconUrl: "icons/128.png",
      title: `${after.servers[channel.serverId]?.name || "Discord"} · #${channel.name}`,
      message: activity.count
        ? `At least ${activity.count} new message${activity.count === 1 ? "" : "s"}. Click to open Discord.`
        : "New unread activity. Click to open Discord.",
    });
  }
  for (const server of Object.values(after.servers)) {
    if (!serverOnlyActivity(after, server).active) continue;
    const activity = channelActivity(server);
    const old = before.servers[server.id]
      ? channelActivity(before.servers[server.id])
      : { active: false, count: 0 };
    if (old.active && activity.count <= old.count) continue;
    const key = `server:${server.id}`;
    const throttle =
      (await chrome.storage.session.get("notificationTimes"))
        .notificationTimes || {};
    if (Date.now() - (throttle[key] || 0) < 30000) continue;
    throttle[key] = Date.now();
    await chrome.storage.session.set({ notificationTimes: throttle });
    await chrome.notifications.create(key, {
      type: "basic",
      iconUrl: "icons/128.png",
      title: server.name,
      message: activity.count
        ? `At least ${activity.count} new messages across this server. Click to open Discord.`
        : "Unread server activity. Click to open Discord.",
    });
  }
}

async function refreshTabs() {
  const tabs = await discordTabs();
  await Promise.allSettled(
    tabs.map((tab) => chrome.tabs.sendMessage(tab.id, { type: "SCAN" })),
  );
}

async function handle(message, sender) {
  if (message.type === "SNAPSHOT") {
    if (!sender.tab || !sender.url?.startsWith("https://discord.com/"))
      throw new Error("Invalid source.");
    return serialize(async () => {
      const before = await stateFromDisk();
      const snapshot = structuredClone(message.snapshot);
      if (snapshot?.current) {
        // A background tab should never clear a count, even if its page reports focus.
        const window = await chrome.windows.get(sender.tab.windowId);
        snapshot.current.reading &&= sender.tab.active && window.focused;
      }
      const reports =
        (await chrome.storage.session.get("reports")).reports || {};
      reports[sender.tab.id] = {
        updatedAt: Date.now(),
        loggedIn: snapshot?.loggedIn === true,
        account: snapshot?.account || null,
      };
      await chrome.storage.session.set({ reports });
      const conflictingAccount =
        snapshot?.account &&
        before.account &&
        snapshot.account !== before.account &&
        Object.entries(reports).some(
          ([id, report]) =>
            id !== String(sender.tab.id) &&
            report.loggedIn &&
            report.account === before.account &&
            Date.now() - report.updatedAt < 60000,
        );
      // Keep one catalog until all live tabs agree on a new account.
      if (conflictingAccount) return { ok: true };
      // A confirmed logout should never leave message counters from the old session on screen.
      let next =
        snapshot?.loginScreen &&
        !snapshot.loggedIn &&
        !Object.entries(reports).some(
          ([id, report]) =>
            id !== String(sender.tab.id) &&
            report.loggedIn &&
            Date.now() - report.updatedAt < 60000,
        )
          ? { ...emptyState(), settings: before.settings }
          : applySnapshot(before, snapshot);
      await save(next);
      await notifyChanges(before, next);
      return { ok: true };
    });
  }

  if (
    sender.id !== chrome.runtime.id ||
    !sender.url?.startsWith(chrome.runtime.getURL(""))
  )
    throw new Error("Invalid source.");
  if (message.type === "GET_STATE") {
    await queue;
    const [state, tabs, session] = await Promise.all([
      stateFromDisk(),
      discordTabs(),
      chrome.storage.session.get("reports"),
    ]);
    const reports = session.reports || {};
    const activeReports = tabs
      .map((tab) => reports[tab.id])
      .filter((report) => report && Date.now() - report.updatedAt < 60000);
    const accounts = new Set(
      activeReports.map((report) => report.account).filter(Boolean),
    );
    return {
      state,
      connection: {
        openTabs: tabs.length,
        connected: activeReports.some((report) => report.loggedIn),
        loginNeeded:
          activeReports.length > 0 &&
          !activeReports.some((report) => report.loggedIn),
        multipleAccounts: accounts.size > 1,
      },
    };
  }
  if (message.type === "REFRESH") {
    await refreshTabs();
    return { ok: true };
  }
  if (message.type === "OPEN_DISCORD") {
    await openDiscord(message.serverId, message.channelId);
    return { ok: true };
  }
  return serialize(async () => {
    const state = await stateFromDisk();
    let next;
    switch (message.type) {
      case "SET_WATCH":
        next = setWatch(
          state,
          message.kind,
          message.id,
          Boolean(message.enabled),
        );
        break;
      case "SET_SETTINGS":
        next = { ...state, settings: { ...state.settings } };
        for (const key of ["notifications", "paused"]) {
          if (typeof message.settings?.[key] === "boolean")
            next.settings[key] = message.settings[key];
        }
        break;
      case "DISMISS_ALL":
        next = dismissAll(state);
        break;
      case "RESET":
        next = emptyState();
        await chrome.storage.session.clear();
        const notifications = await chrome.notifications.getAll();
        await Promise.all(
          Object.keys(notifications).map((id) =>
            chrome.notifications.clear(id),
          ),
        );
        break;
      default:
        throw new Error("Unknown request.");
    }
    await save(next);
    return { ok: true };
  });
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  handle(message, sender)
    .then(sendResponse)
    .catch((error) => sendResponse({ error: error.message }));
  return true;
});
chrome.notifications.onClicked.addListener((id) => {
  const match = id.match(/^channel:(\d+):(\d+)$/);
  if (match) openDiscord(match[1], match[2]).catch(console.error);
  const server = id.match(/^server:(\d+)$/);
  if (server) openDiscord(server[1]).catch(console.error);
  chrome.notifications.clear(id);
});
chrome.tabs.onRemoved.addListener((tabId) =>
  serialize(async () => {
    const reports = (await chrome.storage.session.get("reports")).reports || {};
    delete reports[tabId];
    await chrome.storage.session.set({ reports });
  }),
);

const initialize = () =>
  serialize(async () => {
    await chrome.storage.local.setAccessLevel({
      accessLevel: "TRUSTED_CONTEXTS",
    });
    await chrome.alarms.create("refresh", { periodInMinutes: 1 });
    await renderBadge(await stateFromDisk());
  });
chrome.runtime.onInstalled.addListener(() => {
  initialize().then(refreshTabs).catch(console.error);
});
chrome.runtime.onStartup.addListener(() => {
  initialize().then(refreshTabs).catch(console.error);
});
chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === "refresh") refreshTabs().catch(console.error);
});
