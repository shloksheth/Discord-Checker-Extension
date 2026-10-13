import {
  isWatched,
  totals,
  channelActivity,
  serverOnlyActivity,
} from "./model.js";

const $ = (id) => document.getElementById(id);
let view = "activity";
let showingSettings = false;
let data;
let refreshTimer;

async function request(message) {
  const result = await chrome.runtime.sendMessage(message);
  if (result?.error) throw new Error(result.error);
  return result;
}

function showError(error) {
  $("error").textContent =
    error.message || "Something went wrong. Please try again.";
  $("error").hidden = false;
}

function element(tag, className, value) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (value !== undefined) node.textContent = value;
  return node;
}

async function act(message) {
  try {
    $("error").hidden = true;
    await request(message);
    await load();
  } catch (error) {
    showError(error);
    await load().catch(() => {});
  }
}

async function openDiscord(serverId, channelId) {
  try {
    await request({ type: "OPEN_DISCORD", serverId, channelId });
    window.close();
  } catch (error) {
    showError(error);
  }
}

function emptyList(container, symbol, title, body, button) {
  const block = element("div", "empty");
  block.append(
    element("span", "empty-symbol", symbol),
    element("strong", "", title),
    element("p", "", body),
  );
  if (button) {
    const action = element("button", "primary", button);
    action.addEventListener("click", () => {
      view = "following";
      render();
    });
    block.append(action);
  }
  container.append(block);
}

function renderActivity(state) {
  const container = $("activity-list");
  container.replaceChildren();
  const watched = Object.values(state.channels).filter((channel) =>
    isWatched(state, channel),
  );
  const servers = Object.values(state.servers).filter(
    (server) => serverOnlyActivity(state, server).active,
  );
  if (!watched.length && !state.watch.servers.length) {
    emptyList(
      container,
      "#",
      "Make this space yours.",
      "Follow a server or channel to see its activity here.",
      "Choose channels",
    );
    return;
  }
  for (const server of servers) {
    const activity = serverOnlyActivity(state, server);
    const row = element("button", "channel-row");
    row.addEventListener("click", () => openDiscord(server.id));
    const copy = element("div", "channel-copy");
    copy.append(
      element("strong", "", server.name),
      element("span", "", "Server activity · channels not currently shown"),
    );
    row.append(
      element("span", "hash-icon", "◉"),
      copy,
      element(
        "span",
        "unread-pill",
        activity.count ? `${activity.count}+` : "Unread",
      ),
    );
    container.append(row);
  }
  if (!watched.length && !servers.length) {
    emptyList(
      container,
      "✓",
      "All quiet for now.",
      "Your followed servers will appear here when Discord shows activity. Visit them to discover their channels.",
    );
  }
  watched.sort(
    (a, b) =>
      Number(channelActivity(b).active) - Number(channelActivity(a).active) ||
      a.name.localeCompare(b.name),
  );
  for (const channel of watched) {
    const activity = channelActivity(channel);
    const row = element("button", "channel-row");
    row.addEventListener("click", () =>
      openDiscord(channel.serverId, channel.id),
    );
    row.title = `Open #${channel.name} in Discord. Read at the bottom to clear observed messages.`;
    const copy = element("div", "channel-copy");
    copy.append(
      element("strong", "", channel.name),
      element(
        "span",
        "",
        state.servers[channel.serverId]?.name || "Discord server",
      ),
    );
    const badge = activity.count
      ? `${activity.count}${activity.unknown ? "+" : ""}`
      : activity.unknown
        ? "Unread"
        : "Quiet";
    row.append(
      element("span", "hash-icon", "#"),
      copy,
      element("span", activity.active ? "unread-pill" : "read-pill", badge),
    );
    container.append(row);
  }
}

function renderFollowing(state) {
  const container = $("server-list");
  const query = $("search").value.toLowerCase().trim();
  container.replaceChildren();
  const allChannels = Object.values(state.channels);
  const servers = Object.values(state.servers).sort((a, b) =>
    a.name.localeCompare(b.name),
  );
  let shown = 0;
  for (const server of servers) {
    const serverMatches = server.name.toLowerCase().includes(query);
    const channels = allChannels
      .filter(
        (channel) =>
          channel.serverId === server.id &&
          (serverMatches || channel.name.toLowerCase().includes(query)),
      )
      .sort((a, b) => a.name.localeCompare(b.name));
    if (!serverMatches && !channels.length) continue;
    shown++;
    const card = element("article", "server-card");
    const heading = element("div", "server-heading");
    const name = element("div", "server-name");
    const totalChannels = allChannels.filter(
      (channel) => channel.serverId === server.id,
    ).length;
    name.append(
      element("strong", "", server.name),
      element(
        "small",
        "",
        `${totalChannels} discovered channel${totalChannels === 1 ? "" : "s"}`,
      ),
    );
    const toggle = element("label", "server-toggle", "All");
    const checkbox = element("input");
    checkbox.type = "checkbox";
    checkbox.checked = state.watch.servers.includes(server.id);
    checkbox.indeterminate =
      state.watch.excluded.some(
        (id) => state.channels[id]?.serverId === server.id,
      ) ||
      (!checkbox.checked &&
        allChannels.some(
          (channel) =>
            channel.serverId === server.id && isWatched(state, channel),
        ));
    checkbox.setAttribute(
      "aria-label",
      `Follow all discovered channels in ${server.name}`,
    );
    checkbox.addEventListener("change", () =>
      act({
        type: "SET_WATCH",
        kind: "server",
        id: server.id,
        enabled: checkbox.checked,
      }),
    );
    toggle.append(checkbox);
    const initials = server.name
      .split(/\s+/)
      .slice(0, 2)
      .map((word) => word[0])
      .join("")
      .toUpperCase();
    heading.append(element("span", "server-avatar", initials), name, toggle);
    const list = element("div", "server-channels");
    for (const channel of channels) {
      const label = element("label", "channel-toggle");
      const checked = element("input");
      checked.type = "checkbox";
      checked.checked = isWatched(state, channel);
      checked.setAttribute(
        "aria-label",
        `Follow ${server.name}, #${channel.name}`,
      );
      checked.addEventListener("change", () =>
        act({
          type: "SET_WATCH",
          kind: "channel",
          id: channel.id,
          enabled: checked.checked,
        }),
      );
      label.append(
        element("span", "hash", "#"),
        element("span", "channel-label", channel.name),
        checked,
      );
      list.append(label);
    }
    const visit = element(
      "button",
      "visit-server",
      totalChannels
        ? "Open server to discover more channels ↗"
        : "Visit server to load channels ↗",
    );
    visit.addEventListener("click", () => openDiscord(server.id));
    list.append(visit);
    card.append(heading, list);
    container.append(card);
  }
  if (!shown)
    emptyList(
      container,
      "⌕",
      query ? "No matches." : "Visit a server to get started.",
      query
        ? "Try another server or channel name."
        : "Open a server in Discord, then return here. Its visible channels will appear automatically.",
    );
}

function render() {
  if (!data) return;
  const { state, connection } = data;
  const hasCatalog = Object.keys(state.servers).length > 0;
  const welcome = !connection.connected && !hasCatalog;
  $("welcome").hidden = showingSettings || !welcome;
  $("dashboard").hidden = showingSettings || welcome;
  $("settings-panel").hidden = !showingSettings;
  $("connect").textContent = connection.loginNeeded
    ? "Sign in on Discord ↗"
    : "Open Discord & sign in ↗";
  const activity = totals(state);
  $("total").textContent = activity.count
    ? `${activity.count}${activity.unknown ? "+" : ""}`
    : activity.unknown
      ? "•••"
      : "0";
  $("total-caption").textContent = state.settings.paused
    ? "Paused. Your selections are saved."
    : activity.activeServers
      ? `Activity in ${activity.activeServers} server${activity.activeServers === 1 ? "" : "s"}${activity.activeChannels ? ` and ${activity.activeChannels} channel${activity.activeChannels === 1 ? "" : "s"}` : ""}.`
      : activity.activeChannels
        ? `Activity in ${activity.activeChannels} watched channel${activity.activeChannels === 1 ? "" : "s"}.`
        : "All quiet for now.";
  $("activity-count").textContent =
    activity.activeChannels + activity.activeServers;
  $("connection").replaceChildren(
    element("i"),
    document.createTextNode(
      state.settings.paused
        ? "Checker paused"
        : connection.connected
          ? "Connected to Discord"
          : "Showing last known activity",
    ),
  );
  $("connection").classList.toggle(
    "offline",
    !connection.connected || state.settings.paused,
  );
  $("offline-note").hidden =
    connection.connected && !connection.multipleAccounts;
  $("offline-note").textContent = connection.multipleAccounts
    ? "Multiple Discord accounts are open. Use one account at a time for reliable selections."
    : connection.openTabs
      ? "Waiting for Discord. Sign in, or refresh your Discord tab if you just installed the extension."
      : "Open a Discord web tab to resume checking. Activity below is saved from the last connection.";
  $("activity-tab").classList.toggle("active", view === "activity");
  $("following-tab").classList.toggle("active", view === "following");
  $("activity-tab").setAttribute("aria-selected", String(view === "activity"));
  $("following-tab").setAttribute(
    "aria-selected",
    String(view === "following"),
  );
  $("activity-panel").hidden = view !== "activity";
  $("following-panel").hidden = view !== "following";
  $("notifications").checked = state.settings.notifications;
  $("paused").checked = state.settings.paused;
  $("clear").disabled = activity.activeChannels + activity.activeServers === 0;
  renderActivity(state);
  renderFollowing(state);
}

async function load() {
  data = await request({ type: "GET_STATE" });
  render();
}

$("connect").addEventListener("click", () => openDiscord());
$("open-discord").addEventListener("click", () => openDiscord());
$("activity-tab").addEventListener("click", () => {
  view = "activity";
  render();
});
$("following-tab").addEventListener("click", () => {
  view = "following";
  render();
});
$("settings-button").addEventListener("click", () => {
  showingSettings = !showingSettings;
  render();
});
$("back").addEventListener("click", () => {
  showingSettings = false;
  render();
});
$("search").addEventListener("input", () => renderFollowing(data.state));
$("clear").addEventListener("click", () => act({ type: "DISMISS_ALL" }));
$("notifications").addEventListener("change", () =>
  act({
    type: "SET_SETTINGS",
    settings: { notifications: $("notifications").checked },
  }),
);
$("paused").addEventListener("change", () =>
  act({ type: "SET_SETTINGS", settings: { paused: $("paused").checked } }),
);
$("refresh").addEventListener("click", async () => {
  $("refresh").disabled = true;
  try {
    await request({ type: "REFRESH" });
    await load();
  } catch (error) {
    showError(error);
  } finally {
    $("refresh").disabled = false;
  }
});
$("reset").addEventListener("click", () => {
  $("reset-confirm").hidden = false;
  $("reset").hidden = true;
});
$("reset-cancel").addEventListener("click", () => {
  $("reset-confirm").hidden = true;
  $("reset").hidden = false;
});
$("reset-yes").addEventListener("click", async () => {
  await act({ type: "RESET" });
  $("reset-confirm").hidden = true;
  $("reset").hidden = false;
  showingSettings = false;
  render();
});
chrome.storage.onChanged.addListener((changes, area) => {
  if (!(
    (area === "local" && changes.state) ||
    (area === "session" && changes.reports)
  ))
    return;
  clearTimeout(refreshTimer);
  refreshTimer = setTimeout(() => load().catch(showError), 100);
});
await load().catch(showError);
request({ type: "REFRESH" }).then(load).catch(showError);
