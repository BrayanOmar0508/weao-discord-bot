
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

function yesNo(value) {
  if (value === true) return "Yes";
  if (value === false) return "No";
  return "Unknown";
}

function exploitLine(item) {
  const name = String(item.title || "Unknown exploit")
    .replace(/[\r\n]/g, " ");

  const website = item.websitelink || item.website || "";
  const version = String(item.version || "Unknown");

  const detected = item.detected === true
    ? "🔴 Detected"
    : item.detected === false
      ? "🟢 Undetected"
      : "❔ Unknown detection";

  const updated = item.updateStatus === true
    ? "Yes"
    : item.updateStatus === false
      ? "No"
      : "Unknown";

  const safeName = website.startsWith("https://") ||
                   website.startsWith("http://")
    ? `[${name}](${website})`
    : `**${name}**`;

  return `${safeName}\n` +
    `> Version: \`${version}\` • ${detected}\n` +
    `> Updated: ${updated} • UNC: ${yesNo(item.uncStatus)}`;
}

function makeEmbeds(platforms) {
  const configs = [
    { name: "Windows", emoji: "🪟" },
    { name: "iOS", emoji: "🍎" },
    { name: "Android", emoji: "🤖" }
  ];

  const total = configs.reduce(
    (sum, p) => sum + platforms[p.name].length,
    0
  );

  return configs.map(platform => {
    const exploits = platforms[platform.name];
    const lines = exploits.map(exploitLine);

    let description = lines.length
      ? lines.join("\n\n")
      : "*No free exploits found for this platform.*";

    // Discord embed description limit is 4096 characters.
    // Keep room for a note if the list is too long.
    if (description.length > 3500) {
      description = description.slice(0, 3450);
      description += "\n\n*List shortened to fit Discord's limits.*";
    }

    return new EmbedBuilder()
      .setColor(
        exploits.some(item => item.detected === true)
          ? Colors.Red
          : Colors.Green
      )
      .setTitle(`${platform.emoji} ${platform.name} Exploits`)
      .setDescription(description)
      .setFooter({
        text: `${MARKER} • ${total} free exploits • Auto-updates every 10 min`
      });
  });
}

function signature(embeds) {
  return JSON.stringify(
    embeds.map(embed => {
      const data = typeof embed.toJSON === "function"
        ? embed.toJSON()
        : embed;

      return {
        title: data.title,
        description: data.description,
        color: data.color,
        footer: data.footer
      };
    })
  );
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
    throw new Error("Channel not found or is not a text channel.");
  }

  const existing = [];
  let before;

  // Find the existing status message and old messages created by this bot.
  // Requires View Channel and Read Message History permissions.
  while (true) {
    const options = { limit: 100 };
    if (before) options.before = before;

    const batch = await channel.messages.fetch(options);
    if (!batch.size) break;

    for (const message of batch.values()) {
      if (message.author.id !== client.user.id) continue;
      if (!message.embeds.length) continue;

      const footer = message.embeds[0].footer?.text || "";

      if (
        footer.includes(MARKER) ||
        OLD_MARKER.test(footer)
      ) {
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

  // Reuse the existing status message whenever possible.
  let statusMessage = statusMessages[0];

  if (!statusMessage) {
    statusMessage = await channel.send({
      embeds: nextEmbeds
    });
    console.log("Created the single WEAO status message.");
  } else {
    const oldSignature = signature(statusMessage.embeds);
    const newSignature = signature(nextEmbeds);

    if (oldSignature !== newSignature) {
      await statusMessage.edit({
        embeds: nextEmbeds
      });
      console.log("Updated the WEAO status message.");
    } else {
      console.log("No status changes detected.");
    }
  }

  // Remove duplicate status messages and old per-exploit messages
  // created by the previous version of this bot.
  for (const message of existing) {
    if (message.id === statusMessage.id) continue;

    await message.delete().catch(error => {
      console.error(`Could not delete old message ${message.id}:`, error.message);
    });
  }

  console.log(
    `Checked ${all.length} exploits. ` +
    `Free: ${Object.values(grouped).reduce((sum, list) => sum + list.length, 0)} ` +
    `(Windows: ${grouped.Windows.length}, iOS: ${grouped.iOS.length}, ` +
    `Android: ${grouped.Android.length}).`
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
