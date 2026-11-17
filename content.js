// 頁面腳本：找出聊天裡的文字附件連結，在旁邊加「複製」按鈕。
// Discord 的 class 名稱會變，所以只靠附件網址判斷，不依賴 class。

(() => {
  const HOSTS = new Set(["cdn.discordapp.com", "media.discordapp.net"]);
  const TEXT_EXT = /\.(txt|md|log|json|csv)$/i;
  const LABEL = "複製";

  // href -> Promise<string>；只暫存在這個分頁的記憶體裡，用完或 30 秒後丟掉
  const textCache = new Map();

  function attachmentPath(a) {
    try {
      const u = new URL(a.href);
      if (!HOSTS.has(u.hostname) || !u.pathname.startsWith("/attachments/")) return null;
      return TEXT_EXT.test(decodeURIComponent(u.pathname)) ? u.pathname : null;
    } catch (_) {
      return null;
    }
  }

  function getText(href) {
    if (!textCache.has(href)) {
      const p = new Promise((resolve, reject) => {
        chrome.runtime.sendMessage({ type: "fetch-text", url: href }, (r) => {
          if (chrome.runtime.lastError) return reject(new Error(chrome.runtime.lastError.message));
          if (r && r.ok) resolve(r.text);
          else reject(new Error((r && r.error) || "未知錯誤"));
        });
      });
      textCache.set(href, p);
      p.catch(() => textCache.delete(href));
      setTimeout(() => textCache.delete(href), 30000);
    }
    return textCache.get(href);
  }

  function execCommandCopy(text) {
    const ta = document.createElement("textarea");
    ta.value = text;
    ta.style.cssText = "position:fixed;top:-9999px;opacity:0";
    document.body.appendChild(ta);
    ta.select();
    const ok = document.execCommand("copy");
    ta.remove();
    if (!ok) throw new Error("瀏覽器拒絕寫入剪貼簿");
  }

  async function copyFrom(href) {
    const textP = getText(href);
    try {
      // 在點擊當下就把「之後才會拿到的文字」交給剪貼簿，避免讀檔太久而失去點擊授權
      const item = new ClipboardItem({
        "text/plain": textP.then((t) => new Blob([t], { type: "text/plain" })),
      });
      await navigator.clipboard.write([item]);
    } catch (_) {
      const t = await textP; // 讀檔本身失敗的話會在這裡丟出真正的錯誤
      try {
        await navigator.clipboard.writeText(t);
      } catch (_) {
        execCommandCopy(t);
      }
    }
    const text = await textP;
    textCache.delete(href);
    return text.length;
  }

  function makeButton(a, path) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "dtc-btn";
    btn.dataset.dtcPath = path;
    btn.textContent = LABEL;
    btn.title = "把這個檔案的內容複製到剪貼簿（不下載）";

    // 滑鼠移上去就先讀，點下去時通常已經讀好了
    btn.addEventListener("pointerenter", () => getText(a.href).catch(() => {}));

    let timer = 0;
    btn.addEventListener("click", async (e) => {
      e.preventDefault();
      e.stopPropagation();
      if (btn.disabled) return;
      clearTimeout(timer);
      btn.disabled = true;
      btn.className = "dtc-btn";
      btn.textContent = "讀取中…";
      try {
        const n = await copyFrom(a.href);
        btn.classList.add("dtc-ok");
        btn.textContent = "已複製 " + n + " 字";
      } catch (err) {
        btn.classList.add("dtc-err");
        btn.textContent = "複製失敗";
        btn.title = String((err && err.message) || err);
        console.warn("[Discord TXT 一鍵複製]", err);
      } finally {
        btn.disabled = false;
        timer = setTimeout(() => {
          btn.className = "dtc-btn";
          btn.textContent = LABEL;
          btn.title = "把這個檔案的內容複製到剪貼簿（不下載）";
        }, 2500);
      }
    });
    return btn;
  }

  function scan() {
    // 同一則訊息裡同一個檔案可能有好幾個連結（檔名、下載圖示），只加一顆按鈕
    const groups = new Map();
    for (const a of document.querySelectorAll('a[href*="/attachments/"]')) {
      const path = attachmentPath(a);
      if (!path) continue;
      const box =
        a.closest('[id^="message-accessories-"]') ||
        a.closest('li[id^="chat-messages-"]') ||
        a.parentElement;
      if (!box) continue;
      if (box.querySelector('.dtc-btn[data-dtc-path="' + CSS.escape(path) + '"]')) continue;
      let byPath = groups.get(box);
      if (!byPath) groups.set(box, (byPath = new Map()));
      const prev = byPath.get(path);
      // 優先放在有檔名文字的那個連結旁邊
      if (!prev || (!prev.textContent.trim() && a.textContent.trim())) byPath.set(path, a);
    }
    for (const byPath of groups.values()) {
      for (const [path, a] of byPath) a.insertAdjacentElement("afterend", makeButton(a, path));
    }
  }

  let pending = false;
  new MutationObserver(() => {
    if (pending) return;
    pending = true;
    setTimeout(() => {
      pending = false;
      scan();
    }, 300);
  }).observe(document.body, { childList: true, subtree: true });

  scan();
})();
