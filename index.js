// This line is for loading environment variables in a Node.js application.
// It is uncommented here, and the code below will now properly use process.env.
require('dotenv').config();

const { Client, GatewayIntentBits, SlashCommandBuilder, Routes, REST, InteractionType } = require('discord.js');
const { joinVoiceChannel, createAudioPlayer, createAudioResource, AudioPlayerStatus } = require('@discordjs/voice');
const ytdlp = require('yt-dlp-exec'); // The yt-dlp-exec library
const axios = require('axios'); // For making HTTP requests to Spotify API

// --- Discord Client Initialization ---
const client = new Client({
    intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildVoiceStates]
});

// --- Spotify API Token Cache ---
let spotifyAccessToken = '';
let tokenExpiresAt = 0; // Timestamp when the token expires

/**
 * Fetches or returns a cached Spotify API access token.
 * Handles token expiration and re-fetching.
 * @returns {Promise<string>} The Spotify access token.
 * @throws {Error} If Spotify client ID or secret are not set.
 */
async function getSpotifyToken() {
    // Return cached token if it's still valid
    if (Date.now() < tokenExpiresAt) return spotifyAccessToken;

    // --- IMPORTANT: Using process.env for Spotify credentials ---
    const spotifyClientId = process.env.SPOTIFY_CLIENT_ID;
    const spotifyClientSecret = process.env.SPOTIFY_CLIENT_SECRET;

    // Validate that credentials are set
    if (!spotifyClientId || !spotifyClientSecret) {
        console.error('Spotify client ID or secret not set in environment variables.');
        throw new Error('Spotify API credentials missing. Please set SPOTIFY_CLIENT_ID and SPOTIFY_CLIENT_SECRET in your .env file.');
    }

    try {
        // Make a POST request to Spotify's token endpoint
        const res = await axios.post(
            'https://accounts.spotify.com/api/token',
            new URLSearchParams({ grant_type: 'client_credentials' }), // Request client credentials grant type
            {
                headers: {
                    // Basic authentication header with base64 encoded client ID and secret
                    Authorization:
                        'Basic ' +
                        Buffer.from(`${spotifyClientId}:${spotifyClientSecret}`).toString('base64'),
                    'Content-Type': 'application/x-www-form-urlencoded'
                }
            }
        );

        // Store the new access token and its expiration time
        spotifyAccessToken = res.data.access_token;
        tokenExpiresAt = Date.now() + res.data.expires_in * 1000; // Convert seconds to milliseconds
        return spotifyAccessToken;
    } catch (error) {
        console.error('Error getting Spotify token:', error.message);
        throw new Error('Failed to retrieve Spotify access token.');
    }
}

/**
 * Searches Spotify for tracks based on a query.
 * @param {string} query - The search query.
 * @returns {Promise<Array<Object>>} An array of Spotify track objects.
 */
async function searchSpotify(query) {
    try {
        const token = await getSpotifyToken();
        const res = await axios.get('https://api.spotify.com/v1/search', {
            headers: { Authorization: `Bearer ${token}` }, // Authorization header with bearer token
            params: {
                q: query,    // The search query
                type: 'track', // Search only for tracks
                limit: 5     // Limit results to 5
            }
        });
        return res.data.tracks.items;
    } catch (error) {
        console.error('Error searching Spotify:', error.message);
        return []; // Return an empty array on error
    }
}

/**
 * Gets a readable audio stream from YouTube using yt-dlp-exec.
 * This stream can be directly used by @discordjs/voice.
 * @param {string} query - The search query for YouTube.
 * @returns {Promise<import('stream').Readable|null>} A readable stream of the audio, or null if failed.
 */
async function getYouTubeAudioStream(query) {
    try {
        // Execute yt-dlp to get the best audio stream and pipe it to stdout ('-')
        // We prioritize webm and mp4 audio formats for compatibility.
        const ytDlpProcess = ytdlp.exec(`ytsearch1:${query}`, {
            format: 'bestaudio[ext=webm]+bestaudio[ext=mp4]/bestaudio/best',
            o: '-', // Output to stdout
            // Optional: Add these if you encounter certificate or warning issues
            // noCheckCertificates: true,
            // noWarnings: true,
        }, {
            // Configure stdio to pipe stdout, stdin, and stderr
            stdio: ['pipe', 'pipe', 'pipe']
        });

        // Return the stdout stream from the yt-dlp child process
        return ytDlpProcess.stdout;
    } catch (error) {
        console.error('Error getting YouTube stream:', error);
        return null;
    }
}

/**
 * Plays a song in the user's voice channel.
 * @param {import('discord.js').ChatInputCommandInteraction} interaction - The interaction object.
 * @param {Object} track - The Spotify track object to play.
 */
async function playSong(interaction, track) {
    const voiceChannel = interaction.member.voice.channel;
    if (!voiceChannel) {
        // If the user is not in a voice channel, inform them and return.
        return interaction.editReply({ content: '❌ Join a voice channel first.', ephemeral: true });
    }

    let connection;
    try {
        // Join the voice channel
        connection = joinVoiceChannel({
            channelId: voiceChannel.id,
            guildId: interaction.guildId,
            adapterCreator: interaction.guild.voiceAdapterCreator
        });
    } catch (error) {
        console.error('Error joining voice channel:', error);
        return interaction.editReply({ content: '❌ Failed to join the voice channel.' });
    }

    // Get the audio stream directly from YouTube using the track name and artist
    const audioStream = await getYouTubeAudioStream(`${track.name} ${track.artists[0].name}`);
    if (!audioStream) {
        // If no stream is found, destroy the connection and inform the user
        if (connection) connection.destroy();
        return interaction.editReply('❌ Could not find or stream the song from YouTube.');
    }

    // Create an audio resource from the stream
    const resource = createAudioResource(audioStream);
    const player = createAudioPlayer(); // Create an audio player

    // Event listener for when the audio player becomes idle (song ends)
    player.on(AudioPlayerStatus.Idle, () => {
        console.log('Audio player idle, destroying connection.');
        if (connection) connection.destroy(); // Destroy the voice connection
    });

    // Event listener for audio player errors
    player.on('error', error => {
        console.error('Audio player error:', error);
        if (connection) connection.destroy(); // Destroy connection on error
        // Use followUp to send a message, as editReply might fail if already used
        interaction.followUp({ content: '❌ An error occurred while playing the song.' }).catch(e => console.error('Error sending follow-up:', e));
    });

    try {
        player.play(resource); // Play the audio resource
        connection.subscribe(player); // Subscribe the connection to the player
        await interaction.editReply(`🎶 Now playing: **${track.name}** by **${track.artists[0].name}**`);
    } catch (error) {
        console.error('Error playing resource or subscribing connection:', error);
        if (connection) connection.destroy();
        await interaction.editReply({ content: '❌ Failed to play the song.' });
    }
}

// --- Slash Command Registration ---
const commands = [
    new SlashCommandBuilder()
        .setName('play')
        .setDescription('Play a song from Spotify')
        .addStringOption(option =>
            option
                .setName('track')
                .setDescription('Search for a Spotify song')
                .setRequired(true)
                .setAutocomplete(true) // Enable autocomplete for track search
        )
].map(command => command.toJSON()); // Convert command builders to JSON format

// --- IMPORTANT: Using process.env for Discord Token ---
const discordToken = process.env.DISCORD_TOKEN;

// Validate that Discord token is set
if (!discordToken) {
    console.error('DISCORD_TOKEN environment variable is not set. Please set it in your .env file.');
    process.exit(1); // Exit the process if the token is missing
}

// Initialize Discord REST API client with the bot token
const rest = new REST({ version: '10' }).setToken(discordToken);

// --- Client Ready Event ---
client.once('ready', async () => {
    console.log(`✅ Logged in as ${client.user.tag}`);
    try {
        // Register slash commands globally (or to a specific guild for faster testing)
        await rest.put(Routes.applicationCommands(client.user.id), { body: commands });
        console.log('✅ Slash command registered.');
    } catch (err) {
        console.error('❌ Error registering commands:', err);
    }
});

// --- Interaction Handler ---
client.on('interactionCreate', async interaction => {
    // Handle autocomplete interactions for the 'track' option
    if (interaction.type === InteractionType.ApplicationCommandAutocomplete) {
        const focused = interaction.options.getFocused(); // Get the currently focused option value
        if (!focused) {
            // If the input is empty, respond with no suggestions
            await interaction.respond([]);
            return;
        }

        try {
            const tracks = await searchSpotify(focused); // Search Spotify for tracks
            const suggestions = tracks.map(t => ({
                name: `${t.name} - ${t.artists[0].name}`, // Display format for suggestion
                value: t.id // Value to be sent back when selected
            }));
            await interaction.respond(suggestions); // Send suggestions to Discord
        } catch (error) {
            console.error('Error during autocomplete Spotify search:', error);
            // Respond with an empty array to prevent "Unknown interaction" error
            // This ensures the interaction is always acknowledged within the timeout.
            await interaction.respond([]);
        }
    }

    // Handle chat input commands (e.g., /play)
    if (interaction.isChatInputCommand() && interaction.commandName === 'play') {
        try {
            await interaction.deferReply();
            const input = interaction.options.getString('track'); // Get the raw input from the user

            let track;
            const token = await getSpotifyToken();

            // First, try to fetch the track directly using the input as a Spotify ID.
            // This handles cases where an autocomplete suggestion (with its 'value' as ID) was selected.
            try {
                const res = await axios.get(`https://api.spotify.com/v1/tracks/${input}`, {
                    headers: { Authorization: `Bearer ${token}` }
                });
                track = res.data;
            } catch (error) {
                // If fetching by ID fails (e.g., 400 Bad Request for invalid ID, or 404 Not Found),
                // it likely means the 'input' was a search query, not a direct track ID.
                if (error.response && (error.response.status === 400 || error.response.status === 404)) {
                    console.log(`Input '${input}' is not a direct Spotify track ID. Attempting search.`);
                    const searchResults = await searchSpotify(input);
                    if (searchResults.length > 0) {
                        track = searchResults[0]; // Take the first search result
                    } else {
                        // If no search results are found, inform the user.
                        return interaction.editReply({ content: '❌ Could not find any songs matching your query.' });
                    }
                } else {
                    // Re-throw other types of errors (e.g., network issues, Spotify token errors)
                    throw error;
                }
            }

            // Ensure a track was successfully identified before proceeding to play.
            if (!track) {
                return interaction.editReply({ content: '❌ Could not find the song. Please try a different query.' });
            }

            await playSong(interaction, track); // Play the identified song
        } catch (err) {
            console.error('❌ Error in /play command:', err);
            // Robust error handling for interaction replies:
            if (interaction.deferred || interaction.replied) {
                await interaction.followUp({ content: '❌ Failed to play the song due to an internal error.' }).catch(e => console.error('Error sending follow-up:', e));
            } else {
                await interaction.editReply({ content: '❌ Failed to play the song due to an internal error.' });
            }
        }
    }
});

// --- Log in to Discord ---
client.login(discordToken);
