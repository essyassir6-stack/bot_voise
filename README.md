# 🎮 Temp Voice + Text Channel Bot for Railway

## 🚀 What This Bot Does

1. User joins a specific **lobby voice channel**
2. Bot automatically creates:
   - A **private voice channel** (named "User's VC")
   - A **linked text channel** (named "user-control")
3. Control panel with buttons appears in the text channel
4. When user leaves and VC is empty → both channels are deleted

## 📦 Deploy to Railway

[![Deploy on Railway](https://railway.app/button.svg)](https://railway.app/new)

## 🔧 Environment Variables (REQUIRED)

| Variable | Description | Example |
|----------|-------------|---------|
| `DISCORD_TOKEN` | Your bot token | `MTIzNDU2Nzg5MDEyMzQ1Njc4OQ.Gxxxx` |
| `LOBBY_CHANNEL_ID` | Voice channel ID to trigger creation | `123456789012345678` |
| `BANNER_IMAGE_URL` | (Optional) Custom banner for embed | `https://...` |

## 📝 How to Get IDs

1. Discord Settings → Advanced → **Enable Developer Mode**
2. Right-click your lobby voice channel → **Copy ID**
3. Paste as `LOBBY_CHANNEL_ID`

## 🤖 Bot Permissions Needed

Invite your bot with these permissions:
- **Administrator** (easiest)
- Or at minimum: Create Channels, Manage Channels, Move Members, Mute Members, Connect, Speak, View Channels

## ✅ Working Features

| Button | Function |
|--------|----------|
| 🔒 Lock | Prevent new joins |
| 🔓 Unlock | Allow joins |
| 👻 Hide | Make channel invisible |
| 👀 Unhide | Make channel visible |
| 📊 Limit | Set user limit (0-99) |
| ✏️ Rename | Change channel name |
| 🎵 Bitrate | Change audio quality |
| 📨 Invite | Allow specific user |
| 🚫 Ban | Kick + block user |
| ✅ Permit | Allow user (if locked) |
| 👑 Claim | Take ownership |
| 🔄 Transfer | Give ownership |

## 🧪 Testing

1. Join the lobby voice channel
2. Check new VC + text channel appear
3. Go to text channel → click buttons
4. Leave VC → channels auto-delete

## 📊 Check Logs in Railway
