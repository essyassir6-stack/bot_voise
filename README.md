# 🎮 Temporary Voice Channel Bot for Railway

## 🚀 Deploy to Railway

### Step 1: Click Deploy
[![Deploy on Railway](https://railway.app/button.svg)](https://railway.app/new)

### Step 2: Add Environment Variables

| Variable | Description | Example |
|----------|-------------|---------|
| `DISCORD_TOKEN` | Your bot token | `MTIzNDU2Nzg5MDEyMzQ1Njc4OQ.Gxxxx` |
| `LOBBY_CHANNEL_ID` | Voice channel users join | `123456789012345678` |
| `CONTROL_PANEL_CHANNEL_ID` | Text channel for panel | `123456789012345678` |
| `BANNER_IMAGE_URL` | (Optional) Custom banner | `https://...` |

### Step 3: Get Your IDs
1. Enable Developer Mode in Discord Settings
2. Right-click channels → Copy ID

### Step 4: Invite Bot
- Bot needs `Administrator` permission
- Use OAuth2 URL Generator

## ✅ Features
- Auto-create voice channel when joining lobby
- Auto-delete when user leaves
- Control panel with 12 working buttons
- Lock, unlock, hide, unhide
- User limit, rename, bitrate
- Invite, ban, permit users
- Claim & transfer ownership

## 🔧 Local Testing
```bash
npm install
echo "DISCORD_TOKEN=xxx" > .env
node index.js