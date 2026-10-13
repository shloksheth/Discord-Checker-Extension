import { chromium, expect } from "@playwright/test";
import { mkdtemp, mkdir, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  discordMarkup,
  serverId,
  secondServerId,
  channelId,
  secondChannelId,
  firstMessage,
  secondMessage,
} from "./fixtures.js";

const extensionPath = path.resolve("extension");
const profile = await mkdtemp(path.join(tmpdir(), "discord-checker-test-"));
const screenshots = path.resolve("test-results");
await mkdir(screenshots, { recursive: true });
const context = await chromium.launchPersistentContext(profile, {
  channel: "chromium",
  headless: true,
  args: [
    `--disable-extensions-except=${extensionPath}`,
    `--load-extension=${extensionPath}`,
  ],
});
const errors = [];
context.on("page", (page) =>
  page.on("pageerror", (error) => errors.push(error.message)),
);

try {
  const worker =
    context.serviceWorkers()[0] ||
    (await context.waitForEvent("serviceworker"));
  const extensionId = new URL(worker.url()).hostname;
  const getState = () =>
    worker.evaluate(
      async () => (await chrome.storage.local.get("state")).state,
    );
  const getBadge = () => worker.evaluate(() => chrome.action.getBadgeText({}));
  const popup = await context.newPage();
  await popup.setViewportSize({ width: 420, height: 600 });
  await popup.goto(`chrome-extension://${extensionId}/popup.html`);
  await expect(popup.locator("#welcome")).toBeVisible();
  await popup.screenshot({
    path: path.join(screenshots, "welcome.png"),
    fullPage: true,
  });

  await context.route("https://discord.com/**", (route) =>
    route.fulfill({ contentType: "text/html", body: discordMarkup() }),
  );
  await context.route("https://cdn.discordapp.com/**", async (route) =>
    route.fulfill({
      contentType: "image/png",
      body: Buffer.from(
        await readFile(path.join(extensionPath, "icons/16.png")),
      ),
    }),
  );
  const discord = await context.newPage();
  await discord.goto(`https://discord.com/channels/${serverId}/${channelId}`);
  await popup.bringToFront();
  await expect
    .poll(async () => Object.keys((await getState())?.channels || {}).length)
    .toBe(2);
  await expect(popup.locator("#dashboard")).toBeVisible();
  await popup.locator("#following-tab").click();
  await expect(popup.locator(".server-card")).toHaveCount(2);
  const generalCheck = popup.getByRole("checkbox", {
    name: "Follow Design Buddies, #general",
    exact: true,
  });
  await generalCheck.check();
  await expect
    .poll(async () => (await getState()).watch.channels)
    .toContain(channelId);
  await expect(generalCheck).toBeChecked();
  await popup.screenshot({
    path: path.join(screenshots, "following.png"),
    fullPage: true,
  });

  // Add a genuine arrival after the content script's baseline. The Discord tab is hidden.
  await discord.evaluate(
    ({ channelId, secondMessage }) => {
      const row = document.createElement("li");
      row.id = `chat-messages-${channelId}-${secondMessage}`;
      row.textContent = "A new message";
      document.querySelector('[data-list-id="chat-messages"]').append(row);
      const scroller = document.querySelector('[class*="scroller_"]');
      scroller.scrollTop = scroller.scrollHeight;
    },
    { channelId, secondMessage },
  );
  await expect.poll(getBadge).toBe("1");
  await popup.locator("#activity-tab").click();
  await expect(popup.locator("#total")).toHaveText("1");
  await expect(popup.locator(".channel-row .unread-pill")).toHaveText("1");
  await popup.screenshot({
    path: path.join(screenshots, "activity.png"),
    fullPage: true,
  });

  // Two tabs observing the same IDs must not produce two message counts.
  const otherTabPromise = context.waitForEvent("page");
  await worker.evaluate(async () => {
    await chrome.tabs.create({ url: "about:blank", active: false });
  });
  const otherTab = await otherTabPromise;
  await otherTab.goto(`https://discord.com/channels/${serverId}/${channelId}`);
  await expect(
    otherTab.locator('[data-list-id="chat-messages"]'),
  ).toBeAttached();
  await popup.bringToFront();
  await otherTab.evaluate(
    ({ channelId, secondMessage }) => {
      const row = document.createElement("li");
      row.id = `chat-messages-${channelId}-${secondMessage}`;
      document.querySelector('[data-list-id="chat-messages"]').append(row);
      const scroller = document.querySelector('[class*="scroller_"]');
      scroller.scrollTop = scroller.scrollHeight;
    },
    { channelId, secondMessage },
  );
  await worker.evaluate(async () => {
    const tabs = await chrome.tabs.query({ url: "https://discord.com/*" });
    await Promise.all(
      tabs.map((tab) => chrome.tabs.sendMessage(tab.id, { type: "SCAN" })),
    );
  });
  await expect.poll(getBadge).toBe("1");
  await otherTab.close();

  await discord.evaluate(
    ({ channelId }) => {
      const row = document.querySelector(
        `[data-list-item-id="channels___${channelId}"]`,
      );
      row.classList.add("unread_fixture");
      const badge = document.createElement("span");
      badge.className = "numberBadge_fixture";
      badge.textContent = "3";
      row.append(badge);
    },
    { channelId },
  );
  await expect.poll(getBadge).toBe("3+");
  await expect(popup.locator("#total")).toHaveText("3+");
  await popup.locator("#clear").click();
  await expect.poll(getBadge).toBe("");
  await popup.locator("#refresh").click();
  await expect.poll(getBadge).toBe("");

  await popup.locator("#following-tab").click();
  await popup
    .getByRole("checkbox", {
      name: "Follow all discovered channels in Design Buddies",
      exact: true,
    })
    .check();
  await expect
    .poll(async () => (await getState()).watch.servers)
    .toContain(serverId);
  await popup
    .getByRole("checkbox", {
      name: "Follow Design Buddies, #inspiration",
      exact: true,
    })
    .uncheck();
  await expect
    .poll(async () => (await getState()).watch.excluded)
    .toContain(secondChannelId);
  await popup.locator("#search").fill("inspiration");
  await expect(popup.locator(".server-card")).toHaveCount(1);
  await expect(popup.locator(".channel-toggle")).toHaveCount(1);

  await popup.locator("#settings-button").click();
  await popup.locator("#paused").check();
  await expect.poll(getBadge).toBe("Ⅱ");
  await popup.locator("#paused").uncheck();
  await expect.poll(getBadge).toBe("");
  await popup.locator("#notifications").check();
  await expect
    .poll(async () => (await getState()).settings.notifications)
    .toBe(true);
  await popup.screenshot({
    path: path.join(screenshots, "settings.png"),
    fullPage: true,
  });

  // Verify real desktop-notification API calls, not just the preference toggle.
  await discord.evaluate(
    ({ channelId }) => {
      const row = document.querySelector(
        `[data-list-item-id="channels___${channelId}"]`,
      );
      row.querySelector('[class*="numberBadge_"]').textContent = "4";
    },
    { channelId },
  );
  await expect
    .poll(() =>
      worker.evaluate(
        async () => Object.keys(await chrome.notifications.getAll()).length,
      ),
    )
    .toBe(1);
  await popup.locator("#back").click();
  await popup.locator("#activity-tab").click();
  await expect(popup.locator("#total")).toHaveText("4+");
  await popup.screenshot({
    path: path.join(screenshots, "activity.png"),
    fullPage: true,
  });

  // Navigating through the popup must open the selected Discord destination.
  const destination = await context.newPage();
  await destination.goto(`chrome-extension://${extensionId}/popup.html`);
  await destination.locator(".channel-row").first().click();
  await expect
    .poll(async () =>
      (
        await context
          .pages()
          .find((page) => page.url().startsWith("https://discord.com/"))
      )?.url(),
    )
    .toBe(`https://discord.com/channels/${serverId}/${channelId}`);
  await expect
    .poll(async () => (await getState()).channels[channelId].pending.length)
    .toBe(0);

  // A full-server subscription can use the server icon while its channel list is absent.
  await popup.bringToFront();
  await popup.locator("#following-tab").click();
  await popup.locator("#search").fill("");
  await popup
    .getByRole("checkbox", {
      name: "Follow all discovered channels in Study Club",
      exact: true,
    })
    .check();
  await discord.evaluate(
    ({ secondServerId }) => {
      document
        .querySelector(`[data-list-item-id="guildsnav___${secondServerId}"]`)
        .setAttribute("aria-label", "Study Club, 6 mentions");
    },
    { secondServerId },
  );
  await expect.poll(getBadge).toBe("6+");
  await popup.locator("#activity-tab").click();
  await expect(
    popup.locator(".channel-row").filter({ hasText: "Server activity" }),
  ).toContainText("Study Club");
  await expect(popup.locator("#total")).toHaveText("6+");
  await expect
    .poll(() =>
      worker.evaluate(
        async () => Object.keys(await chrome.notifications.getAll()).length,
      ),
    )
    .toBe(2);
  await popup.screenshot({
    path: path.join(screenshots, "servers.png"),
    fullPage: true,
  });
  await popup.locator("#clear").click();
  await expect.poll(getBadge).toBe("");

  // Offline is saved activity, not a false live connection.
  for (const page of context
    .pages()
    .filter((page) => page.url().startsWith("https://discord.com/")))
    await page.close();
  await popup.bringToFront();
  await popup.locator("#refresh").click();
  await expect(popup.locator("#offline-note")).toContainText(
    "Open a Discord web tab",
  );

  // Server/channel names are rendered as text, even if a server uses HTML-looking names.
  await worker.evaluate(
    async ({ serverId }) => {
      const { state } = await chrome.storage.local.get("state");
      state.servers[serverId].name = "<img src=x onerror=alert(1)>";
      await chrome.storage.local.set({ state });
    },
    { serverId },
  );
  await popup.locator("#following-tab").click();
  await popup.locator("#search").fill("");
  await expect(popup.locator(".server-name strong").first()).toHaveText(
    "<img src=x onerror=alert(1)>",
  );
  await expect(popup.locator(".server-name img")).toHaveCount(0);

  await popup.locator("#settings-button").click();
  await popup.locator("#reset").click();
  await popup.locator("#reset-yes").click();
  await expect(popup.locator("#welcome")).toBeVisible();
  await expect.poll(getBadge).toBe("");
  await expect
    .poll(() =>
      worker.evaluate(
        async () => Object.keys(await chrome.notifications.getAll()).length,
      ),
    )
    .toBe(0);
  assertNoPageErrors(errors);
  console.log(
    "Browser checks passed: actual MV3 worker, discovery, selection, new messages, deduplication, mentions, server summaries, dismissal, notifications, pause, links, offline, safe names, and reset.",
  );
  console.log(`Screenshots: ${screenshots}`);
} catch (error) {
  const worker = context.serviceWorkers()[0];
  if (worker)
    console.error(
      "State at failure:",
      JSON.stringify(
        await worker.evaluate(
          async () => await chrome.storage.local.get("state"),
        ),
      ),
    );
  for (const page of context
    .pages()
    .filter((page) => page.url().startsWith("https://discord.com/"))) {
    console.error(
      "Discord tab at failure:",
      await page.evaluate(() => ({
        visible: document.visibilityState,
        focused: document.hasFocus(),
        scrollerHeight: document.querySelector('[class*="scroller_"]')
          ?.clientHeight,
      })),
    );
  }
  throw error;
} finally {
  await context.close();
}

function assertNoPageErrors(errors) {
  if (errors.length) throw new Error(`Browser errors: ${errors.join("; ")}`);
}
