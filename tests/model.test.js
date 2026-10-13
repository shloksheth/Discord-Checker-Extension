import test from "node:test";
import assert from "node:assert/strict";
import {
  emptyState,
  applySnapshot,
  setWatch,
  dismissAll,
  isWatched,
  badgeFor,
  totals,
  serverOnlyActivity,
} from "../extension/model.js";
import {
  snapshot,
  serverId,
  secondServerId,
  channelId,
  secondChannelId,
  firstMessage,
  secondMessage,
} from "./fixtures.js";

const followed = () =>
  setWatch(applySnapshot(emptyState(), snapshot()), "channel", channelId, true);
const withMessages = (state, ids, flags = {}) =>
  applySnapshot(
    state,
    snapshot({
      current: {
        channelId,
        messageIds: ids,
        reading: false,
        atLatest: true,
        ...flags,
      },
    }),
  );

test("first scan establishes a baseline, never counts existing history", () => {
  const state = followed();
  assert.equal(badgeFor(state), "");
  assert.equal(state.channels[channelId].highWater, firstMessage);
  assert.equal(state.channels[channelId].baselineReady, true);
});

test("new messages count once across repeated scans, out-of-order history, and multiple tabs", () => {
  let state = withMessages(followed(), [
    firstMessage,
    secondMessage,
    secondMessage,
  ]);
  assert.equal(badgeFor(state), "1");
  state = withMessages(state, [secondMessage, firstMessage]);
  state = withMessages(state, [firstMessage]);
  assert.equal(badgeFor(state), "1");
  assert.equal(state.channels[channelId].highWater, secondMessage);
});

test("only watched channels count; selecting the server includes future discovered channels", () => {
  let state = applySnapshot(emptyState(), snapshot());
  state = withMessages(state, [firstMessage, secondMessage]);
  assert.equal(badgeFor(state), "");
  state = setWatch(state, "server", serverId, true);
  assert.equal(isWatched(state, state.channels[secondChannelId]), true);
  state = setWatch(state, "channel", channelId, false);
  assert.equal(isWatched(state, state.channels[channelId]), false);
  state = applySnapshot(
    state,
    snapshot({
      channels: [
        {
          id: "200000000000000003",
          serverId,
          name: "new-channel",
          unread: true,
        },
      ],
    }),
  );
  assert.equal(isWatched(state, state.channels["200000000000000003"]), true);
  assert.equal(badgeFor(state), "•");
  state = setWatch(state, "server", serverId, false);
  assert.equal(totals(state).activeChannels, 0);
});

test("mentions are a lower bound, not an exact total or added twice to observed messages", () => {
  let state = withMessages(followed(), [firstMessage, secondMessage]);
  state = applySnapshot(
    state,
    snapshot({
      channels: [
        { id: channelId, serverId, name: "general", mentions: 1, unread: true },
      ],
    }),
  );
  assert.equal(badgeFor(state), "1+");
  assert.equal(totals(state).count, 1);
  state = applySnapshot(
    state,
    snapshot({
      channels: [
        { id: channelId, serverId, name: "general", mentions: 8, unread: true },
      ],
    }),
  );
  assert.equal(badgeFor(state), "8+");
});

test("reading clears observed activity only with focus and at the latest messages", () => {
  let state = withMessages(followed(), [firstMessage, secondMessage]);
  state = withMessages(state, [secondMessage], {
    reading: true,
    atLatest: false,
  });
  assert.equal(badgeFor(state), "1");
  state = withMessages(state, [secondMessage], {
    reading: true,
    atLatest: true,
  });
  assert.equal(badgeFor(state), "");
});

test("loading forward through old history before reaching the bottom is not an arrival", () => {
  let state = applySnapshot(
    emptyState(),
    snapshot({
      current: {
        channelId,
        messageIds: [firstMessage],
        atLatest: false,
        reading: false,
      },
    }),
  );
  state = setWatch(state, "channel", channelId, true);
  state = withMessages(state, [secondMessage], { atLatest: false });
  state = withMessages(state, [secondMessage]);
  assert.equal(badgeFor(state), "");
  state = withMessages(state, [secondMessage, "300000000000000003"]);
  assert.equal(badgeFor(state), "1");
});

test("clearing extension counts suppresses the same unread signal, but not new activity", () => {
  let state = applySnapshot(
    followed(),
    snapshot({
      channels: [{ id: channelId, serverId, unread: true, mentions: 2 }],
    }),
  );
  state = dismissAll(state);
  assert.equal(badgeFor(state), "");
  state = applySnapshot(
    state,
    snapshot({
      channels: [{ id: channelId, serverId, unread: true, mentions: 2 }],
    }),
  );
  assert.equal(badgeFor(state), "");
  state = applySnapshot(
    state,
    snapshot({
      channels: [{ id: channelId, serverId, unread: true, mentions: 3 }],
    }),
  );
  assert.equal(badgeFor(state), "3+");
  state = dismissAll(state);
  state = withMessages(state, [firstMessage, secondMessage]);
  assert.equal(badgeFor(state), "1");
});

test("account changes remove selections and cached activity, retaining preferences", () => {
  let state = followed();
  state.settings.notifications = true;
  state = applySnapshot(
    state,
    snapshot({
      account: "id:900000000000000002",
      servers: [{ id: secondServerId, name: "Other account" }],
      channels: [],
      current: null,
    }),
  );
  assert.deepEqual(state.watch, { channels: [], servers: [], excluded: [] });
  assert.deepEqual(Object.keys(state.servers), [secondServerId]);
  assert.equal(Object.keys(state.channels).length, 0);
  assert.equal(state.settings.notifications, true);
});

test("pause skips arrivals, and its high-water update prevents a backlog on resume", () => {
  let state = followed();
  state.settings.paused = true;
  state = withMessages(state, [firstMessage, secondMessage]);
  assert.equal(badgeFor(state), "Ⅱ");
  assert.deepEqual(state.channels[channelId].pending, []);
  state.settings.paused = false;
  state = withMessages(state, [firstMessage, secondMessage]);
  assert.equal(badgeFor(state), "");
});

test("bad inputs are rejected and IDs retain snowflake precision", () => {
  const state = applySnapshot(
    emptyState(),
    snapshot({ channels: [{ id: "__proto__", serverId, name: "bad" }] }),
  );
  assert.equal(Object.keys(state.channels).length, 0);
  assert.throws(() => setWatch(state, "channel", "not-an-id", true), /Invalid/);
  let precision = followed();
  precision.channels[channelId].highWater = "900719925474099200";
  precision = withMessages(precision, ["900719925474099201"]);
  assert.equal(badgeFor(precision), "1");
});

test("large activity is capped on the badge without losing its minimum count", () => {
  const state = applySnapshot(
    followed(),
    snapshot({
      channels: [{ id: channelId, serverId, mentions: 150, unread: true }],
    }),
  );
  assert.equal(badgeFor(state), "99+");
  assert.equal(totals(state).count, 150);
});

test("a whole-server selection reads server activity without opening its channels", () => {
  let state = applySnapshot(
    emptyState(),
    snapshot({
      servers: [
        { id: secondServerId, name: "Study Club", unread: true, mentions: 5 },
      ],
      channels: [],
      current: null,
    }),
  );
  state = setWatch(state, "server", secondServerId, true);
  assert.equal(badgeFor(state), "5+");
  assert.equal(totals(state).activeServers, 1);
  assert.equal(
    serverOnlyActivity(state, state.servers[secondServerId]).active,
    true,
  );
  state = dismissAll(state);
  assert.equal(badgeFor(state), "");
});

test("server mentions overlap channel mentions; an excluded channel disables server aggregates", () => {
  let state = applySnapshot(
    emptyState(),
    snapshot({
      servers: [
        { id: serverId, name: "Design Buddies", unread: true, mentions: 8 },
      ],
      channels: [
        { id: channelId, serverId, name: "general", unread: true, mentions: 3 },
        {
          id: secondChannelId,
          serverId,
          name: "inspiration",
          unread: true,
          mentions: 2,
        },
      ],
      current: null,
    }),
  );
  state = setWatch(state, "server", serverId, true);
  assert.equal(totals(state).count, 8);
  assert.equal(badgeFor(state), "8+");
  state = setWatch(state, "channel", secondChannelId, false);
  assert.equal(totals(state).count, 3);
  assert.equal(totals(state).activeServers, 0);
});
