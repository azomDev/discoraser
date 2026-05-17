// ==UserScript==
// @name         Discoraser
// @namespace    discoraser
// @version      1.0.0
// @description  Userscript that deletes your Discord messages by scrolling through channels/DMs. Slow, thorough, and less likely to get caught (hopefully).
// @match        https://discord.com/*
// @match        https://ptb.discord.com/*
// @match        https://canary.discord.com/*
// @grant        none
// @run-at       document-idle
// ==/UserScript==

(function () {
  "use strict";

  // ============ CONFIG ============
  const CONFIG = {
    keepDays: 7,
    minDelay: 3000,
    maxDelay: 8000,
    breakEvery: 5,
    breakMin: 15000,
    breakMax: 45000,
    scrollAmount: 300,
  };

  // ============ STATE ============
  let running = false;
  let deleted = 0;
  let skipped = 0;
  let reactionsRemoved = 0;
  let abortController = null;
  const logs = [];

  // ============ HELPERS ============

  function sleep(ms) {
    return new Promise((resolve, reject) => {
      const id = setTimeout(resolve, ms);
      abortController?.signal.addEventListener(
        "abort",
        () => {
          clearTimeout(id);
          reject(new Error("Aborted"));
        },
        { once: true },
      );
    });
  }

  function rand(min, max) {
    return Math.floor(Math.random() * (max - min + 1)) + min;
  }

  function log(msg) {
    const line = `[${new Date().toLocaleTimeString()}] ${msg}`;
    logs.push(line);
    if (logs.length > 200) logs.shift();
    console.log("[Cleaner]", msg);
    const el = document.getElementById("dc-cleaner-log");
    if (el) {
      el.textContent = logs.slice(-50).join("\n");
      el.scrollTop = el.scrollHeight;
    }
    const st = document.getElementById("dc-cleaner-status");
    if (st) st.textContent = msg;
  }

  function waitFor(fn, timeout = 10000) {
    return new Promise((resolve, reject) => {
      const start = Date.now();
      const check = () => {
        const result = fn();
        if (result) return resolve(result);
        if (Date.now() - start > timeout)
          return reject(new Error(`Timeout: ${fn.toString().slice(0, 80)}`));
        requestAnimationFrame(check);
      };
      check();
    });
  }

  function mouseOpts(el) {
    const r = el.getBoundingClientRect();
    return {
      bubbles: true,
      cancelable: true,
      view: window,
      clientX: r.left + r.width / 2,
      clientY: r.top + r.height / 2,
    };
  }

  function click(el) {
    if (!el) return;
    const o = mouseOpts(el);
    el.dispatchEvent(new MouseEvent("mouseenter", o));
    el.dispatchEvent(new MouseEvent("mouseover", o));
    el.dispatchEvent(new MouseEvent("mousedown", o));
    el.dispatchEvent(new MouseEvent("mouseup", o));
    el.dispatchEvent(new MouseEvent("click", o));
  }

  function hover(el) {
    if (!el) return;
    const o = mouseOpts(el);
    el.dispatchEvent(new MouseEvent("mouseenter", o));
    el.dispatchEvent(new MouseEvent("mouseover", o));
    el.dispatchEvent(new MouseEvent("mousemove", o));
  }

  // ============ DISCORD HELPERS ============

  function detectUserId() {
    try {
      const chunks = window.webpackChunkdiscord_app;
      if (!chunks) return null;
      const req = chunks.push([[Symbol()], {}, (r) => r]);
      chunks.pop();
      const stores = Object.values(req.c).filter(
        (m) => m?.exports?.default?.getToken || m?.exports?.getToken,
      );
      const token = stores
        .map((m) => (m.exports.default || m.exports).getToken?.())
        .find((t) => typeof t === "string");
      if (!token) return null;
      const part = token.split(".")[0];
      const padded = part + "==".slice(part.length % 4 || 4);
      return atob(padded);
    } catch {
      return null;
    }
  }

  function getScroller() {
    return document.querySelector('[class*="scroller__"][class*="auto_"]');
  }

  function getMessageElements() {
    return [...document.querySelectorAll('[id^="chat-messages-"]')];
  }

  function getMessageId(el) {
    return el.id.split("-").pop();
  }

  // Discord snowflake → timestamp (ms since epoch)
  function snowflakeToTimestamp(id) {
    return Number(BigInt(id) >> 22n) + 1420070400000;
  }

  function isOlderThanKeepDays(msgId) {
    const cutoff = Date.now() - CONFIG.keepDays * 24 * 60 * 60 * 1000;
    return snowflakeToTimestamp(msgId) < cutoff;
  }

  // Determine if a message belongs to the target user.
  // Group-start messages have an avatar with the user ID in the URL.
  // Continuation messages inherit from the previous group-start.
  function isOwnMessage(msgEl, userId) {
    const avatar = msgEl.querySelector(`img[src*="avatars/${userId}"]`);
    if (avatar) return true;

    // Continuation message (no avatar) — walk back to group start
    if (!msgEl.querySelector('img[src*="avatars/"]')) {
      let prev = msgEl.previousElementSibling;
      while (prev && prev.id?.startsWith("chat-messages-")) {
        const prevAvatar = prev.querySelector('img[src*="avatars/"]');
        if (prevAvatar) {
          return prevAvatar.src.includes(`avatars/${userId}`);
        }
        prev = prev.previousElementSibling;
      }
    }

    return false;
  }

  // Find all our reactions (the inner button that toggles on click)
  function getMyReactions() {
    return [
      ...document.querySelectorAll(
        '[class*="reactionMe_"] [class*="reactionInner_"]',
      ),
    ];
  }

  // ============ DELETE ============

  function closeOpenMenu() {
    document.dispatchEvent(
      new KeyboardEvent("keydown", {
        key: "Escape",
        code: "Escape",
        keyCode: 27,
        bubbles: true,
        cancelable: true,
      }),
    );
  }

  async function deleteMessage(messageEl) {
    const innerMsg =
      messageEl.querySelector('[class*="message_"]') || messageEl;

    hover(innerMsg);
    await sleep(rand(500, 1000));

    const moreBtn = await waitFor(
      () =>
        messageEl.querySelector('[aria-label="More"]') ||
        innerMsg.querySelector('[aria-label="More"]'),
      4000,
    ).catch(() => null);

    if (!moreBtn) {
      log("  More button not found, skipping");
      skipped++;
      return false;
    }

    click(moreBtn);
    await sleep(rand(400, 800));

    const deleteItem = await waitFor(
      () =>
        [...document.querySelectorAll('[role="menuitem"]')].find((el) =>
          el.textContent?.includes("Delete Message"),
        ),
      5000,
    ).catch(() => null);

    if (!deleteItem) {
      closeOpenMenu();
      await sleep(rand(300, 600));
      log("  Delete option not in menu, skipping");
      skipped++;
      return false;
    }

    click(deleteItem);
    await sleep(rand(500, 1000));

    const confirmBtn = await waitFor(() => {
      const dialog = document.querySelector('[role="dialog"]');
      if (!dialog) return null;
      return [...dialog.querySelectorAll("button")].find(
        (btn) => btn.textContent?.trim() === "Delete",
      );
    }, 5000);

    click(confirmBtn);
    await sleep(rand(500, 1000));

    deleted++;
    log(`Deleted ${deleted} messages`);
    return true;
  }

  // ============ MAIN LOOP ============

  async function run() {
    const userId = detectUserId();
    if (!userId) {
      log("Could not detect user ID. Cannot proceed.");
      running = false;
      updateUI();
      return;
    }
    CONFIG.keepDays = parseInt(document.getElementById("dc-days").value) || 7;
    log(`Detected user ID: ${userId}`);
    log(`Will delete messages older than ${CONFIG.keepDays} days`);

    running = true;
    deleted = 0;
    skipped = 0;
    reactionsRemoved = 0;
    abortController = new AbortController();
    updateUI();

    try {
      const scroller = getScroller();
      if (!scroller) {
        log("Could not find chat scroller. Are you in a channel/DM?");
        running = false;
        updateUI();
        return;
      }

      log("Starting deletion — scrolling through channel...");
      const deletedIds = new Set();
      let noNewContentCount = 0;
      const removeReactions = document.getElementById("dc-reactions").checked;

      while (running) {
        const allMessages = getMessageElements();
        const myMessages = allMessages.filter((el) => isOwnMessage(el, userId));

        const toDelete = myMessages.filter((el) => {
          const msgId = getMessageId(el);
          return !deletedIds.has(msgId) && isOlderThanKeepDays(msgId);
        });

        if (toDelete.length > 0) {
          log(`Found ${toDelete.length} of my messages on screen`);
          noNewContentCount = 0;

          for (let i = toDelete.length - 1; i >= 0 && running; i--) {
            const msgEl = toDelete[i];
            const msgId = getMessageId(msgEl);
            if (!document.contains(msgEl)) continue;

            const success = await deleteMessage(msgEl);
            deletedIds.add(msgId);

            if (success) {
              if (deleted % CONFIG.breakEvery === 0) {
                const ms = rand(CONFIG.breakMin, CONFIG.breakMax);
                log(`Break: ${(ms / 1000).toFixed(0)}s`);
                await sleep(ms);
              } else {
                const ms = rand(CONFIG.minDelay, CONFIG.maxDelay);
                log(`Waiting ${(ms / 1000).toFixed(1)}s...`);
                await sleep(ms);
              }
            }
          }
        } else if (removeReactions && getMyReactions().length > 0) {
          const myReactions = getMyReactions();
          log(`Removing ${myReactions.length} reactions on screen...`);
          noNewContentCount = 0;

          for (const reactionEl of myReactions) {
            if (!running) break;
            if (!document.contains(reactionEl)) continue;
            click(reactionEl);
            reactionsRemoved++;
            await sleep(rand(800, 1500));
          }
        } else {
          // Nothing to do on screen so scroll up to load older messages
          const prevScrollTop = scroller.scrollTop;
          const prevScrollHeight = scroller.scrollHeight;
          scroller.scrollTop -= CONFIG.scrollAmount;
          await sleep(rand(1500, 2500));

          const scrollMoved = Math.abs(scroller.scrollTop - prevScrollTop) > 5;
          const heightGrew = scroller.scrollHeight > prevScrollHeight;

          if (!scrollMoved && !heightGrew) {
            noNewContentCount++;
            if (noNewContentCount >= 3) {
              log("Reached the top of the channel. No more messages to load.");
              break;
            }
            scroller.scrollTop -= CONFIG.scrollAmount;
            await sleep(rand(2000, 3000));
          } else {
            noNewContentCount = 0;
            log("Scrolled up, loading older messages...");
          }
        }
      }

      log(
        `Done! Deleted ${deleted} messages, removed ${reactionsRemoved} reactions (${skipped} skipped).`,
      );
    } catch (err) {
      if (err.message !== "Aborted") log(`Fatal: ${err.message}`);
      else log(`Stopped. Deleted ${deleted}.`);
    } finally {
      running = false;
      updateUI();
    }
  }

  function stop() {
    running = false;
    abortController?.abort();
    log(`Stopped. Deleted ${deleted}.`);
    updateUI();
  }

  // ============ UI ============

  function updateUI() {
    const startBtn = document.getElementById("dc-start");
    const stopBtn = document.getElementById("dc-stop");
    if (startBtn) startBtn.disabled = running;
    if (stopBtn) stopBtn.disabled = !running;
  }

  function createUI() {
    const panel = document.createElement("div");
    panel.id = "dc-panel";
    panel.innerHTML = `
      <style>
        #dc-panel {
          position: fixed; top: 20px; left: 20px;
          background: #1e1f22; border: 1px solid #3f4147; border-radius: 8px;
          padding: 12px 14px; color: #dbdee1; z-index: 999999;
          font-family: 'gg sans', sans-serif; font-size: 13px;
          min-width: 260px; box-shadow: 0 4px 16px rgba(0,0,0,0.4);
        }
        #dc-panel h3 {
          margin: 0 0 8px; font-size: 14px; color: #fff;
          cursor: grab; user-select: none;
        }
        #dc-panel h3:active { cursor: grabbing; }
        #dc-panel .info {
          font-size: 11px; color: #949ba4; margin-bottom: 8px; line-height: 1.4;
        }
        #dc-cleaner-status {
          font-size: 12px; color: #b5bac1; margin: 4px 0;
          word-break: break-word; min-height: 16px;
        }
        #dc-cleaner-log {
          max-height: 130px; overflow-y: auto; margin: 6px 0;
          padding: 4px 6px; background: #111214; border-radius: 4px;
          font-size: 11px; font-family: monospace; color: #949ba4;
          white-space: pre-wrap; user-select: text; cursor: text;
        }
        #dc-panel .row { display: flex; gap: 6px; margin-top: 6px; }
        #dc-panel button {
          flex: 1; padding: 6px 0; border: none; border-radius: 4px;
          cursor: pointer; font-size: 12px; font-weight: 600;
        }
        #dc-start { background: #248046; color: #fff; }
        #dc-start:disabled { background: #1a5c33; opacity: 0.6; cursor: default; }
        #dc-stop  { background: #da373c; color: #fff; }
        #dc-stop:disabled  { background: #8c1f22; opacity: 0.6; cursor: default; }
        #dc-collapse {
          float: right; background: none; border: none;
          color: #949ba4; font-size: 16px; cursor: pointer; padding: 0;
        }
      </style>
      <button id="dc-collapse">&minus;</button>
      <h3>&#129529; Message Cleaner</h3>
      <div id="dc-body">
        <div class="info">
          Navigate to a DM or channel, then click Start.<br>
          The script will scroll up and delete your messages.
        </div>
        <label style="font-size:11px;color:#949ba4;display:block;margin:6px 0 2px;">Keep messages newer than (days)</label>
        <input type="number" id="dc-days" value="7" min="0" style="width:100%;box-sizing:border-box;background:#2b2d31;border:1px solid #3f4147;border-radius:4px;color:#dbdee1;padding:4px 8px;font-size:12px;" />
        <label style="font-size:11px;color:#949ba4;display:flex;align-items:center;gap:6px;margin:8px 0 2px;cursor:pointer;">
          <input type="checkbox" id="dc-reactions" checked style="margin:0;" />
          Also remove my reactions
        </label>
        <div id="dc-cleaner-status" style="margin-top:8px;">Idle</div>
        <div id="dc-cleaner-log"></div>
        <div class="row">
          <button id="dc-start">Start</button>
          <button id="dc-stop" disabled>Stop</button>
        </div>
      </div>
    `;
    document.body.appendChild(panel);

    document.getElementById("dc-start").addEventListener("click", run);
    document.getElementById("dc-stop").addEventListener("click", stop);

    let collapsed = false;
    document.getElementById("dc-collapse").addEventListener("click", () => {
      collapsed = !collapsed;
      document.getElementById("dc-body").style.display = collapsed
        ? "none"
        : "block";
      document.getElementById("dc-collapse").textContent = collapsed
        ? "+"
        : "\u2212";
    });

    // Drag to reposition
    const handle = panel.querySelector("h3");
    let dragging = false,
      dragX = 0,
      dragY = 0;
    handle.addEventListener("mousedown", (e) => {
      if (e.target.id === "dc-collapse") return;
      dragging = true;
      dragX = e.clientX - panel.offsetLeft;
      dragY = e.clientY - panel.offsetTop;
    });
    document.addEventListener("mousemove", (e) => {
      if (!dragging) return;
      panel.style.left = e.clientX - dragX + "px";
      panel.style.top = e.clientY - dragY + "px";
      panel.style.right = "auto";
      panel.style.bottom = "auto";
    });
    document.addEventListener("mouseup", () => {
      dragging = false;
    });
  }

  function init() {
    const check = () => {
      if (
        document.querySelector('[data-list-id="chat-messages"]') ||
        document.querySelector('[class*="chat_"]')
      ) {
        createUI();
      } else {
        setTimeout(check, 1000);
      }
    };
    check();
  }

  init();
})();
