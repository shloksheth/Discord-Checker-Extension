export const serverId = "100000000000000001";
export const secondServerId = "100000000000000002";
export const channelId = "200000000000000001";
export const secondChannelId = "200000000000000002";
export const firstMessage = "300000000000000001";
export const secondMessage = "300000000000000002";

export function snapshot(overrides = {}) {
  return {
    loggedIn: true,
    account: "id:900000000000000001",
    servers: [
      { id: serverId, name: "Design Buddies" },
      { id: secondServerId, name: "Study Club" },
    ],
    channels: [
      { id: channelId, serverId, name: "general", unread: false, mentions: 0 },
      {
        id: secondChannelId,
        serverId,
        name: "inspiration",
        unread: false,
        mentions: 0,
      },
    ],
    current: {
      channelId,
      messageIds: [firstMessage],
      reading: false,
      atLatest: true,
    },
    ...overrides,
  };
}

export function discordMarkup({
  unread = false,
  mentions = 0,
  login = false,
} = {}) {
  if (login)
    return '<html><body><input name="email"><input name="password"></body></html>';
  return `<!doctype html><html lang="en"><head><title>Discord fixture</title><style>
    body{font:14px system-ui;padding:20px}a{display:block;margin:8px}.scroller_fixture{height:120px;overflow:auto}
    [data-list-id="chat-messages"]{padding:0;margin:0}li{height:80px;list-style:none}
  </style></head><body>
    <nav aria-label="Servers">
      <div data-list-item-id="guildsnav___${serverId}" aria-label="Design Buddies"></div>
      <div data-list-item-id="guildsnav___${secondServerId}" aria-label="Study Club"></div>
    </nav>
    <aside class="sidebar_fixture"><div class="header_fixture"><span class="name_fixture">Design Buddies</span></div>
      <nav data-list-id="channels">
        <div class="containerDefault_fixture ${unread ? "unread_fixture" : ""}" data-list-item-id="channels___${channelId}">
          <a href="/channels/${serverId}/${channelId}" aria-label="general${unread ? ", unread" : ""}"><span class="name_fixture">general</span></a>
          ${mentions ? `<span class="numberBadge_fixture">${mentions}</span>` : ""}
        </div>
        <div class="containerDefault_fixture" data-list-item-id="channels___${secondChannelId}">
          <a href="/channels/${serverId}/${secondChannelId}"><span class="name_fixture">inspiration</span></a>
        </div>
      </nav>
    </aside>
    <section class="scroller_fixture"><ol data-list-id="chat-messages">
      <li id="chat-messages-${channelId}-${firstMessage}">A baseline message</li>
    </ol></section>
    <div class="panels_fixture"><img alt="Account avatar" src="https://cdn.discordapp.com/avatars/900000000000000001/avatar.png"><div class="nameTag_fixture"><span class="title_fixture">shlok</span></div></div>
    <div id="message-body"><a href="/channels/${serverId}/200000000000000099">A message permalink, not a sidebar channel</a></div>
  </body></html>`;
}
