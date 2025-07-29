const { Client, GatewayIntentBits, EmbedBuilder } = require('discord.js');
const { joinVoiceChannel, createAudioPlayer, createAudioResource, AudioPlayerStatus, VoiceConnectionStatus, entersState } = require('@discordjs/voice');
const ytdl = require('ytdl-core');
const ytSearch = require('yt-search');
const { getData } = require('spotify-url-info');

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildVoiceStates,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
  ],
});

const prefix = '!';
const queue = new Map();

client.once('ready', () => {
  console.log(`🎵 Logged in as ${client.user.tag}`);
});

client.on('messageCreate', async message => {
  if (!message.content.startsWith(prefix) || message.author.bot) return;

  const args = message.content.slice(prefix.length).trim().split(/ +/);
  const command = args.shift().toLowerCase();
  const serverQueue = queue.get(message.guild.id);

  if (command === 'play') {
    const voiceChannel = message.member.voice.channel;
    if (!voiceChannel) return message.reply('🔊 Join a voice channel first!');
    const permissions = voiceChannel.permissionsFor(message.client.user);
    if (!permissions.has('Connect') || !permissions.has('Speak')) {
      return message.reply('❌ I need permissions to join and speak.');
    }

    const search = args.join(' ');
    if (!search) return message.reply('❗ Provide a song name or link.');

    let songInfo;
    try {
      if (search.includes('spotify.com')) {
        const data = await getData(search);
        if (data.type === 'track') {
          const result = await ytSearch(`${data.artist.name} ${data.name}`);
          songInfo = result.videos[0];
        } else {
          return message.reply('⚠️ Only Spotify tracks are supported.');
        }
      } else if (ytdl.validateURL(search)) {
        const info = await ytdl.getInfo(search);
        songInfo = { title: info.videoDetails.title, url: info.videoDetails.video_url };
      } else {
        const result = await ytSearch(search);
        songInfo = result.videos[0];
      }
    } catch (err) {
      console.error(err);
      return message.reply('⚠️ Failed to load song.');
    }

    if (!songInfo) return message.reply('❌ Song not found.');

    const song = {
      title: songInfo.title,
      url: songInfo.url,
    };

    if (!serverQueue) {
      const player = createAudioPlayer();
      const queueConstruct = {
        voiceChannel,
        textChannel: message.channel,
        connection: null,
        player,
        songs: [song],
      };

      queue.set(message.guild.id, queueConstruct);

      try {
        const connection = joinVoiceChannel({
          channelId: voiceChannel.id,
          guildId: message.guild.id,
          adapterCreator: message.guild.voiceAdapterCreator,
        });

        queueConstruct.connection = connection;

        connection.subscribe(player);

        playSong(message.guild.id, song);

        connection.on(VoiceConnectionStatus.Ready, () => {
          console.log('✅ Voice connection ready!');
        });

        player.on(AudioPlayerStatus.Idle, () => {
          queueConstruct.songs.shift();
          if (queueConstruct.songs.length > 0) {
            playSong(message.guild.id, queueConstruct.songs[0]);
          } else {
            connection.destroy();
            queue.delete(message.guild.id);
          }
        });

        player.on('error', error => {
          console.error('Audio error:', error);
          queueConstruct.songs.shift();
          playSong(message.guild.id, queueConstruct.songs[0]);
        });
      } catch (error) {
        console.error('VC connection error:', error);
        queue.delete(message.guild.id);
        return message.reply('❌ Failed to join VC.');
      }
    } else {
      serverQueue.songs.push(song);
      return message.channel.send(`✅ Added to queue: **${song.title}**`);
    }
  }

  if (command === 'skip') {
    if (!serverQueue) return message.reply('❌ No song to skip.');
    serverQueue.player.stop();
    return message.channel.send('⏭️ Skipped.');
  }

  if (command === 'stop') {
    if (!serverQueue) return message.reply('❌ Nothing is playing.');
    serverQueue.songs = [];
    serverQueue.player.stop();
    serverQueue.connection.destroy();
    queue.delete(message.guild.id);
    return message.channel.send('⏹️ Stopped and cleared queue.');
  }

  if (command === 'pause') {
    if (!serverQueue) return;
    serverQueue.player.pause();
    return message.channel.send('⏸️ Paused.');
  }

  if (command === 'resume') {
    if (!serverQueue) return;
    serverQueue.player.unpause();
    return message.channel.send('▶️ Resumed.');
  }

  if (command === 'queue') {
    if (!serverQueue || !serverQueue.songs.length) return message.reply('📭 Queue is empty.');
    const embed = new EmbedBuilder()
      .setTitle('🎶 Current Queue')
      .setColor('Blue')
      .setDescription(serverQueue.songs.map((s, i) => `\`${i + 1}.\` ${s.title}`).join('\n'));
    return message.channel.send({ embeds: [embed] });
  }

  if (command === 'now') {
    if (!serverQueue || !serverQueue.songs[0]) return message.reply('❌ Nothing playing.');
    return message.channel.send(`🎧 Now playing: **${serverQueue.songs[0].title}**`);
  }
});

function playSong(guildId, song) {
  const serverQueue = queue.get(guildId);
  if (!song) return;

  const stream = ytdl(song.url, {
    filter: 'audioonly',
    highWaterMark: 1 << 25,
    quality: 'highestaudio',
  });

  const resource = createAudioResource(stream);
  serverQueue.player.play(resource);
  serverQueue.textChannel.send(`🎵 Now playing: **${song.title}**`);
}

client.login('MTM5MjA2NTM1NzM1MDU2Nzk4Ng.GBEyJM.S2KWCeg_tsd4RPfT5vOGY74t-QdBE_rb2wyXuM'); // ← Replace this with your bot token
