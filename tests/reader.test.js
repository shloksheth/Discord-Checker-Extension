import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { JSDOM } from "jsdom";
import {
  discordMarkup,
  serverId,
  channelId,
  firstMessage,
} from "./fixtures.js";

const source = readFileSync(
  new URL("../extension/reader.js", import.meta.url),
  "utf8",
);
function read(options = {}, customize = () => {}) {
  const dom = new JSDOM(discordMarkup(options), {
    url: `https://discord.com/channels/${serverId}/${channelId}`,
    runScripts: "outside-only",
  });
  customize(dom.window.document);
  dom.window.eval(source);
  return dom.window.DiscordReader.readSnapshot(
    dom.window.document,
    dom.window.location,
  );
}

test("discovers servers and sidebar channels, excluding message permalinks", () => {
  const data = read();
  assert.equal(data.loggedIn, true);
  assert.equal(data.account, "id:900000000000000001");
  assert.deepEqual(
    Array.from(data.servers, (server) => server.name),
    ["Design Buddies", "Study Club"],
  );
  assert.equal(data.channels.length, 2);
  assert.equal(data.channels[0].name, "general");
  assert.deepEqual([...data.current.messageIds], [firstMessage]);
});

test("detects unread dots independently from mention counts", () => {
  assert.equal(read({ unread: true }).channels[0].unread, true);
  assert.equal(read({ unread: true }).channels[0].mentions, 0);
  assert.equal(read({ mentions: 4 }).channels[0].mentions, 4);
  const capped = read({ mentions: 99 }, (document) => {
    document.querySelector('[class*="numberBadge_"]').textContent = "99+";
  });
  assert.equal(capped.channels[0].mentions, 99);
});

test("read state requires focus, visibility, and a scroller at its end", () => {
  const data = read({}, (document) => {
    document.hasFocus = () => true;
    Object.defineProperty(document, "visibilityState", { value: "visible" });
    const scroller = document.querySelector('[class*="scroller_"]');
    Object.defineProperties(scroller, {
      clientHeight: { value: 100 },
      scrollHeight: { value: 500 },
      scrollTop: { value: 400 },
    });
  });
  assert.equal(data.current.reading, true);
  assert.equal(data.current.atLatest, true);
});

test("a short channel at the bottom can still be read", () => {
  const data = read({}, (document) => {
    const scroller = document.querySelector('[class*="scroller_"]');
    Object.defineProperties(scroller, {
      clientHeight: { value: 120 },
      scrollHeight: { value: 120 },
      scrollTop: { value: 0 },
    });
  });
  assert.equal(data.current.atLatest, true);
});

test("login forms are detected without reading entered credentials", () => {
  const data = read({ login: true }, (document) => {
    document.querySelector('[name="password"]').value = "never-read-this";
  });
  assert.equal(data.loggedIn, false);
  assert.equal(data.loginScreen, true);
  assert.equal(JSON.stringify(data).includes("never-read-this"), false);
  assert.equal(data.channels.length, 0);
});

test("server mentions and short unread pills survive while another server is active", () => {
  const data = read({}, (document) => {
    const server = document.querySelectorAll(
      '[data-list-item-id^="guildsnav___"]',
    )[1];
    server.setAttribute("aria-label", "Study Club, 6 mentions");
    const pill = document.createElement("div");
    pill.className = "pill_fixture";
    pill.innerHTML = '<span style="height:8px;opacity:1"></span>';
    server.append(pill);
  });
  assert.equal(data.servers[1].mentions, 6);
  assert.equal(data.servers[1].unread, true);
  assert.equal(data.servers[1].name, "Study Club");
  const selected = read({}, (document) => {
    const server = document.querySelectorAll(
      '[data-list-item-id^="guildsnav___"]',
    )[1];
    server.innerHTML =
      '<div class="pill_fixture"><span style="height:40px;opacity:1"></span></div>';
  });
  assert.equal(selected.servers[1].unread, false);
});
