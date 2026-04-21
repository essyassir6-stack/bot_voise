const { Client, GatewayIntentBits, ChannelType, ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder, PermissionsBitField, StringSelectMenuBuilder, StringSelectMenuOptionBuilder, ComponentType } = require('discord.js');
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
        GatewayIntentBits.MessageContent,
        GatewayIntentBits.GuildMembers
    ]
});

// Store active rooms: voiceChannelId -> { textChannelId, ownerId, ownerName, panelMessageId }
const activeRooms = new Map();

// Store temporary action context for user selection
const pendingActions = new Map(); // userId -> { action, voiceChannelId, interaction }

// ==================== READY EVENT ====================
client.once('ready', async () => {
    console.log(`✅ Bot is online!`);
    console.log(`📡 Logged in as: ${client.user.tag}`);
    
    const lobbyChannel = client.channels.cache.get(CONFIG.LOBBY_CHANNEL_ID);
    if (!lobbyChannel) {
        console.error(`❌ LOBBY_CHANNEL_ID not found! Please check the ID: ${CONFIG.LOBBY_CHANNEL_ID}`);
    } else {
        console.log(`✅ Lobby channel: #${lobbyChannel.name}`);
        console.log(`🎤 Users will get their own VC + locked control panel`);
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
            
            // 2. Create LOCKED Text Channel (no typing allowed)
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
                            PermissionsBitField.Flags.ReadMessageHistory
                        ],
                        deny: [
                            PermissionsBitField.Flags.SendMessages,
                            PermissionsBitField.Flags.CreateInstantInvite,
                            PermissionsBitField.Flags.AddReactions
                        ]
                    },
                    {
                        id: client.user.id,
                        allow: [
                            PermissionsBitField.Flags.ViewChannel,
                            PermissionsBitField.Flags.SendMessages,
                            PermissionsBitField.Flags.ReadMessageHistory,
                            PermissionsBitField.Flags.ManageMessages,
                            PermissionsBitField.Flags.ManageChannels
                        ]
                    }
                ]
            });
            
            // 3. Send Control Panel in the locked text channel
            const panelMessage = await sendControlPanel(textChannel, user, voiceChannel);
            
            // 4. Store room data
            activeRooms.set(voiceChannel.id, {
                textChannelId: textChannel.id,
                ownerId: user.id,
                ownerName: user.username,
                voiceChannelName: voiceChannel.name,
                panelMessageId: panelMessage.id
            });
            
            // 5. Move user to their new voice channel
            await newState.member.voice.setChannel(voiceChannel);
            
            console.log(`✅ Created: VC "${voiceChannel.name}" + Locked Text "#${textChannel.name}" for ${user.username}`);
            
        } catch (error) {
            console.error(`❌ Error creating rooms for ${user.username}:`, error.message);
        }
    }
    
    // CASE 2: User left their voice channel (cleanup)
    if (oldState.channelId && activeRooms.has(oldState.channelId)) {
        const roomData = activeRooms.get(oldState.channelId);
        const voiceChannel = guild.channels.cache.get(oldState.channelId);
        const textChannel = guild.channels.cache.get(roomData.textChannelId);
        
        if (voiceChannel && voiceChannel.members.size === 0) {
            try {
                if (voiceChannel) await voiceChannel.delete();
                if (textChannel) await textChannel.delete();
                activeRooms.delete(oldState.channelId);
                pendingActions.delete(roomData.ownerId);
                
                console.log(`🗑️ Deleted: VC + Locked Text for ${roomData.ownerName}`);
            } catch (error) {
                console.error(`❌ Error deleting rooms:`, error.message);
            }
        }
    }
});

// ==================== CONTROL PANEL ====================
async function sendControlPanel(textChannel, owner, voiceChannel) {
    const embed = new EmbedBuilder()
        .setTitle('🎮 Voice Channel Control Panel')
        .setDescription(`Welcome **${owner.username}**!\n\nUse the buttons below to manage **${voiceChannel.name}**.\n\n> **Note:** This channel is locked — only buttons work here.`)
        .setColor('#5865F2')
        .setImage(CONFIG.BANNER_IMAGE_URL)
        .addFields(
            { name: '👑 Owner', value: `${owner.username}`, inline: true },
            { name: '📊 Users in VC', value: `${voiceChannel.members.size}`, inline: true },
            { name: '🔒 Status', value: 'Unlocked', inline: true }
        )
        .setFooter({ text: `Click buttons to control your channel`, iconURL: owner.displayAvatarURL() })
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
    
    // Row 3: Kick / Move / Ban / Permit
    const row3 = new ActionRowBuilder()
        .addComponents(
            new ButtonBuilder().setCustomId('kick').setLabel('Kick').setStyle(ButtonStyle.Danger).setEmoji('👢'),
            new ButtonBuilder().setCustomId('move').setLabel('Move').setStyle(ButtonStyle.Primary).setEmoji('🔄'),
            new ButtonBuilder().setCustomId('ban').setLabel('Ban').setStyle(ButtonStyle.Danger).setEmoji('🚫'),
            new ButtonBuilder().setCustomId('permit').setLabel('Permit').setStyle(ButtonStyle.Success).setEmoji('✅')
        );
    
    // Row 4: Invite / Claim / Transfer
    const row4 = new ActionRowBuilder()
        .addComponents(
            new ButtonBuilder().setCustomId('invite').setLabel('Invite').setStyle(ButtonStyle.Success).setEmoji('📨'),
            new ButtonBuilder().setCustomId('claim').setLabel('Claim').setStyle(ButtonStyle.Success).setEmoji('👑'),
            new ButtonBuilder().setCustomId('transfer').setLabel('Transfer').setStyle(ButtonStyle.Primary).setEmoji('🔄')
        );
    
    const message = await textChannel.send({ 
        content: `🔊 **Control panel for ${voiceChannel.name}**`,
        embeds: [embed], 
        components: [row1, row2, row3, row4] 
    });
    
    return message;
}

async function updatePanelEmbed(interaction, voiceChannel, roomData) {
    const embed = new EmbedBuilder()
        .setTitle('🎮 Voice Channel Control Panel')
        .setDescription(`Manage **${voiceChannel.name}** using the buttons below.`)
        .setColor('#5865F2')
        .setImage(CONFIG.BANNER_IMAGE_URL)
        .addFields(
            { name: '👑 Owner', value: `<@${roomData.ownerId}>`, inline: true },
            { name: '📊 Users in VC', value: `${voiceChannel.members.size}`, inline: true },
            { name: '👥 Users', value: voiceChannel.members.map(m => `• ${m.user.username}`).join('\n') || 'None', inline: false }
        )
        .setFooter({ text: `Channel locked • Only buttons work` })
        .setTimestamp();
    
    const textChannel = interaction.channel;
    const panelMessage = await textChannel.messages.fetch(roomData.panelMessageId).catch(() => null);
    if (panelMessage) {
        await panelMessage.edit({ embeds: [embed] });
    }
}

// ==================== USER SELECTION MENU ====================
async function showUserSelectionMenu(interaction, voiceChannel, action) {
    const members = voiceChannel.members.filter(m => !m.user.bot);
    
    if (members.size === 0) {
        await interaction.reply({ 
            content: '❌ No users in your voice channel to perform this action!', 
            ephemeral: true 
        });
        return null;
    }
    
    const selectMenu = new StringSelectMenuBuilder()
        .setCustomId(`user_select_${action}`)
        .setPlaceholder(`Select a user to ${action}...`)
        .addOptions(
            members.map(member => 
                new StringSelectMenuOptionBuilder()
                    .setLabel(member.user.username)
                    .setValue(member.id)
                    .setDescription(`ID: ${member.id}`)
                    .setEmoji('👤')
            )
        );
    
    const row = new ActionRowBuilder().addComponents(selectMenu);
    
    const reply = await interaction.reply({
        content: `👥 **Select a user to ${action}** from ${voiceChannel.name}:`,
        components: [row],
        ephemeral: true
    });
    
    return reply;
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
    if (interaction.isStringSelectMenu()) {
        // Handle user selection from menu
        const match = interaction.customId.match(/user_select_(.+)/);
        if (!match) return;
        
        const action = match[1];
        const targetUserId = interaction.values[0];
        const pendingData = pendingActions.get(interaction.user.id);
        
        if (!pendingData || pendingData.action !== action) {
            await interaction.reply({ content: '❌ Session expired! Please click the button again.', ephemeral: true });
            return;
        }
        
        const { voiceChannelId } = pendingData;
        const voiceChannel = interaction.guild.channels.cache.get(voiceChannelId);
        
        if (!voiceChannel) {
            await interaction.reply({ content: '❌ Voice channel not found!', ephemeral: true });
            pendingActions.delete(interaction.user.id);
            return;
        }
        
        const targetMember = voiceChannel.members.get(targetUserId);
        if (!targetMember) {
            await interaction.reply({ content: '❌ That user is no longer in your voice channel!', ephemeral: true });
            pendingActions.delete(interaction.user.id);
            return;
        }
        
        const roomData = activeRooms.get(voiceChannel.id);
        
        // Perform the action
        switch (action) {
            case 'kick':
                await targetMember.voice.disconnect();
                await interaction.reply({ content: `✅ **${targetMember.user.username}** has been kicked from your channel!`, ephemeral: true });
                break;
                
            case 'move':
                // Move to lobby or specific channel
                const lobbyChannel = interaction.guild.channels.cache.get(CONFIG.LOBBY_CHANNEL_ID);
                await targetMember.voice.setChannel(lobbyChannel);
                await interaction.reply({ content: `✅ **${targetMember.user.username}** has been moved to the lobby!`, ephemeral: true });
                break;
                
            case 'ban':
                await voiceChannel.permissionOverwrites.edit(targetUserId, { Connect: false });
                if (targetMember.voice.channelId === voiceChannel.id) {
                    await targetMember.voice.disconnect();
                }
                await interaction.reply({ content: `✅ **${targetMember.user.username}** has been banned from your channel!`, ephemeral: true });
                break;
                
            case 'permit':
                await voiceChannel.permissionOverwrites.edit(targetUserId, { Connect: true });
                await interaction.reply({ content: `✅ **${targetMember.user.username}** can now join your channel!`, ephemeral: true });
                break;
        }
        
        // Update panel embed
        await updatePanelEmbed(interaction, voiceChannel, roomData);
        pendingActions.delete(interaction.user.id);
        await interaction.message.delete().catch(() => {});
        return;
    }
    
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
            
        case 'kick':
            pendingActions.set(interaction.user.id, { action: 'kick', voiceChannelId: voiceChannel.id, timestamp: Date.now() });
            await showUserSelectionMenu(interaction, voiceChannel, 'kick');
            break;
            
        case 'move':
            pendingActions.set(interaction.user.id, { action: 'move', voiceChannelId: voiceChannel.id, timestamp: Date.now() });
            await showUserSelectionMenu(interaction, voiceChannel, 'move');
            break;
            
        case 'ban':
            pendingActions.set(interaction.user.id, { action: 'ban', voiceChannelId: voiceChannel.id, timestamp: Date.now() });
            await showUserSelectionMenu(interaction, voiceChannel, 'ban');
            break;
            
        case 'permit':
            pendingActions.set(interaction.user.id, { action: 'permit', voiceChannelId: voiceChannel.id, timestamp: Date.now() });
            await showUserSelectionMenu(interaction, voiceChannel, 'permit');
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
            
        case 'claim':
            const owner = voiceChannel.guild.members.cache.get(roomData.ownerId);
            const isOwnerInChannel = owner && voiceChannel.members.has(roomData.ownerId);
            
            if (isOwnerInChannel) {
                await interaction.reply({ content: '❌ The owner is still in the channel!', ephemeral: true });
            } else {
                const oldOwnerId = roomData.ownerId;
                roomData.ownerId = interaction.user.id;
                roomData.ownerName = interaction.user.username;
                activeRooms.set(voiceChannel.id, roomData);
                
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
    }
    
    // Update panel embed after any changes
    await updatePanelEmbed(interaction, voiceChannel, roomData);
});

// Clean up expired pending actions every minute
setInterval(() => {
    const now = Date.now();
    for (const [userId, data] of pendingActions) {
        if (now - data.timestamp > 60000) { // 1 minute timeout
            pendingActions.delete(userId);
        }
    }
}, 60000);

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
const { Client, GatewayIntentBits, ChannelType, ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder, PermissionsBitField, StringSelectMenuBuilder, StringSelectMenuOptionBuilder, SlashCommandBuilder, Routes } = require('discord.js');
const { joinVoiceChannel, createAudioPlayer, createAudioResource, AudioPlayerStatus, VoiceConnectionStatus } = require('@discordjs/voice');
const play = require('play-dl');
require('dotenv').config();

// ==================== VALIDATE ENVIRONMENT VARIABLES ====================
const requiredEnvVars = ['DISCORD_TOKEN', 'CLIENT_ID', 'GUILD_ID', 'LOBBY_CHANNEL_ID'];
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
    CLIENT_ID: process.env.CLIENT_ID,
    GUILD_ID: process.env.GUILD_ID,
    LOBBY_CHANNEL_ID: process.env.LOBBY_CHANNEL_ID,
    BANNER_IMAGE_URL: process.env.BANNER_IMAGE_URL || 'https://media.discordapp.net/attachments/1480969774895730690/1496251251896352829/21906d71-f457-4fe4-af53-9f4353f00381.png'
};

// ==================== BOT INITIALIZATION ====================
const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildVoiceStates,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent,
        GatewayIntentBits.GuildMembers
    ]
});

// Store active rooms: voiceChannelId -> { textChannelId, ownerId, ownerName, panelMessageId }
const activeRooms = new Map();

// Store temporary action context for user selection
const pendingActions = new Map();

// Store music players per guild
const musicPlayers = new Map(); // guildId -> { connection, player, currentChannelId }

// ==================== READY EVENT ====================
client.once('ready', async () => {
    console.log(`✅ Bot is online!`);
    console.log(`📡 Logged in as: ${client.user.tag}`);
    
    // Register slash commands
    await registerSlashCommands();
    
    const lobbyChannel = client.channels.cache.get(CONFIG.LOBBY_CHANNEL_ID);
    if (!lobbyChannel) {
        console.error(`❌ LOBBY_CHANNEL_ID not found! Please check the ID: ${CONFIG.LOBBY_CHANNEL_ID}`);
    } else {
        console.log(`✅ Lobby channel: #${lobbyChannel.name}`);
        console.log(`🎤 Users will get their own VC + locked control panel`);
        console.log(`🎵 Use /ms <link> to play music!`);
    }
});

// ==================== SLASH COMMAND REGISTRATION ====================
async function registerSlashCommands() {
    const commands = [
        new SlashCommandBuilder()
            .setName('ms')
            .setDescription('Play music from YouTube')
            .addStringOption(option =>
                option.setName('link')
                    .setDescription('YouTube link or search term')
                    .setRequired(true)
            )
    ];
    
    try {
        await client.rest.put(
            Routes.applicationGuildCommands(CONFIG.CLIENT_ID, CONFIG.GUILD_ID),
            { body: commands }
        );
        console.log('✅ Slash commands registered!');
    } catch (error) {
        console.error('❌ Failed to register slash commands:', error);
    }
}

// ==================== MUSIC SYSTEM ====================
async function playMusic(interaction, query) {
    const member = interaction.member;
    const voiceChannel = member.voice.channel;
    
    if (!voiceChannel) {
        await interaction.reply({ content: '❌ You need to be in a voice channel first!', ephemeral: true });
        return;
    }
    
    await interaction.reply({ content: `🔍 Searching for music...`, ephemeral: false });
    
    try {
        // Validate YouTube URL or search
        let url = query;
        if (!url.includes('youtube.com') && !url.includes('youtu.be')) {
            // Search on YouTube
            const searchResults = await play.search(query, { limit: 1 });
            if (searchResults.length === 0) {
                await interaction.editReply({ content: '❌ No results found!' });
                return;
            }
            url = searchResults[0].url;
        }
        
        // Get video info
        const videoInfo = await play.video_info(url);
        const videoTitle = videoInfo.video_details.title;
        const videoDuration = videoInfo.video_details.durationRaw;
        const videoThumbnail = videoInfo.video_details.thumbnails[0]?.url;
        
        await interaction.editReply({ content: `🎵 Now playing: **${videoTitle}** (${videoDuration})` });
        
        // Join voice channel
        let connection = musicPlayers.get(interaction.guildId)?.connection;
        
        if (!connection || connection.state.status === VoiceConnectionStatus.Disconnected) {
            connection = joinVoiceChannel({
                channelId: voiceChannel.id,
                guildId: interaction.guildId,
                adapterCreator: interaction.guild.voiceAdapterCreator,
            });
        }
        
        // Create audio player
        let player = musicPlayers.get(interaction.guildId)?.player;
        if (!player) {
            player = createAudioPlayer();
            connection.subscribe(player);
        }
        
        // Get stream
        const stream = await play.stream(url);
        const resource = createAudioResource(stream.stream, {
            inputType: stream.type,
        });
        
        // Play
        player.play(resource);
        
        // Store player info
        musicPlayers.set(interaction.guildId, {
            connection,
            player,
            currentChannelId: voiceChannel.id,
            currentTitle: videoTitle,
            currentUrl: url
        });
        
        // Handle player events
        player.on(AudioPlayerStatus.Idle, () => {
            console.log(`🎵 Finished playing: ${videoTitle}`);
            // Don't auto-disconnect, keep connection for next song
        });
        
        player.on('error', error => {
            console.error('Player error:', error);
            interaction.followUp({ content: '❌ An error occurred while playing!', ephemeral: true });
        });
        
        // Send now playing embed to control panel if exists
        const roomData = Array.from(activeRooms.values()).find(r => r.ownerId === member.user.id);
        if (roomData) {
            const textChannel = interaction.guild.channels.cache.get(roomData.textChannelId);
            if (textChannel) {
                const musicEmbed = new EmbedBuilder()
                    .setTitle('🎵 Now Playing')
                    .setDescription(`[${videoTitle}](${url})`)
                    .setColor('#5865F2')
                    .setThumbnail(videoThumbnail)
                    .addFields(
                        { name: 'Duration', value: videoDuration, inline: true },
                        { name: 'Requested by', value: member.user.username, inline: true }
                    )
                    .setTimestamp();
                
                await textChannel.send({ embeds: [musicEmbed] }).catch(() => {});
            }
        }
        
    } catch (error) {
        console.error('Music error:', error);
        await interaction.editReply({ content: '❌ Failed to play music! Make sure the link is valid.' });
    }
}

// ==================== VOICE SYSTEM ====================
client.on('voiceStateUpdate', async (oldState, newState) => {
    const user = newState.member?.user;
    if (!user || user.bot) return;
    
    const guild = newState.guild;
    
    // CASE 1: User joined the lobby channel
    if (newState.channelId === CONFIG.LOBBY_CHANNEL_ID && oldState.channelId !== CONFIG.LOBBY_CHANNEL_ID) {
        try {
            console.log(`📢 ${user.username} joined lobby, creating rooms...`);
            
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
            
            // 2. Create LOCKED Text Channel (no typing allowed)
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
                            PermissionsBitField.Flags.ReadMessageHistory
                        ],
                        deny: [
                            PermissionsBitField.Flags.SendMessages,
                            PermissionsBitField.Flags.CreateInstantInvite,
                            PermissionsBitField.Flags.AddReactions
                        ]
                    },
                    {
                        id: client.user.id,
                        allow: [
                            PermissionsBitField.Flags.ViewChannel,
                            PermissionsBitField.Flags.SendMessages,
                            PermissionsBitField.Flags.ReadMessageHistory,
                            PermissionsBitField.Flags.ManageMessages,
                            PermissionsBitField.Flags.ManageChannels
                        ]
                    }
                ]
            });
            
            // 3. Send Control Panel in the locked text channel
            const panelMessage = await sendControlPanel(textChannel, user, voiceChannel);
            
            // 4. Store room data
            activeRooms.set(voiceChannel.id, {
                textChannelId: textChannel.id,
                ownerId: user.id,
                ownerName: user.username,
                voiceChannelName: voiceChannel.name,
                panelMessageId: panelMessage.id
            });
            
            // 5. Move user to their new voice channel
            await newState.member.voice.setChannel(voiceChannel);
            
            console.log(`✅ Created: VC "${voiceChannel.name}" + Locked Text "#${textChannel.name}" for ${user.username}`);
            
        } catch (error) {
            console.error(`❌ Error creating rooms for ${user.username}:`, error.message);
        }
    }
    
    // CASE 2: User left their voice channel (cleanup)
    if (oldState.channelId && activeRooms.has(oldState.channelId)) {
        const roomData = activeRooms.get(oldState.channelId);
        const voiceChannel = guild.channels.cache.get(oldState.channelId);
        const textChannel = guild.channels.cache.get(roomData.textChannelId);
        
        if (voiceChannel && voiceChannel.members.size === 0) {
            try {
                if (voiceChannel) await voiceChannel.delete();
                if (textChannel) await textChannel.delete();
                activeRooms.delete(oldState.channelId);
                pendingActions.delete(roomData.ownerId);
                
                console.log(`🗑️ Deleted: VC + Locked Text for ${roomData.ownerName}`);
            } catch (error) {
                console.error(`❌ Error deleting rooms:`, error.message);
            }
        }
    }
});

// ==================== CONTROL PANEL ====================
async function sendControlPanel(textChannel, owner, voiceChannel) {
    const embed = new EmbedBuilder()
        .setTitle('🎮 Voice Channel Control Panel')
        .setDescription(`Welcome **${owner.username}**!\n\nUse the buttons below to manage **${voiceChannel.name}**.\n\n> **Note:** This channel is locked — only buttons work here.`)
        .setColor('#5865F2')
        .setImage(CONFIG.BANNER_IMAGE_URL)
        .addFields(
            { name: '👑 Owner', value: `${owner.username}`, inline: true },
            { name: '📊 Users in VC', value: `${voiceChannel.members.size}`, inline: true },
            { name: '🎵 Music', value: 'Use `/ms <link>` in any channel!', inline: false }
        )
        .setFooter({ text: `Click buttons to control your channel`, iconURL: owner.displayAvatarURL() })
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
    
    // Row 3: Kick / Move / Ban / Permit
    const row3 = new ActionRowBuilder()
        .addComponents(
            new ButtonBuilder().setCustomId('kick').setLabel('Kick').setStyle(ButtonStyle.Danger).setEmoji('👢'),
            new ButtonBuilder().setCustomId('move').setLabel('Move').setStyle(ButtonStyle.Primary).setEmoji('🔄'),
            new ButtonBuilder().setCustomId('ban').setLabel('Ban').setStyle(ButtonStyle.Danger).setEmoji('🚫'),
            new ButtonBuilder().setCustomId('permit').setLabel('Permit').setStyle(ButtonStyle.Success).setEmoji('✅')
        );
    
    // Row 4: Invite / Claim / Transfer
    const row4 = new ActionRowBuilder()
        .addComponents(
            new ButtonBuilder().setCustomId('invite').setLabel('Invite').setStyle(ButtonStyle.Success).setEmoji('📨'),
            new ButtonBuilder().setCustomId('claim').setLabel('Claim').setStyle(ButtonStyle.Success).setEmoji('👑'),
            new ButtonBuilder().setCustomId('transfer').setLabel('Transfer').setStyle(ButtonStyle.Primary).setEmoji('🔄')
        );
    
    const message = await textChannel.send({ 
        content: `🔊 **Control panel for ${voiceChannel.name}**\n🎵 **Music command:** \`/ms <youtube link>\``,
        embeds: [embed], 
        components: [row1, row2, row3, row4] 
    });
    
    return message;
}

async function updatePanelEmbed(interaction, voiceChannel, roomData) {
    const embed = new EmbedBuilder()
        .setTitle('🎮 Voice Channel Control Panel')
        .setDescription(`Manage **${voiceChannel.name}** using the buttons below.`)
        .setColor('#5865F2')
        .setImage(CONFIG.BANNER_IMAGE_URL)
        .addFields(
            { name: '👑 Owner', value: `<@${roomData.ownerId}>`, inline: true },
            { name: '📊 Users in VC', value: `${voiceChannel.members.size}`, inline: true },
            { name: '🎵 Music', value: 'Use `/ms <link>` in any channel!', inline: false },
            { name: '👥 Users', value: voiceChannel.members.map(m => `• ${m.user.username}`).join('\n') || 'None', inline: false }
        )
        .setFooter({ text: `Channel locked • Only buttons work` })
        .setTimestamp();
    
    const textChannel = interaction.channel;
    const panelMessage = await textChannel.messages.fetch(roomData.panelMessageId).catch(() => null);
    if (panelMessage) {
        await panelMessage.edit({ embeds: [embed] });
    }
}

// ==================== USER SELECTION MENU ====================
async function showUserSelectionMenu(interaction, voiceChannel, action) {
    const members = voiceChannel.members.filter(m => !m.user.bot);
    
    if (members.size === 0) {
        await interaction.reply({ 
            content: '❌ No users in your voice channel to perform this action!', 
            ephemeral: true 
        });
        return null;
    }
    
    const selectMenu = new StringSelectMenuBuilder()
        .setCustomId(`user_select_${action}`)
        .setPlaceholder(`Select a user to ${action}...`)
        .addOptions(
            members.map(member => 
                new StringSelectMenuOptionBuilder()
                    .setLabel(member.user.username)
                    .setValue(member.id)
                    .setDescription(`ID: ${member.id}`)
                    .setEmoji('👤')
            )
        );
    
    const row = new ActionRowBuilder().addComponents(selectMenu);
    
    const reply = await interaction.reply({
        content: `👥 **Select a user to ${action}** from ${voiceChannel.name}:`,
        components: [row],
        ephemeral: true
    });
    
    return reply;
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

// ==================== SLASH COMMAND HANDLER ====================
client.on('interactionCreate', async (interaction) => {
    if (interaction.isCommand() && interaction.commandName === 'ms') {
        const link = interaction.options.getString('link');
        await playMusic(interaction, link);
        return;
    }
    
    if (interaction.isStringSelectMenu()) {
        const match = interaction.customId.match(/user_select_(.+)/);
        if (!match) return;
        
        const action = match[1];
        const targetUserId = interaction.values[0];
        const pendingData = pendingActions.get(interaction.user.id);
        
        if (!pendingData || pendingData.action !== action) {
            await interaction.reply({ content: '❌ Session expired! Please click the button again.', ephemeral: true });
            return;
        }
        
        const { voiceChannelId } = pendingData;
        const voiceChannel = interaction.guild.channels.cache.get(voiceChannelId);
        
        if (!voiceChannel) {
            await interaction.reply({ content: '❌ Voice channel not found!', ephemeral: true });
            pendingActions.delete(interaction.user.id);
            return;
        }
        
        const targetMember = voiceChannel.members.get(targetUserId);
        if (!targetMember) {
            await interaction.reply({ content: '❌ That user is no longer in your voice channel!', ephemeral: true });
            pendingActions.delete(interaction.user.id);
            return;
        }
        
        const roomData = activeRooms.get(voiceChannel.id);
        
        switch (action) {
            case 'kick':
                await targetMember.voice.disconnect();
                await interaction.reply({ content: `✅ **${targetMember.user.username}** has been kicked from your channel!`, ephemeral: true });
                break;
                
            case 'move':
                const lobbyChannel = interaction.guild.channels.cache.get(CONFIG.LOBBY_CHANNEL_ID);
                await targetMember.voice.setChannel(lobbyChannel);
                await interaction.reply({ content: `✅ **${targetMember.user.username}** has been moved to the lobby!`, ephemeral: true });
                break;
                
            case 'ban':
                await voiceChannel.permissionOverwrites.edit(targetUserId, { Connect: false });
                if (targetMember.voice.channelId === voiceChannel.id) {
                    await targetMember.voice.disconnect();
                }
                await interaction.reply({ content: `✅ **${targetMember.user.username}** has been banned from your channel!`, ephemeral: true });
                break;
                
            case 'permit':
                await voiceChannel.permissionOverwrites.edit(targetUserId, { Connect: true });
                await interaction.reply({ content: `✅ **${targetMember.user.username}** can now join your channel!`, ephemeral: true });
                break;
        }
        
        await updatePanelEmbed(interaction, voiceChannel, roomData);
        pendingActions.delete(interaction.user.id);
        await interaction.message.delete().catch(() => {});
        return;
    }
    
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
            
        case 'kick':
            pendingActions.set(interaction.user.id, { action: 'kick', voiceChannelId: voiceChannel.id, timestamp: Date.now() });
            await showUserSelectionMenu(interaction, voiceChannel, 'kick');
            break;
            
        case 'move':
            pendingActions.set(interaction.user.id, { action: 'move', voiceChannelId: voiceChannel.id, timestamp: Date.now() });
            await showUserSelectionMenu(interaction, voiceChannel, 'move');
            break;
            
        case 'ban':
            pendingActions.set(interaction.user.id, { action: 'ban', voiceChannelId: voiceChannel.id, timestamp: Date.now() });
            await showUserSelectionMenu(interaction, voiceChannel, 'ban');
            break;
            
        case 'permit':
            pendingActions.set(interaction.user.id, { action: 'permit', voiceChannelId: voiceChannel.id, timestamp: Date.now() });
            await showUserSelectionMenu(interaction, voiceChannel, 'permit');
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
            
        case 'claim':
            const owner = voiceChannel.guild.members.cache.get(roomData.ownerId);
            const isOwnerInChannel = owner && voiceChannel.members.has(roomData.ownerId);
            
            if (isOwnerInChannel) {
                await interaction.reply({ content: '❌ The owner is still in the channel!', ephemeral: true });
            } else {
                const oldOwnerId = roomData.ownerId;
                roomData.ownerId = interaction.user.id;
                roomData.ownerName = interaction.user.username;
                activeRooms.set(voiceChannel.id, roomData);
                
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
    }
    
    await updatePanelEmbed(interaction, voiceChannel, roomData);
});

// Clean up expired pending actions every minute
setInterval(() => {
    const now = Date.now();
    for (const [userId, data] of pendingActions) {
        if (now - data.timestamp > 60000) {
            pendingActions.delete(userId);
        }
    }
}, 60000);

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
