// Keep the counting rules here so the popup and the worker agree on what a badge means.
export const isId = (value) =>
  typeof value === "string" && /^\d{5,22}$/.test(value);
export const emptyState = () => ({
  version: 1,
  account: null,
  servers: {},
  channels: {},
  watch: { servers: [], channels: [], excluded: [] },
  settings: { notifications: false, paused: false, theme: "dark" },
  lastSync: 0,
});

export const serverDisplayName = (server) =>
  server?.nickname || server?.name || "Discord server";

export function setServerPreferences(state, id, preferences) {
  if (!isId(id) || !state.servers[id])
    throw new Error("Visit this server in Discord first.");
  const next = structuredClone(state);
  // Keep the real Discord name for syncing; a nickname belongs only to this browser.
  if (preferences?.nickname !== undefined) {
    if (
      typeof preferences.nickname !== "string" ||
      preferences.nickname.trim().length > 100
    ) {
      throw new Error("Use a server name of 100 characters or fewer.");
    }
    next.servers[id].nickname = preferences.nickname.trim();
  }
  if (preferences?.expanded !== undefined) {
    if (typeof preferences.expanded !== "boolean")
      throw new Error("Invalid channel list preference.");
    next.servers[id].expanded = preferences.expanded;
  }
  return next;
}

export function isWatched(state, channel) {
  return (
    !state.watch.excluded.includes(channel.id) &&
    (state.watch.channels.includes(channel.id) ||
      state.watch.servers.includes(channel.serverId))
  );
}

export function channelActivity(channel) {
  const observed = channel.pending?.length || 0;
  const mentions = channel.mentions || 0;
  const suppressed =
    channel.dismissed &&
    channel.unread === channel.dismissed.unread &&
    mentions <= channel.dismissed.mentions &&
    observed === 0;
  if (suppressed) return { count: 0, unknown: false, active: false };
  // A mention may also be in the rendered messages. Adding the two would count it twice.
  const count = Math.max(observed, mentions);
  const unknown = Boolean(channel.unread);
  return { count, unknown, active: count > 0 || unknown };
}

export function followsWholeServer(state, serverId) {
  return (
    state.watch.servers.includes(serverId) &&
    !state.watch.excluded.some(
      (id) => state.channels[id]?.serverId === serverId,
    )
  );
}

export function serverOnlyActivity(state, server) {
  if (!followsWholeServer(state, server.id))
    return { count: 0, unknown: false, active: false };
  const activity = channelActivity(server);
  const channels = Object.values(state.channels).filter(
    (channel) => channel.serverId === server.id,
  );
  const channelCount = channels.reduce(
    (sum, channel) => sum + channelActivity(channel).count,
    0,
  );
  const channelActive = channels.some(
    (channel) => channelActivity(channel).active,
  );
  return activity.active && (!channelActive || activity.count > channelCount)
    ? activity
    : { count: 0, unknown: false, active: false };
}

export function totals(state) {
  let count = 0;
  let unknown = false;
  let activeChannels = 0;
  let activeServers = 0;
  const byServer = new Map();
  for (const channel of Object.values(state.channels)) {
    if (!isWatched(state, channel)) continue;
    const activity = channelActivity(channel);
    const group = byServer.get(channel.serverId) || {
      count: 0,
      unknown: false,
    };
    group.count += activity.count;
    group.unknown ||= activity.unknown;
    byServer.set(channel.serverId, group);
    if (activity.active) activeChannels++;
  }
  for (const id of state.watch.servers) {
    if (!followsWholeServer(state, id) || !state.servers[id]) continue;
    const activity = channelActivity(state.servers[id]);
    const group = byServer.get(id) || { count: 0, unknown: false };
    // The server's mentions contain its channels' mentions; never add them together.
    group.count = Math.max(group.count, activity.count);
    group.unknown ||= activity.unknown;
    byServer.set(id, group);
    if (serverOnlyActivity(state, state.servers[id]).active) activeServers++;
  }
  for (const group of byServer.values()) {
    count += group.count;
    unknown ||= group.unknown;
  }
  return { count, unknown, activeChannels, activeServers };
}

export function badgeFor(state) {
  if (state.settings.paused) return "Ⅱ";
  const { count, unknown } = totals(state);
  if (count > 99) return "99+";
  if (count) return `${count}${unknown ? "+" : ""}`;
  return unknown ? "•" : "";
}

const cleanName = (value, fallback) =>
  typeof value === "string" && value.trim()
    ? value.trim().slice(0, 100)
    : fallback;
const newer = (left, right) => BigInt(left) > BigInt(right);

export function applySnapshot(state, snapshot, now = Date.now()) {
  const next = structuredClone(state);
  if (!snapshot || snapshot.loggedIn !== true) return next;
  // Visible account identifiers help avoid carrying activity into a different login.
  const account =
    typeof snapshot.account === "string"
      ? snapshot.account.slice(0, 150)
      : null;
  if (account && next.account && account !== next.account) {
    Object.assign(next, emptyState());
    next.settings = { ...state.settings };
  }
  if (account) next.account = account;
  next.lastSync = now;

  for (const server of (snapshot.servers || []).slice(0, 500)) {
    if (!isId(server.id)) continue;
    next.servers[server.id] = {
      ...next.servers[server.id],
      id: server.id,
      name: cleanName(server.name, "Discord server"),
      unread: Boolean(server.unread),
      mentions: Math.max(
        0,
        Math.min(99999, Math.floor(Number(server.mentions) || 0)),
      ),
      lastSeen: now,
    };
    if (!server.unread && !server.mentions)
      next.servers[server.id].dismissed = null;
  }
  for (const channel of (snapshot.channels || []).slice(0, 1000)) {
    if (!isId(channel.id) || !isId(channel.serverId)) continue;
    const old = next.channels[channel.id] || {
      pending: [],
      highWater: null,
      baselineReady: false,
      dismissed: null,
    };
    const mentions = Math.max(
      0,
      Math.min(99999, Math.floor(Number(channel.mentions) || 0)),
    );
    next.channels[channel.id] = {
      ...old,
      id: channel.id,
      serverId: channel.serverId,
      name: cleanName(channel.name, "channel"),
      category: cleanName(channel.category, ""),
      unread: Boolean(channel.unread),
      mentions,
      lastSeen: now,
    };
    if (!channel.unread && !mentions)
      next.channels[channel.id].dismissed = null;
  }

  const current = snapshot.current;
  const channel = current && next.channels[current.channelId];
  if (channel && Array.isArray(current.messageIds)) {
    const ids = [...new Set(current.messageIds.filter(isId))].sort((a, b) =>
      newer(a, b) ? 1 : -1,
    );
    const highest = ids.at(-1);
    if (highest) {
      // The first scan is a baseline. Loading history isn't a new-message event.
      const arrivals =
        channel.baselineReady && current.atLatest === true && channel.highWater
          ? ids.filter((id) => newer(id, channel.highWater))
          : [];
      if (isWatched(next, channel) && !next.settings.paused) {
        channel.pending = [...new Set([...channel.pending, ...arrivals])].slice(
          -999,
        );
        if (arrivals.length) channel.dismissed = null;
      }
      if (!channel.highWater || newer(highest, channel.highWater))
        channel.highWater = highest;
      if (current.atLatest === true) channel.baselineReady = true;
    }
    if (current.reading === true && current.atLatest === true) {
      channel.pending = [];
      // Discord can update its sidebar a moment after a channel is opened.
      channel.dismissed = {
        unread: channel.unread,
        mentions: channel.mentions,
      };
    }
  }
  return next;
}

export function setWatch(state, kind, id, enabled) {
  if (!isId(id) || !["server", "channel"].includes(kind))
    throw new Error("Invalid selection.");
  const next = structuredClone(state);
  const update = (items, value, add) =>
    add
      ? [...new Set([...items, value])]
      : items.filter((item) => item !== value);
  if (kind === "server") {
    if (!next.servers[id])
      throw new Error("Visit this server in Discord first.");
    next.watch.servers = update(next.watch.servers, id, enabled);
    next.servers[id].dismissed = null;
    const belongs = (value) => next.channels[value]?.serverId === id;
    next.watch.channels = next.watch.channels.filter(
      (value) => !belongs(value),
    );
    next.watch.excluded = next.watch.excluded.filter(
      (value) => !belongs(value),
    );
  } else {
    const channel = next.channels[id];
    if (!channel) throw new Error("Visit this channel in Discord first.");
    if (next.watch.servers.includes(channel.serverId)) {
      next.watch.excluded = update(next.watch.excluded, id, !enabled);
      next.watch.channels = update(next.watch.channels, id, false);
    } else {
      next.watch.channels = update(next.watch.channels, id, enabled);
      next.watch.excluded = update(next.watch.excluded, id, false);
    }
  }
  // Start a fresh count when a channel's subscription changes.
  for (const channel of Object.values(next.channels)) {
    if (
      isWatched(next, channel) !== isWatched(state, state.channels[channel.id])
    ) {
      channel.pending = [];
      channel.dismissed = null;
    }
  }
  return next;
}

export function dismissAll(state) {
  const next = structuredClone(state);
  for (const channel of Object.values(next.channels)) {
    channel.pending = [];
    channel.dismissed = { unread: channel.unread, mentions: channel.mentions };
  }
  for (const server of Object.values(next.servers)) {
    server.dismissed = { unread: server.unread, mentions: server.mentions };
  }
  return next;
}
