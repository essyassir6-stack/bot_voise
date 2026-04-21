const { Client, GatewayIntentBits, ChannelType, ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder, PermissionsBitField } = require('discord.js');
require('dotenv').config();

// ==================== VALIDATE ENVIRONMENT VARIABLES ====================
const requiredEnvVars = ['DISCORD_TOKEN', 'LOBBY_CHANNEL_ID'];
const missingEnvVars = requiredEnvVars.filter(envVar => !process.env[envVar]);

if (missingEnvVars.length > 0) {
    console.error('❌ Missing required environment variables:');
    missingEnvVars.forEach(envVar => console.error(`   - ${envVar}`));
    console.error('\n📝 Please add them in Railway Variables tab');
    process.exit(1);
}

// ==================== CONFIGURATION ====================
const CONFIG = {
    DISCORD_TOKEN: process.env.DISCORD_TOKEN,
    LOBBY_CHANNEL_ID: process.env.LOBBY_CHANNEL_ID,
    BANNER_IMAGE_URL: process.env.BANNER_IMAGE_URL || 'https://media.discordapp.net/attachments/1480969774895730690/1496251251896352829/21906d71-f457-4fe4-af53-9f4353f00381.png'
};

// ==================== BOT INITIALIZATION ====================
const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildVoiceStates,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent
    ]
});

// Store active rooms: voiceChannelId -> { textChannelId, ownerId, ownerName }
const activeRooms = new Map();

// ==================== READY EVENT ====================
client.once('ready', async () => {
    console.log(`✅ Bot is online!`);
    console.log(`📡 Logged in as: ${client.user.tag}`);
    
    const lobbyChannel = client.channels.cache.get(CONFIG.LOBBY_CHANNEL_ID);
    if (!lobbyChannel) {
        console.error(`❌ LOBBY_CHANNEL_ID not found! Please check the ID: ${CONFIG.LOBBY_CHANNEL_ID}`);
    } else {
        console.log(`✅ Lobby channel: #${lobbyChannel.name}`);
        console.log(`🎤 Users will get their own VC + text channel when they join`);
    }
});

// ==================== VOICE SYSTEM ====================
client.on('voiceStateUpdate', async (oldState, newState) => {
    const user = newState.member?.user;
    if (!user || user.bot) return;
    
    const guild = newState.guild;
    
    // CASE 1: User joined the lobby channel
    if (newState.channelId === CONFIG.LOBBY_CHANNEL_ID && oldState.channelId !== CONFIG.LOBBY_CHANNEL_ID) {
        try {
            console.log(`📢 ${user.username} joined lobby, creating rooms...`);
            
            // Get the lobby channel for category reference
            const lobbyChannel = guild.channels.cache.get(CONFIG.LOBBY_CHANNEL_ID);
            const categoryId = lobbyChannel.parentId;
            
            // 1. Create Voice Channel
            const voiceChannel = await guild.channels.create({
                name: `${user.username}'s VC`,
                type: ChannelType.GuildVoice,
                parent: categoryId,
                userLimit: 0,
                permissionOverwrites: [
                    {
                        id: guild.id,
                        deny: [PermissionsBitField.Flags.Connect],
                    },
                    {
                        id: user.id,
                        allow: [
                            PermissionsBitField.Flags.Connect,
                            PermissionsBitField.Flags.MuteMembers,
                            PermissionsBitField.Flags.DeafenMembers,
                            PermissionsBitField.Flags.MoveMembers,
                            PermissionsBitField.Flags.ManageChannels
                        ],
                    }
                ]
            });
            
            // 2. Create Text Channel (linked)
            const textChannel = await guild.channels.create({
                name: `${user.username}-control`,
                type: ChannelType.GuildText,
                parent: categoryId,
                permissionOverwrites: [
                    {
                        id: guild.id,
                        deny: [PermissionsBitField.Flags.ViewChannel],
                    },
                    {
                        id: user.id,
                        allow: [
                            PermissionsBitField.Flags.ViewChannel,
                            PermissionsBitField.Flags.SendMessages,
                            PermissionsBitField.Flags.ReadMessageHistory,
                            PermissionsBitField.Flags.ManageMessages
                        ],
                    }
                ]
            });
            
            // 3. Send Control Panel in the text channel
            await sendControlPanel(textChannel, user, voiceChannel);
            
            // 4. Store room data
            activeRooms.set(voiceChannel.id, {
                textChannelId: textChannel.id,
                ownerId: user.id,
                ownerName: user.username,
                voiceChannelName: voiceChannel.name
            });
            
            // 5. Move user to their new voice channel
            await newState.member.voice.setChannel(voiceChannel);
            
            console.log(`✅ Created: VC "${voiceChannel.name}" + Text "#${textChannel.name}" for ${user.username}`);
            
        } catch (error) {
            console.error(`❌ Error creating rooms for ${user.username}:`, error.message);
        }
    }
    
    // CASE 2: User left their voice channel (cleanup)
    if (oldState.channelId && activeRooms.has(oldState.channelId)) {
        const roomData = activeRooms.get(oldState.channelId);
        const voiceChannel = guild.channels.cache.get(oldState.channelId);
        const textChannel = guild.channels.cache.get(roomData.textChannelId);
        
        // Check if voice channel is empty
        if (voiceChannel && voiceChannel.members.size === 0) {
            try {
                // Delete voice channel
                if (voiceChannel) await voiceChannel.delete();
                // Delete text channel
                if (textChannel) await textChannel.delete();
                // Remove from storage
                activeRooms.delete(oldState.channelId);
                
                console.log(`🗑️ Deleted: VC + Text for ${roomData.ownerName}`);
            } catch (error) {
                console.error(`❌ Error deleting rooms:`, error.message);
            }
        }
    }
});

// ==================== CONTROL PANEL ====================
async function sendControlPanel(textChannel, owner, voiceChannel) {
    const embed = new EmbedBuilder()
        .setTitle('🎮 Your Voice Channel Control Panel')
        .setDescription(`Welcome **${owner.username}**!\n\nUse the buttons below to manage your voice channel **${voiceChannel.name}**.\n\n> 🔒 Lock - Prevent new people from joining\n> 👻 Hide - Make channel invisible\n> 📊 Limit - Set user limit\n> ✏️ Rename - Change channel name\n> 🚫 Ban - Kick someone from your channel\n> ✅ Permit - Allow someone to join\n> 👑 Claim - Take ownership if owner leaves\n> 🔄 Transfer - Give ownership to someone else`)
        .setColor('#5865F2')
        .setImage(CONFIG.BANNER_IMAGE_URL)
        .setFooter({ text: `Your private channel • Room created`, iconURL: owner.displayAvatarURL() })
        .setTimestamp();
    
    // Row 1: Lock / Unlock / Hide / Unhide
    const row1 = new ActionRowBuilder()
        .addComponents(
            new ButtonBuilder().setCustomId('lock').setLabel('Lock').setStyle(ButtonStyle.Danger).setEmoji('🔒'),
            new ButtonBuilder().setCustomId('unlock').setLabel('Unlock').setStyle(ButtonStyle.Success).setEmoji('🔓'),
            new ButtonBuilder().setCustomId('hide').setLabel('Hide').setStyle(ButtonStyle.Secondary).setEmoji('👻'),
            new ButtonBuilder().setCustomId('unhide').setLabel('Unhide').setStyle(ButtonStyle.Secondary).setEmoji('👀')
        );
    
    // Row 2: Limit / Rename / Bitrate
    const row2 = new ActionRowBuilder()
        .addComponents(
            new ButtonBuilder().setCustomId('limit').setLabel('Limit').setStyle(ButtonStyle.Primary).setEmoji('📊'),
            new ButtonBuilder().setCustomId('rename').setLabel('Rename').setStyle(ButtonStyle.Secondary).setEmoji('✏️'),
            new ButtonBuilder().setCustomId('bitrate').setLabel('Bitrate').setStyle(ButtonStyle.Secondary).setEmoji('🎵')
        );
    
    // Row 3: Invite / Ban / Permit
    const row3 = new ActionRowBuilder()
        .addComponents(
            new ButtonBuilder().setCustomId('invite').setLabel('Invite').setStyle(ButtonStyle.Success).setEmoji('📨'),
            new ButtonBuilder().setCustomId('ban').setLabel('Ban').setStyle(ButtonStyle.Danger).setEmoji('🚫'),
            new ButtonBuilder().setCustomId('permit').setLabel('Permit').setStyle(ButtonStyle.Success).setEmoji('✅')
        );
    
    // Row 4: Claim / Transfer
    const row4 = new ActionRowBuilder()
        .addComponents(
            new ButtonBuilder().setCustomId('claim').setLabel('Claim').setStyle(ButtonStyle.Success).setEmoji('👑'),
            new ButtonBuilder().setCustomId('transfer').setLabel('Transfer').setStyle(ButtonStyle.Primary).setEmoji('🔄')
        );
    
    await textChannel.send({ 
        content: `🔊 **Control panel for ${voiceChannel.name}**`,
        embeds: [embed], 
        components: [row1, row2, row3, row4] 
    });
}

// ==================== HELPER FUNCTIONS ====================
async function getUsersRoom(interaction) {
    const member = interaction.member;
    const voiceChannel = member.voice.channel;
    
    if (!voiceChannel) {
        await interaction.reply({ 
            content: '❌ You need to be in a voice channel first!', 
            ephemeral: true 
        });
        return null;
    }
    
    const roomData = activeRooms.get(voiceChannel.id);
    if (!roomData) {
        await interaction.reply({ 
            content: '❌ This is not a temporary voice channel!', 
            ephemeral: true 
        });
        return null;
    }
    
    // Check if user is owner (or admin override)
    const isOwner = roomData.ownerId === member.user.id;
    const isAdmin = member.permissions.has(PermissionsBitField.Flags.Administrator);
    
    if (!isOwner && !isAdmin) {
        await interaction.reply({ 
            content: '❌ Only the channel owner can use these controls!', 
            ephemeral: true 
        });
        return null;
    }
    
    return { voiceChannel, roomData, isOwner };
}

// ==================== BUTTON HANDLERS ====================
client.on('interactionCreate', async (interaction) => {
    if (!interaction.isButton()) return;
    
    const result = await getUsersRoom(interaction);
    if (!result) return;
    
    const { voiceChannel, roomData } = result;
    
    switch (interaction.customId) {
        case 'lock':
            await voiceChannel.permissionOverwrites.edit(voiceChannel.guild.id, { Connect: false });
            await interaction.reply({ content: '🔒 **Channel locked!** Nobody new can join.', ephemeral: true });
            break;
            
        case 'unlock':
            await voiceChannel.permissionOverwrites.edit(voiceChannel.guild.id, { Connect: true });
            await interaction.reply({ content: '🔓 **Channel unlocked!** Anyone can join.', ephemeral: true });
            break;
            
        case 'hide':
            await voiceChannel.permissionOverwrites.edit(voiceChannel.guild.id, { ViewChannel: false });
            await interaction.reply({ content: '👻 **Channel hidden!** Only you can see it.', ephemeral: true });
            break;
            
        case 'unhide':
            await voiceChannel.permissionOverwrites.edit(voiceChannel.guild.id, { ViewChannel: true });
            await interaction.reply({ content: '👀 **Channel unhidden!** Everyone can see it.', ephemeral: true });
            break;
            
        case 'limit':
            await interaction.reply({ 
                content: '📊 **Set user limit**\nSend a number between 0-99 (0 = no limit)', 
                ephemeral: true 
            });
            
            const filter = m => m.author.id === interaction.user.id;
            const collected = await interaction.channel.awaitMessages({ filter, max: 1, time: 30000, errors: ['time'] }).catch(() => null);
            
            if (collected?.first()) {
                const limit = parseInt(collected.first().content);
                if (!isNaN(limit) && limit >= 0 && limit <= 99) {
                    await voiceChannel.setUserLimit(limit);
                    await interaction.followUp({ content: `✅ User limit set to **${limit === 0 ? 'unlimited' : limit}**`, ephemeral: true });
                    await collected.first().delete().catch(() => {});
                } else {
                    await interaction.followUp({ content: '❌ Invalid! Use 0-99.', ephemeral: true });
                }
            } else {
                await interaction.followUp({ content: '⏰ Timeout!', ephemeral: true });
            }
            break;
            
        case 'rename':
            await interaction.reply({ 
                content: '✏️ **Rename channel**\nSend the new name (max 32 characters)', 
                ephemeral: true 
            });
            
            const renameFilter = m => m.author.id === interaction.user.id;
            const renameCollected = await interaction.channel.awaitMessages({ filter: renameFilter, max: 1, time: 30000, errors: ['time'] }).catch(() => null);
            
            if (renameCollected?.first()) {
                const newName = renameCollected.first().content.slice(0, 32);
                await voiceChannel.setName(newName);
                
                // Update stored name
                roomData.voiceChannelName = newName;
                activeRooms.set(voiceChannel.id, roomData);
                
                await interaction.followUp({ content: `✅ Renamed to **${newName}**`, ephemeral: true });
                await renameCollected.first().delete().catch(() => {});
            } else {
                await interaction.followUp({ content: '⏰ Timeout!', ephemeral: true });
            }
            break;
            
        case 'bitrate':
            await interaction.reply({ 
                content: '🎵 **Set bitrate**\nSend a number between 8-384 kbps', 
                ephemeral: true 
            });
            
            const bitrateFilter = m => m.author.id === interaction.user.id;
            const bitrateCollected = await interaction.channel.awaitMessages({ filter: bitrateFilter, max: 1, time: 30000, errors: ['time'] }).catch(() => null);
            
            if (bitrateCollected?.first()) {
                const bitrate = parseInt(bitrateCollected.first().content);
                if (!isNaN(bitrate) && bitrate >= 8 && bitrate <= 384) {
                    await voiceChannel.setBitrate(bitrate * 1000);
                    await interaction.followUp({ content: `✅ Bitrate set to **${bitrate} kbps**`, ephemeral: true });
                    await bitrateCollected.first().delete().catch(() => {});
                } else {
                    await interaction.followUp({ content: '❌ Invalid! Use 8-384.', ephemeral: true });
                }
            } else {
                await interaction.followUp({ content: '⏰ Timeout!', ephemeral: true });
            }
            break;
            
        case 'invite':
            await interaction.reply({ 
                content: '📨 **Invite a user**\nMention the user you want to invite', 
                ephemeral: true 
            });
            
            const inviteFilter = m => m.author.id === interaction.user.id && m.mentions.users.size > 0;
            const inviteCollected = await interaction.channel.awaitMessages({ filter: inviteFilter, max: 1, time: 30000, errors: ['time'] }).catch(() => null);
            
            if (inviteCollected?.first()) {
                const targetUser = inviteCollected.first().mentions.users.first();
                await voiceChannel.permissionOverwrites.edit(targetUser.id, { Connect: true });
                await interaction.followUp({ content: `✅ **${targetUser.username}** can now join!`, ephemeral: true });
                await inviteCollected.first().delete().catch(() => {});
            } else {
                await interaction.followUp({ content: '⏰ Timeout!', ephemeral: true });
            }
            break;
            
        case 'ban':
            await interaction.reply({ 
                content: '🚫 **Ban a user**\nMention the user to ban from your channel', 
                ephemeral: true 
            });
            
            const banFilter = m => m.author.id === interaction.user.id && m.mentions.users.size > 0;
            const banCollected = await interaction.channel.awaitMessages({ filter: banFilter, max: 1, time: 30000, errors: ['time'] }).catch(() => null);
            
            if (banCollected?.first()) {
                const targetUser = banCollected.first().mentions.users.first();
                await voiceChannel.permissionOverwrites.edit(targetUser.id, { Connect: false });
                
                const member = voiceChannel.guild.members.cache.get(targetUser.id);
                if (member && voiceChannel.members.has(targetUser.id)) {
                    await member.voice.disconnect();
                }
                
                await interaction.followUp({ content: `✅ **${targetUser.username}** banned from your channel!`, ephemeral: true });
                await banCollected.first().delete().catch(() => {});
            } else {
                await interaction.followUp({ content: '⏰ Timeout!', ephemeral: true });
            }
            break;
            
        case 'permit':
            await interaction.reply({ 
                content: '✅ **Permit a user**\nMention the user to allow joining (if channel is locked)', 
                ephemeral: true 
            });
            
            const permitFilter = m => m.author.id === interaction.user.id && m.mentions.users.size > 0;
            const permitCollected = await interaction.channel.awaitMessages({ filter: permitFilter, max: 1, time: 30000, errors: ['time'] }).catch(() => null);
            
            if (permitCollected?.first()) {
                const targetUser = permitCollected.first().mentions.users.first();
                await voiceChannel.permissionOverwrites.edit(targetUser.id, { Connect: true });
                await interaction.followUp({ content: `✅ **${targetUser.username}** can now join!`, ephemeral: true });
                await permitCollected.first().delete().catch(() => {});
            } else {
                await interaction.followUp({ content: '⏰ Timeout!', ephemeral: true });
            }
            break;
            
        case 'claim':
            // Check if owner is still in channel
            const owner = voiceChannel.guild.members.cache.get(roomData.ownerId);
            const isOwnerInChannel = owner && voiceChannel.members.has(roomData.ownerId);
            
            if (isOwnerInChannel) {
                await interaction.reply({ content: '❌ The owner is still in the channel!', ephemeral: true });
            } else {
                // Update ownership
                const oldOwnerId = roomData.ownerId;
                roomData.ownerId = interaction.user.id;
                roomData.ownerName = interaction.user.username;
                activeRooms.set(voiceChannel.id, roomData);
                
                // Update permissions
                await voiceChannel.permissionOverwrites.edit(oldOwnerId, { Connect: false });
                await voiceChannel.permissionOverwrites.edit(interaction.user.id, {
                    Connect: true,
                    ManageChannels: true,
                    MuteMembers: true,
                    DeafenMembers: true,
                    MoveMembers: true
                });
                
                await interaction.reply({ content: '👑 **You now own this channel!**', ephemeral: true });
            }
            break;
            
        case 'transfer':
            await interaction.reply({ 
                content: '🔄 **Transfer ownership**\nMention the user to transfer ownership to', 
                ephemeral: true 
            });
            
            const transferFilter = m => m.author.id === interaction.user.id && m.mentions.users.size > 0;
            const transferCollected = await interaction.channel.awaitMessages({ filter: transferFilter, max: 1, time: 30000, errors: ['time'] }).catch(() => null);
            
            if (transferCollected?.first()) {
                const newOwner = transferCollected.first().mentions.users.first();
                const newOwnerMember = voiceChannel.guild.members.cache.get(newOwner.id);
                
                if (!newOwnerMember) {
                    await interaction.followUp({ content: '❌ User not found in this server!', ephemeral: true });
                } else {
                    const oldOwnerId = roomData.ownerId;
                    roomData.ownerId = newOwner.id;
                    roomData.ownerName = newOwner.username;
                    activeRooms.set(voiceChannel.id, roomData);
                    
                    await voiceChannel.permissionOverwrites.edit(oldOwnerId, { Connect: true, ManageChannels: false });
                    await voiceChannel.permissionOverwrites.edit(newOwner.id, {
                        Connect: true,
                        ManageChannels: true,
                        MuteMembers: true,
                        DeafenMembers: true,
                        MoveMembers: true
                    });
                    
                    await interaction.followUp({ content: `✅ Transferred ownership to **${newOwner.username}**`, ephemeral: true });
                    await transferCollected.first().delete().catch(() => {});
                }
            } else {
                await interaction.followUp({ content: '⏰ Timeout!', ephemeral: true });
            }
            break;
            
        default:
            await interaction.reply({ content: `⚠️ Button coming soon!`, ephemeral: true });
    }
});

// ==================== ERROR HANDLING ====================
process.on('unhandledRejection', (error) => {
    console.error('❌ Unhandled rejection:', error.message);
});

process.on('uncaughtException', (error) => {
    console.error('❌ Uncaught exception:', error.message);
});

// ==================== START BOT ====================
client.login(CONFIG.DISCORD_TOKEN).then(() => {
    console.log('🔌 Connecting to Discord...');
}).catch(err => {
    console.error('❌ Failed to login! Check your DISCORD_TOKEN');
    console.error(err.message);
    process.exit(1);
});
