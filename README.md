# Discoraser

> [!WARNING]
> Automating actions on user accounts ("self-botting") violates [Discord's Terms of Service](https://support.discord.com/hc/en-us/articles/115002192352-Automated-user-accounts-self-bots-) and could result in your account being limited or terminated. This tool simulates human-like behavior to reduce that risk, but there are no guarantees. Use at your own risk.

A userscript that deletes your Discord messages by scrolling through channels and DMs. Navigate to a conversation, click Start, and it handles the rest.

## What it does

- Scrolls up through a channel/DM and deletes your messages
- Removes your reactions from other people's messages (toggleable)
- Lets you keep messages newer than X days
- Auto-detects your user ID from Discord's internals

## Why it's slow

The script intentionally operates at human speed: 3-8 second delays between deletions, with longer breaks every 5 messages. This is by design:

- Discord rate-limits aggressive API usage and can flag/ban accounts for bot-like behavior
- Randomized delays make the pattern less detectable
- It's meant to run in the background (overnight, over a few days) while you do other things

If you need instant bulk deletion, this isn't the tool for that. This is for when you want to be thorough (it scrolls through every message rather than relying on Discord's search API, so nothing gets missed) and want to minimize the risk of detection.

## Install

1. Install a userscript manager ([Violentmonkey](https://violentmonkey.github.io/), Tampermonkey, etc.)
2. Create a new script and paste the contents of `discord-message-cleaner.user.js`
3. Open Discord in your browser (not the desktop app)

## Usage

1. Navigate to the DM or channel you want to clean
2. The panel appears at the top-left (drag it anywhere)
3. Set how many days of messages to keep (default: 7)
4. Click **Start**
5. Click **Stop** whenever you want to pause

The script processes the current channel only. Move to another DM/channel and start again to clean that one.

## About

This was fully implemented by an LLM. I read through the code and tested it myself. I just didn't have the time or desire to figure out Discord's obfuscated DOM structure and write all of this from scratch.

[Undiscord](https://github.com/victornpb/undiscord) is a great project and its author did an awesome job keeping it alive solo for years. Discord is a massive company pushing changes constantly, and chasing that as a single unpaid developer is genuinely hard. It just wasn't working reliably for me at the time, so I built this as a personal workaround.
