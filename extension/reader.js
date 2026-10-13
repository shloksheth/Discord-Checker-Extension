// Only read what Discord renders. There are no account tokens or private API calls here.
(function () {
  const channelPath = /\/channels\/(\d{5,22})\/(\d{5,22})(?:\/|$)/;
  const serverPath = /\/channels\/(\d{5,22})(?:\/|$)/;
  const text = (element) => element?.textContent?.trim() || "";
  const hasClass = (element, prefix) =>
    [...(element?.classList || [])].some((name) => name.startsWith(prefix));

  function readServerName(element, id) {
    const image = element.querySelector("img");
    const label =
      element.getAttribute("aria-label") ||
      image?.getAttribute("alt") ||
      text(element);
    return (
      label
        .replace(/,?\s*\d+\s+(?:mentions?|unread messages?).*$/i, "")
        .replace(/,?\s*(?:unread|selected).*$/i, "")
        .trim() || `Server ${id.slice(-4)}`
    );
  }

  function readSnapshot(document, location) {
    const servers = new Map();
    const channels = new Map();
    const guildItems = document.querySelectorAll(
      '[data-list-item-id^="guildsnav___"], nav[aria-label*="Servers"] a[href^="/channels/"], [aria-label="Servers"] a[href^="/channels/"]',
    );
    for (const item of guildItems) {
      const key = item.getAttribute("data-list-item-id") || "";
      const id =
        key.match(/^guildsnav___(\d{5,22})$/)?.[1] ||
        item.getAttribute("href")?.match(serverPath)?.[1];
      if (!id) continue;
      const row = item.closest('[class*="listItem_"]') || item;
      const label = item.getAttribute("aria-label") || "";
      const badge = row.querySelector('[class*="numberBadge_"]');
      const mentions = Number(
        text(badge).match(/^(\d+)\+?$/)?.[1] ||
          label.match(/(\d+)\s+mentions?/i)?.[1] ||
          0,
      );
      const pill = row.querySelector('[class*="pill_"] [style]');
      const height = parseFloat(pill?.style.height || "0");
      const unreadPill =
        height > 0 && height <= 8 && pill?.style.opacity !== "0";
      servers.set(id, {
        id,
        name: readServerName(item, id),
        mentions,
        unread: mentions > 0 || /\bunread\b/i.test(label) || unreadPill,
      });
    }

    const active = location.pathname.match(channelPath);
    const sidebar = document.querySelector(
      '[data-list-id="channels"], nav[aria-label*="Channels"], [class*="sidebarList_"]',
    );
    // Restrict this to navigation, otherwise message permalinks look like channels.
    for (const anchor of sidebar?.querySelectorAll('a[href*="/channels/"]') ||
      []) {
      const match = anchor.getAttribute("href")?.match(channelPath);
      if (!match) continue;
      const [, serverId, id] = match;
      const row =
        anchor.closest(
          '[data-list-item-id^="channels___"], [class*="containerDefault_"]',
        ) || anchor;
      const nameNode = anchor.querySelector(
        '[class*="name_"], [class*="channelName_"]',
      );
      const label = anchor.getAttribute("aria-label") || "";
      const name =
        text(nameNode) ||
        label.replace(/,.*$/, "").replace(/^#\s*/, "") ||
        text(anchor);
      const badge = row.querySelector(
        '[class*="numberBadge_"], [data-unread-count]',
      );
      const badgeText = badge?.getAttribute("data-unread-count") || text(badge);
      const mentionLabel = label.match(
        /(\d+)\s+(?:mentions?|unread messages?)/i,
      );
      const mentions = Number(
        badgeText.match(/^(\d+)\+?$/)?.[1] || mentionLabel?.[1] || 0,
      );
      const unread =
        mentions > 0 ||
        hasClass(row, "unread_") ||
        hasClass(anchor, "unread_") ||
        Boolean(row.querySelector('[class*="unread_"]')) ||
        /\bunread\b/i.test(label);
      channels.set(id, { id, serverId, name, unread, mentions });
    }

    if (active) {
      const serverId = active[1];
      const header = document.querySelector(
        '[class*="sidebar_"] [class*="header_"] [class*="name_"], [class*="sidebarList_"] [class*="header_"] [class*="name_"]',
      );
      if (header)
        servers.set(serverId, {
          ...servers.get(serverId),
          id: serverId,
          name: text(header),
        });
    }

    const panel = document.querySelector('[class*="panels_"]');
    const avatar = panel?.querySelector('img[src*="/avatars/"]');
    const accountId = avatar
      ?.getAttribute("src")
      ?.match(/\/avatars\/(\d{5,22})\//)?.[1];
    const accountName = text(
      panel?.querySelector(
        '[class*="nameTag_"] [class*="title_"], [class*="username_"]',
      ),
    );
    const loggedIn = guildItems.length > 0 || Boolean(sidebar);
    const loginScreen = Boolean(
      document.querySelector('input[name="email"], input[name="password"]'),
    );
    let current = null;
    if (active && channels.has(active[2])) {
      const channelId = active[2];
      const messageIds = [
        ...document.querySelectorAll(
          `[id^="chat-messages-${channelId}-"], [data-list-item-id^="chat-messages___${channelId}-"]`,
        ),
      ]
        .map(
          (element) =>
            (element.id || element.getAttribute("data-list-item-id")).match(
              /(\d{5,22})$/,
            )?.[1],
        )
        .filter(Boolean);
      const messages = document.querySelector('[data-list-id="chat-messages"]');
      let scroller = messages;
      while (
        scroller &&
        !(
          scroller.clientHeight > 0 &&
          (scroller.scrollHeight > scroller.clientHeight ||
            hasClass(scroller, "scroller_"))
        )
      ) {
        scroller = scroller.parentElement;
      }
      const atLatest = Boolean(
        scroller &&
        scroller.scrollHeight - scroller.scrollTop - scroller.clientHeight <
          80 &&
        !document.querySelector('[class*="jumpToPresentBar_"]'),
      );
      current = {
        channelId,
        messageIds,
        atLatest,
        reading: document.visibilityState === "visible" && document.hasFocus(),
      };
    }
    return {
      loggedIn,
      loginScreen,
      account: accountId
        ? `id:${accountId}`
        : accountName
          ? `name:${accountName}`
          : null,
      servers: [...servers.values()],
      channels: [...channels.values()],
      current,
    };
  }

  globalThis.DiscordReader = { readSnapshot };
})();
