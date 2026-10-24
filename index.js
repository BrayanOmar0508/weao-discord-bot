
const {
  Client,
  GatewayIntentBits,
  EmbedBuilder,
  Colors
} = require("discord.js");

const API_URL = "https://weao.xyz/api/status/exploits";
const TOKEN = process.env.DISCORD_TOKEN;
const CHANNEL_ID = process.env.DISCORD_CHANNEL_ID;

const MARKER = "WEAO_SINGLE_STATUS";
const OLD_MARKER = /^WEAO_ID:/;

if (!TOKEN || !CHANNEL_ID) {
  console.error("Missing DISCORD_TOKEN or DISCORD_CHANNEL_ID");
  process.exit(1);
}

const client = new Client({
  intents: [GatewayIntentBits.Guilds]
});

function getId(item) {
  return String(item._id || item.id || item.title || "");
}

function getPlatforms(item) {
  const raw = Array.isArray(item.platform)
    ? item.platform.join(",")
    : String(item.platform || "");

  const normalized = raw.toLowerCase();
  const platforms = [];

  if (/\bwindows?\b|\bwin32\b|\bwin64\b/.test(normalized)) {
    platforms.push("Windows");
  }

  if (/\bios\b|\biphone\b|\bipad\b/.test(normalized)) {
    platforms.push("iOS");
  }

  if (/\bandroid\b/.test(normalized)) {
    platforms.push("Android");
  }

  return platforms;
}

function updateLabel(item) {
  if (item.updateStatus === true) return "🟢 Updated";
  if (item.updateStatus === false) return "🔴 Not Updated";
  return "❔ Unknown";
}

function exploitLine(item) {
  const name = String(item.title || "Unknown exploit")
    .replace(/[\r\n]/g, " ");

  const website = item.websitelink || item.website || "";
  const version = String(item.version || "Unknown")
    .replace(/[`@\n\r]/g, "");

  const safeName = /^https?:\/\//i.test(website)
    ? `[${name}](${website})`
    : `**${name}**`;

  return `${safeName}\n> Version: \`${version}\`\n> ${updateLabel(item)}`;
}

function makeEmbeds(grouped) {
  const configs = [
    { name: "Windows", emoji: "" },
    { name: "iOS", emoji: "" },
    { name: "Android", emoji: "" }
  ];

  const total = Object.values(grouped)
    .reduce((sum, list) => sum + list.length, 0);

  return configs.map(platform => {
    const exploits = grouped[platform.name];
    const midpoint = Math.ceil(exploits.length / 2);
    const left = exploits.slice(0, midpoint);
    const right = exploits.slice(midpoint);

    const embed = new EmbedBuilder()
      .setColor(Colors.Blurple)
      .setTitle(`${platform.emoji} ${platform.name} Exploits`)
      .setFooter({
        text: `${MARKER} • ${total} free exploits • Updates every 10 min`
      });

    if (!exploits.length) {
      embed.setDescription("*No free exploits found for this platform.*");
      return embed;
    }

    // Discord inline fields create responsive side-by-side columns.
    const leftText = left.map(exploitLine).join("\n\n");
    const rightText = right.map(exploitLine).join("\n\n");

    // Each field has a 1024-character limit.
    embed.addFields(
      {
        name: "Available",
        value: leftText.slice(0, 1024),
        inline: true
      },
      {
        name: "\u200B",
        value: rightText.slice(0, 1024) || "\u200B",
        inline: true
      }
    );

    return embed;
  });
}

function signature(embeds) {
  return JSON.stringify(embeds.map(embed => {
    const data = typeof embed.toJSON === "function"
      ? embed.toJSON()
      : embed;

    return {
      title: data.title,
      description: data.description,
      color: data.color,
      fields: data.fields,
      footer: data.footer
    };
  }));
}

async function run() {
  const response = await fetch(API_URL, {
    headers: {
      "User-Agent": "WEAO-Discord-Status-Bot/1.0"
    },
    signal: AbortSignal.timeout(20000)
  });

  if (!response.ok) {
    throw new Error(`WEAO API returned HTTP ${response.status}`);
  }

  const payload = await response.json();

  const all = Array.isArray(payload)
    ? payload
    : Array.isArray(payload.data)
      ? payload.data
      : Array.isArray(payload.exploits)
        ? payload.exploits
        : null;

  if (!all) {
    throw new Error("Unexpected WEAO API response.");
  }

  const grouped = {
    Windows: [],
    iOS: [],
    Android: []
  };

  for (const item of all) {
    if (!item || item.free !== true || !getId(item)) continue;

    for (const platform of getPlatforms(item)) {
      grouped[platform].push(item);
    }
  }

  for (const platform of Object.keys(grouped)) {
    grouped[platform].sort((a, b) =>
      String(a.title || "").localeCompare(String(b.title || ""))
    );
  }

  const channel = await client.channels.fetch(CHANNEL_ID);

  if (!channel || !channel.isTextBased() || !channel.messages) {
    throw new Error("Channel not found or not a text channel.");
  }

  const existing = [];
  let before;

  // Find the current status message and old messages from the previous bot.
  while (true) {
    const options = { limit: 100 };
    if (before) options.before = before;

    const batch = await channel.messages.fetch(options);
    if (!batch.size) break;

    for (const message of batch.values()) {
      if (message.author.id !== client.user.id) continue;
      if (!message.embeds.length) continue;

      const footer = message.embeds[0].footer?.text || "";

      if (footer.includes(MARKER) || OLD_MARKER.test(footer)) {
        existing.push(message);
      }
    }

    if (batch.size < 100) break;
    before = batch.last().id;
  }

  const nextEmbeds = makeEmbeds(grouped);

  const statusMessages = existing.filter(message =>
    (message.embeds[0].footer?.text || "").includes(MARKER)
  );

  let statusMessage = statusMessages[0];

  if (!statusMessage) {
    statusMessage = await channel.send({
      embeds: nextEmbeds
    });

    console.log("Created the WEAO status message.");
  } else if (
    signature(statusMessage.embeds) !== signature(nextEmbeds)
  ) {
    await statusMessage.edit({
      embeds: nextEmbeds
    });

    console.log("Updated the WEAO status message.");
  } else {
    console.log("No changes detected.");
  }

  // Delete duplicate status messages and old per-exploit messages.
  for (const message of existing) {
    if (message.id === statusMessage.id) continue;

    await message.delete().catch(error => {
      console.error(
        `Could not delete old message ${message.id}:`,
        error.message
      );
    });
  }

  console.log(
    `Checked ${all.length} exploits. ` +
    `Windows: ${grouped.Windows.length}, ` +
    `iOS: ${grouped.iOS.length}, ` +
    `Android: ${grouped.Android.length}.`
  );
}

client.once("ready", async () => {
  console.log(`Logged in as ${client.user.tag}`);

  try {
    await run();
  } catch (error) {
    console.error("WEAO update failed:", error);
    process.exitCode = 1;
  } finally {
    client.destroy();
    process.exit(process.exitCode || 0);
  }
});

client.login(TOKEN).catch(error => {
  console.error("Discord login failed:", error);
  process.exit(1);
});
