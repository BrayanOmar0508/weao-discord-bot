
const { Client, GatewayIntentBits, EmbedBuilder, Colors } = require("discord.js");

const API_URL = "https://weao.xyz/api/status/exploits";
const TOKEN = process.env.DISCORD_TOKEN;
const CHANNEL_ID = process.env.DISCORD_CHANNEL_ID;

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

function bool(value) {
  return value === true ? "Yes" : value === false ? "No" : "Unknown";
}

function makeEmbed(item) {
  const embed = new EmbedBuilder()
    .setColor(
      item.detected === true ? Colors.Red :
      item.updateStatus === true ? Colors.Green :
      Colors.Orange
    )
    .setTitle(String(item.title || "Unknown exploit"))
    .setDescription([
      item.websitelink ? `[Website](${item.websitelink})` : "",
      item.discordlink ? `[Discord](${item.discordlink})` : ""
    ].filter(Boolean).join(" • ") || "No links available.")
    .addFields(
      { name: "Version", value: String(item.version || "Unknown"), inline: true },
      { name: "Platform", value: String(item.platform || "Unknown"), inline: true },
      { name: "Detected", value: bool(item.detected), inline: true },
      { name: "Updated", value: bool(item.updateStatus), inline: true },
      { name: "UNC", value: bool(item.uncStatus), inline: true },
      { name: "Key system", value: bool(item.keysystem), inline: true }
    )
    .setFooter({ text: `WEAO_ID:${getId(item)}` });

  if (typeof item.uncPercentage === "number") {
    embed.addFields({
      name: "UNC Score",
      value: `${item.uncPercentage}%`,
      inline: true
    });
  }

  if (typeof item.suncPercentage === "number") {
    embed.addFields({
      name: "sUNC Score",
      value: `${item.suncPercentage}%`,
      inline: true
    });
  }

  if (item.updatedDate) {
    const date = new Date(item.updatedDate);
    if (!Number.isNaN(date.getTime())) embed.setTimestamp(date);
  }

  return embed;
}

function signature(embed) {
  return JSON.stringify({
    title: embed.title,
    description: embed.description,
    color: embed.color,
    fields: embed.fields.map(f => ({
      name: f.name,
      value: f.value,
      inline: f.inline
    })),
    timestamp: embed.timestamp
  });
}

async function run() {
  const response = await fetch(API_URL, {
    headers: { "User-Agent": "WEAO-Discord-Status-Bot/1.0" },
    signal: AbortSignal.timeout(20000)
  });

  if (!response.ok) {
    throw new Error(`WEAO API returned HTTP ${response.status}`);
  }

  const payload = await response.json();

  const all = Array.isArray(payload) ? payload :
    Array.isArray(payload.data) ? payload.data :
    Array.isArray(payload.exploits) ? payload.exploits : null;

  if (!all) {
    throw new Error("Unexpected API response: expected an array of exploits.");
  }

  const free = all.filter(item => item && item.free === true && getId(item));

  const channel = await client.channels.fetch(CHANNEL_ID);

  if (!channel || !channel.isTextBased() || !channel.messages) {
    throw new Error("Channel not found or not a text channel.");
  }

  const messages = new Map();
  let before;

  // Search recent channel history for this bot's existing status messages.
  // The bot needs Read Message History permission.
  while (true) {
    const options = { limit: 100 };
    if (before) options.before = before;

    const batch = await channel.messages.fetch(options);
    if (!batch.size) break;

    for (const message of batch.values()) {
      if (message.author.id !== client.user.id || !message.embeds.length) continue;

      const footer = message.embeds[0].footer?.text || "";
      const match = footer.match(/^WEAO_ID:(.+)$/);

      if (match) messages.set(match[1], message);
    }

    if (batch.size < 100) break;
    before = batch.last().id;
  }

  const currentIds = new Set(free.map(getId));
  let created = 0;
  let edited = 0;
  let removed = 0;

  for (const item of free) {
    const id = getId(item);
    const next = makeEmbed(item);
    const oldMessage = messages.get(id);

    if (!oldMessage) {
      await channel.send({ embeds: [next] });
      created++;
      continue;
    }

    if (signature(oldMessage.embeds[0]) !== signature(next.toJSON())) {
      await oldMessage.edit({ embeds: [next] });
      edited++;
    }
  }

  // Remove managed messages for exploits that are no longer free.
  for (const [id, message] of messages) {
    if (!currentIds.has(id)) {
      await message.delete().catch(console.error);
      removed++;
    }
  }

  console.log(
    `WEAO checked ${all.length} exploits; ${free.length} free; ` +
    `${created} created, ${edited} edited, ${removed} removed.`
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
