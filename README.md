# Discord Checker

A Chrome / Edge extension that follows selected Discord servers and channels. Open the popup to see activity, click a channel to open it, and check the Discord logo's badge for new activity.

## Install

1. Open `chrome://extensions` in Chrome or `edge://extensions` in Edge.
2. Turn on **Developer mode**.
3. Click **Load unpacked** and select this project's **extension** folder.
4. Pin **Discord Checker** using the browser's extensions menu.
5. Click the Discord icon, choose **Open Discord & sign in**, and sign in on Discord's website. If Discord was already open when you installed the extension, refresh that tab once.
6. Visit a server in Discord, open the popup's **Following** tab, and check the channels you want. **All** follows every discovered channel in that server, including channels discovered later, and uses the server's sidebar indicator for activity in channels not currently shown. Uncheck individual channels to exclude them.

No build, Discord application registration, bot, password entry into the extension, or account token is required. Leave at least one signed-in **Discord web tab** open. The native desktop Discord app alone is insufficient.

## Appearance and organization

- **Dark mode** is the default. Use the sun button in the header to switch between dark and light, or choose **Dark**, **Light**, or **System** under **Settings → Appearance**. Your preference is saved and shared with the full-tab view.
- In **Following**, click the arrow next to a server to expand or collapse its channels. Servers start collapsed, and your choices are saved. Searching opens matching lists so you can find channels quickly.
- Click the pencil beside a server to give it a custom display name. This only changes its name in the extension and its notifications. Leave the field blank to restore Discord's name; syncing Discord activity preserves your custom name.
- The **Open in new tab** button beside Settings opens a larger dashboard with the same selections, names, and appearance. Channel links open Discord while keeping that dashboard available.

After updating an unpacked installation, click **Reload** on its browser extensions page and refresh your Discord tab once.

## What the badge means

- **A number:** known new messages observed in the rendered channel after a baseline scan, or its mention count, whichever is higher. The same message appearing in multiple scans/tabs is counted once.
- **A number with `+`:** at least that many; Discord also indicates unread activity and does not expose the total.
- **A dot:** unread activity exists, but no count is available.
- **No badge:** no known activity in the channels you follow.
- **Ⅱ:** paused.

Ordinary Discord OAuth cannot read arbitrary messages in your existing servers ([Discord's OAuth documentation](https://github.com/discord/discord-api-docs/blob/main/developers/topics/oauth2.mdx)). This version observes only rendered Discord web navigation and message IDs. It never extracts account credentials, accesses Discord's internal application stores, or calls the private user API.

**This is a lower-bound activity checker, not an exact unread-message counter for every server.** A precise cross-server counter is not available from the visible page. Entire-server subscriptions also observe visible server-icon mention badges and unread pills, so they can show a server summary while another server is open. Server/channel mention totals overlap, so the badge uses the larger total for each server rather than adding both. Excluding any channel disables this aggregate server indicator, because it cannot identify which channel caused the activity.

Visit each server and expand any collapsed categories to discover its channels. Channels outside the currently rendered sidebar retain their last known status. Background messages can be missed when their channel/server indicator is not displayed, Discord mutes its unread indicator, or an unread dot does not change between messages. Specific-channel checks cannot identify new messages from a server's aggregate indicator. Direct messages, forum post discovery, threads absent from the sidebar, and voice/video channels are not supported. No messages are fetched while the Discord tab is closed, suspended, discarded, or offline; Discord may throttle a background tab. Refresh in the popup requests another page scan and cannot load undisplayed data. Opening the popup itself does not mark messages read.

Open a channel and read at the bottom of the message list to clear observed counts. **Clear counts** dismisses counts in the extension only; it does not mark messages as read in Discord. The same unread signal remains suppressed until a change in that signal or a newly observed message. Deleted messages can remain counted until you clear/read the channel. To avoid counting previously unseen history as an arrival, the extension starts with a baseline; messages never rendered between scans cannot be counted. The observed counter keeps up to 999 pending message IDs per channel.

## Notifications and privacy

In **Settings**, enable optional desktop notifications, pause the checker, or forget local data. Notifications open the relevant Discord channel when clicked and are limited to one per channel every 30 seconds. Your operating system must allow browser notifications.

All data is stored locally in this browser: server/channel names and IDs, watch selections, rendered message IDs, and counts. No analytics, remote backend, message bodies, cookies, passwords, or account tokens are stored. The extension only runs on `https://discord.com/`. Permission to display notifications is included; notifications are off until enabled in Settings. A browser alarm requests a rescan once per minute.

Use one Discord account at a time. A recognized account change or confirmed sign-out resets the catalog, counts, and selections; pause/notification preferences are retained. Account recognition uses an account avatar ID or visible username when available. If Discord does not render those identifiers, use **Forget local data** before switching accounts. Forgetting data clears the local catalog, which will be rediscovered when the open Discord page is scanned again.

Discord can change its webpage structure. This reader relies on navigation links, accessibility labels, and a few class-name prefixes; its selectors may need updating after a Discord redesign. No claim of Discord endorsement. The Discord logo belongs to Discord.

## Development

```sh
npm install
npx playwright install chromium
npm test
npm run test:browser
npm run package
```

There are no production dependencies. Node's test runner verifies counting, deduplication, selections, account resets, and DOM parsing against representative Discord markup. The browser check uses Playwright's downloaded Chromium and a temporary profile to load the actual extension with controlled Discord page fixtures, check worker/popup behavior, and save popup screenshots. It does not sign into your account. These fixtures do not substitute for validation against the current signed-in Discord interface.

The PNG icons are already included. Use `npm run icons` after editing the SVG logo. The distributable is `dist/discord-checker.zip`. Extract it and load the extracted folder with **Load unpacked**; browsers do not load that ZIP directly.
