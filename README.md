# 🎮 Temp VC with Locked Control Panel

## 🚀 Features

- Join lobby VC → Auto-create private VC
- Auto-create **LOCKED text channel** (nobody can type)
- Full control panel with buttons
- **User selection menus** for actions:
  - Kick users from your VC
  - Move users to lobby
  - Ban users from your VC
  - Permit users to join
- Clean interface: no typing, only buttons + menus

## 📦 Deploy to Railway

[![Deploy on Railway](https://railway.app/button.svg)](https://railway.app/new)

## 🔧 Environment Variables

| Variable | Description |
|----------|-------------|
| `DISCORD_TOKEN` | Your bot token |
| `LOBBY_CHANNEL_ID` | Voice channel ID to trigger creation |
| `BANNER_IMAGE_URL` | (Optional) Custom banner |

## 🎯 Button Functions

| Button | Action |
|--------|--------|
| 🔒 Lock | Prevent new joins |
| 🔓 Unlock | Allow joins |
| 👻 Hide | Make channel invisible |
| 👀 Unhide | Make visible |
| 📊 Limit | Set user limit |
| ✏️ Rename | Change channel name |
| 🎵 Bitrate | Change audio quality |
| 👢 Kick | Select user → Kick from VC |
| 🔄 Move | Select user → Move to lobby |
| 🚫 Ban | Select user → Ban from VC |
| ✅ Permit | Select user → Allow join |
| 📨 Invite | Mention user to invite |
| 👑 Claim | Take ownership |
| 🔄 Transfer | Give ownership |

## ✅ How It Works

1. User joins lobby VC
2. Bot creates private VC + locked text channel
3. Control panel appears in locked channel
4. Owner clicks buttons → selects users from menu
5. Actions applied instantly
6. When VC empty → both channels auto-delete

## 🧪 Testing

1. Join lobby VC
2. Check your new VC + locked text channel
3. Try clicking buttons (they show user menus)
4. Invite friends to test Kick/Ban/Move
5. Leave VC → channels auto-delete
# 🎮 Complete Discord Bot: Temp VC + Control Panel + Music

## 🚀 Features

### Voice System
- Join lobby VC → Auto-create private VC
- Auto-create **LOCKED text channel** (nobody can type)
- Full control panel with buttons
- User selection menus for Kick/Move/Ban/Permit

### Music System
- Slash command: `/ms <youtube link>`
- Bot auto-joins your voice channel
- Plays YouTube videos
- Shows "Now Playing" in your control panel

## 📦 Environment Variables

| Variable | Description | Example |
|----------|-------------|---------|
| `DISCORD_TOKEN` | Your bot token | `MTIz...` |
| `CLIENT_ID` | Bot application ID | `123456789012345678` |
| `GUILD_ID` | Your server ID | `123456789012345678` |
| `LOBBY_CHANNEL_ID` | Voice channel ID | `123456789012345678` |
| `BANNER_IMAGE_URL` | (Optional) Custom banner | `https://...` |

## 🔧 How to Get IDs

1. **CLIENT_ID**: Discord Developer Portal → Your application → General Information
2. **GUILD_ID**: Right-click your server → Copy ID
3. **LOBBY_CHANNEL_ID**: Right-click voice channel → Copy ID

## 🚀 Deploy to Railway

[![Deploy on Railway](https://railway.app/button.svg)](https://railway.app/new)

## 🎵 Music Commands
