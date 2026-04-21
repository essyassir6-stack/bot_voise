const { Client, GatewayIntentBits, ChannelType, ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder, PermissionsBitField } = require('discord.js');
require('dotenv').config();

// ==================== VALIDATE ENVIRONMENT VARIABLES ====================
const requiredEnvVars = ['DISCORD_TOKEN', 'LOBBY_CHANNEL_ID', 'CONTROL_PANEL_CHANNEL_ID'];
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
    CONTROL_PANEL_CHANNEL_ID: process.env.CONTROL_PANEL_CHANNEL_ID,
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

// Store active channels: userId -> { channelId, channelName, createdAt }
const activeChannels = new Map();

// ==================== READY EVENT ====================
client.once('ready', async () => {
    console.log(`✅ Bot is online!`);
    console.log(`📡 Logged in as: ${client.user.tag}`);
    console.log(`🔧 Server: ${client.guilds.cache.size} guild(s)`);
    
    // Verify channels exist
    const lobbyChannel = client.channels.cache.get(CONFIG.LOBBY_CHANNEL_ID);
    const controlPanelChannel = client.channels.cache.get(CONFIG.CONTROL_PANEL_CHANNEL_ID);
    
    if (!lobbyChannel) {
        console.error(`❌ LOBBY_CHANNEL_ID not found! Please check the ID: ${CONFIG.LOBBY_CHANNEL_ID}`);
    } else {
        console.log(`✅ Lobby channel: #${lobbyChannel.name}`);
    }
    
    if (!controlPanelChannel) {
        console.error(`❌ CONTROL_PANEL_CHANNEL_ID not found! Please check the ID: ${CONFIG.CONTROL_PANEL_CHANNEL_ID}`);
    } else {
        console.log(`✅ Control panel channel: #${controlPanelChannel.name}`);
    }
    
    // Send control panel (only once, when bot starts)
    if (controlPanelChannel) {
        await sendControlPanel(controlPanelChannel);
        console.log(`📋 Control panel sent!`);
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
            // Delete any existing channel the user might have (cleanup)
            if (activeChannels.has(user.id)) {
                const oldChannel = guild.channels.cache.get(activeChannels.get(user.id).channelId);
                if (oldChannel) await oldChannel.delete().catch(() => {});
                activeChannels.delete(user.id);
            }
            
            // Create temporary voice channel
            const tempChannel = await guild.channels.create({
                name: `${user.username}'s Room`,
                type: ChannelType.GuildVoice,
                parent: newState.channel.parentId,
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
            
            // Move user to new channel
            await newState.member.voice.setChannel(tempChannel);
            
            // Store channel info
            activeChannels.set(user.id, {
                channelId: tempChannel.id,
                channelName: tempChannel.name,
                createdAt: Date.now()
            });
            
            console.log(`✅ Created: ${tempChannel.name} for ${user.username}`);
            
        } catch (error) {
            console.error(`❌ Error creating channel for ${user.username}:`, error.message);
        }
    }
    
    // CASE 2: User left their temporary channel
    if (oldState.channelId && activeChannels.has(user.id)) {
        const userChannel = activeChannels.get(user.id);
        
        if (oldState.channelId === userChannel.channelId && !newState.channelId) {
            try {
                const channelToDelete = guild.channels.cache.get(userChannel.channelId);
                if (channelToDelete) {
                    await channelToDelete.delete();
                    activeChannels.delete(user.id);
                    console.log(`🗑️ Deleted: ${userChannel.channelName} (${user.username})`);
                }
            } catch (error) {
                console.error(`❌ Error deleting channel:`, error.message);
            }
        }
    }
    
    // CASE 3: Auto-cleanup empty channels (runs every voice update)
    setTimeout(async () => {
        for (const [ownerId, channelData] of activeChannels) {
            const tempChannel = guild.channels.cache.get(channelData.channelId);
            if (tempChannel && tempChannel.members.size === 0) {
                try {
                    await tempChannel.delete();
                    activeChannels.delete(ownerId);
                    console.log(`🧹 Cleaned: ${channelData.channelName} (empty)`);
                } catch (err) {
                    // Channel already deleted
                }
            }
        }
    }, 5000); // Check after 5 seconds
});

// ==================== CONTROL PANEL ====================
async function sendControlPanel(channel) {
    const embed = new EmbedBuilder()
        .setTitle('🎮 Voice Channel Control Panel')
        .setDescription('### Manage your temporary voice channel\nUse the buttons below to control your channel.\n\n> **Note:** Buttons only work for your own channel.')
        .setColor('#5865F2')
        .setImage(CONFIG.BANNER_IMAGE_URL)
        .setFooter({ text: 'Temporary Voice Bot • Made for Railway', iconURL: client.user.displayAvatarURL() })
        .setTimestamp();
    
    // Row 1: Lock / Unlock / Hide / Unhide
    const row1 = new ActionRowBuilder()
        .addComponents(
            new ButtonBuilder().setCustomId('lock').setLabel('Lock').setStyle(ButtonStyle.Danger).setEmoji('🔒'),
            new ButtonBuilder().setCustomId('unlock').setLabel('Unlock').setStyle(ButtonStyle.Success).setEmoji('🔓'),
            new ButtonBuilder().setCustomId('hide').setLabel('Hide').setStyle(ButtonStyle.Secondary).setEmoji('👻'),
            new ButtonBuilder().setCustomId('unhide').setLabel('Unhide').setStyle(ButtonStyle.Secondary).setEmoji('👀')
        );
    
    // Row 2: Limit / Invite / Ban / Permit
    const row2 = new ActionRowBuilder()
        .addComponents(
            new ButtonBuilder().setCustomId('limit').setLabel('Limit').setStyle(ButtonStyle.Primary).setEmoji('📊'),
            new ButtonBuilder().setCustomId('invite').setLabel('Invite').setStyle(ButtonStyle.Success).setEmoji('📨'),
            new ButtonBuilder().setCustomId('ban').setLabel('Ban').setStyle(ButtonStyle.Danger).setEmoji('🚫'),
            new ButtonBuilder().setCustomId('permit').setLabel('Permit').setStyle(ButtonStyle.Success).setEmoji('✅')
        );
    
    // Row 3: Rename / Bitrate / Claim / Transfer
    const row3 = new ActionRowBuilder()
        .addComponents(
            new ButtonBuilder().setCustomId('rename').setLabel('Rename').setStyle(ButtonStyle.Secondary).setEmoji('✏️'),
            new ButtonBuilder().setCustomId('bitrate').setLabel('Bitrate').setStyle(ButtonStyle.Secondary).setEmoji('🎵'),
            new ButtonBuilder().setCustomId('claim').setLabel('Claim').setStyle(ButtonStyle.Success).setEmoji('👑'),
            new ButtonBuilder().setCustomId('transfer').setLabel('Transfer').setStyle(ButtonStyle.Primary).setEmoji('🔄')
        );
    
    await channel.send({ embeds: [embed], components: [row1, row2, row3] });
}

// ==================== HELPER FUNCTIONS ====================
async function getUsersVoiceChannel(interaction) {
    const member = interaction.member;
    const voiceChannel = member.voice.channel;
    
    if (!voiceChannel) {
        await interaction.reply({ 
            content: '❌ You need to be in a voice channel first!', 
            ephemeral: true 
        });
        return null;
    }
    
    const ownerData = activeChannels.get(member.user.id);
    if (!ownerData || ownerData.channelId !== voiceChannel.id) {
        await interaction.reply({ 
            content: '❌ You can only manage your own temporary voice channel!', 
            ephemeral: true 
        });
        return null;
    }
    
    return voiceChannel;
}

// ==================== BUTTON HANDLERS ====================
client.on('interactionCreate', async (interaction) => {
    if (!interaction.isButton()) return;
    
    const voiceChannel = await getUsersVoiceChannel(interaction);
    if (!voiceChannel) return;
    
    switch (interaction.customId) {
        case 'lock':
            await voiceChannel.permissionOverwrites.edit(voiceChannel.guild.id, { Connect: false });
            await interaction.reply({ content: '🔒 **Channel locked!**', ephemeral: true });
            break;
            
        case 'unlock':
            await voiceChannel.permissionOverwrites.edit(voiceChannel.guild.id, { Connect: true });
            await interaction.reply({ content: '🔓 **Channel unlocked!**', ephemeral: true });
            break;
            
        case 'hide':
            await voiceChannel.permissionOverwrites.edit(voiceChannel.guild.id, { ViewChannel: false });
            await interaction.reply({ content: '👻 **Channel hidden!**', ephemeral: true });
            break;
            
        case 'unhide':
            await voiceChannel.permissionOverwrites.edit(voiceChannel.guild.id, { ViewChannel: true });
            await interaction.reply({ content: '👀 **Channel unhidden!**', ephemeral: true });
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
                
                const ownerData = activeChannels.get(interaction.user.id);
                if (ownerData) {
                    ownerData.channelName = newName;
                    activeChannels.set(interaction.user.id, ownerData);
                }
                
                await interaction.followUp({ content: `✅ Renamed to **${newName}**`, ephemeral: true });
                await renameCollected.first().delete().catch(() => {});
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
                
                await interaction.followUp({ content: `✅ **${targetUser.username}** banned!`, ephemeral: true });
                await banCollected.first().delete().catch(() => {});
            } else {
                await interaction.followUp({ content: '⏰ Timeout!', ephemeral: true });
            }
            break;
            
        case 'permit':
            await interaction.reply({ 
                content: '✅ **Permit a user**\nMention the user to allow joining', 
                ephemeral: true 
            });
            
            const permitFilter = m => m.author.id === interaction.user.id && m.mentions.users.size > 0;
            const permitCollected = await interaction.channel.awaitMessages({ filter: permitFilter, max: 1, time: 30000, errors: ['time'] }).catch(() => null);
            
            if (permitCollected?.first()) {
                const targetUser = permitCollected.first().mentions.users.first();
                await voiceChannel.permissionOverwrites.edit(targetUser.id, { Connect: true });
                await interaction.followUp({ content: `✅ **${targetUser.username}** permitted!`, ephemeral: true });
                await permitCollected.first().delete().catch(() => {});
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
            
        case 'claim':
            const currentOwnerId = Array.from(activeChannels.entries()).find(([_, data]) => data.channelId === voiceChannel.id)?.[0];
            const currentOwner = voiceChannel.guild.members.cache.get(currentOwnerId);
            
            if (currentOwner && voiceChannel.members.has(currentOwnerId)) {
                await interaction.reply({ content: '❌ Owner is still in the channel!', ephemeral: true });
            } else {
                activeChannels.delete(currentOwnerId);
                activeChannels.set(interaction.user.id, {
                    channelId: voiceChannel.id,
                    channelName: voiceChannel.name,
                    createdAt: Date.now()
                });
                
                await voiceChannel.permissionOverwrites.edit(currentOwnerId, { Connect: false });
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
                content: '🔄 **Transfer ownership**\nMention the user to transfer to', 
                ephemeral: true 
            });
            
            const transferFilter = m => m.author.id === interaction.user.id && m.mentions.users.size > 0;
            const transferCollected = await interaction.channel.awaitMessages({ filter: transferFilter, max: 1, time: 30000, errors: ['time'] }).catch(() => null);
            
            if (transferCollected?.first()) {
                const newOwner = transferCollected.first().mentions.users.first();
                const newOwnerMember = voiceChannel.guild.members.cache.get(newOwner.id);
                
                if (!newOwnerMember) {
                    await interaction.followUp({ content: '❌ User not found!', ephemeral: true });
                } else {
                    const oldOwnerId = interaction.user.id;
                    activeChannels.delete(oldOwnerId);
                    activeChannels.set(newOwner.id, {
                        channelId: voiceChannel.id,
                        channelName: voiceChannel.name,
                        createdAt: Date.now()
                    });
                    
                    await voiceChannel.permissionOverwrites.edit(oldOwnerId, { Connect: true, ManageChannels: false });
                    await voiceChannel.permissionOverwrites.edit(newOwner.id, {
                        Connect: true,
                        ManageChannels: true,
                        MuteMembers: true,
                        DeafenMembers: true,
                        MoveMembers: true
                    });
                    
                    await interaction.followUp({ content: `✅ Transferred to **${newOwner.username}**`, ephemeral: true });
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