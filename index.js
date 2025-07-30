require("dotenv").config();
const { Client, GatewayIntentBits } = require("discord.js");
const { joinVoiceChannel, createAudioPlayer, createAudioResource, AudioPlayerStatus } = require("@discordjs/voice");
const play = require("play-dl");

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildVoiceStates,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent
  ]
});

client.once("ready", () => {
  console.log(`✅ Logged in as ${client.user.tag}`);
});

client.on("messageCreate", async (message) => {
  if (!message.content.startsWith("!play") || message.author.bot) return;

  const args = message.content.split(" ");
  const query = args.slice(1).join(" ");
  if (!query) return message.reply("Please provide a YouTube URL or search query!");

  if (!message.member.voice.channel)
    return message.reply("Join a voice channel first!");

  const stream = await play.stream(query);
  const resource = createAudioResource(stream.stream, { inputType: stream.type });

  const connection = joinVoiceChannel({
    channelId: message.member.voice.channel.id,
    guildId: message.guild.id,
    adapterCreator: message.guild.voiceAdapterCreator
  });

  const player = createAudioPlayer();
  connection.subscribe(player);
  player.play(resource);

  player.on(AudioPlayerStatus.Idle, () => {
    connection.destroy();
  });

  message.reply(`🎶 Now playing: ${query}`);
});

client.login(process.env.TOKEN);
