// 背景腳本：替頁面去 Discord CDN 讀附件內容（擴充功能有 host 權限，不受跨網域限制）。
// 檔案只讀進記憶體再轉成文字傳回去，不會寫進硬碟。

const ALLOWED_HOSTS = new Set(["cdn.discordapp.com", "media.discordapp.net"]);

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (!msg || msg.type !== "fetch-text") return;
  fetchText(msg.url).then(
    (text) => sendResponse({ ok: true, text }),
    (err) => sendResponse({ ok: false, error: String((err && err.message) || err) })
  );
  return true; // 非同步回覆
});

async function fetchText(url) {
  const u = new URL(url);
  if (u.protocol !== "https:" || !ALLOWED_HOSTS.has(u.hostname)) {
    throw new Error("不是 Discord 附件網址");
  }
  // no-store：不讓瀏覽器把檔案存進磁碟快取
  const res = await fetch(u.href, { cache: "no-store", credentials: "omit" });
  if (!res.ok) throw new Error("讀取失敗（HTTP " + res.status + "）");
  return decode(new Uint8Array(await res.arrayBuffer()));
}

// 先看 BOM，再試 UTF-8，都不是就當成 GBK/GB18030（中文 Windows 記事本的舊預設）。
function decode(bytes) {
  if (bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) {
    return new TextDecoder("utf-8").decode(bytes.subarray(3));
  }
  if (bytes[0] === 0xff && bytes[1] === 0xfe) {
    return new TextDecoder("utf-16le").decode(bytes.subarray(2));
  }
  if (bytes[0] === 0xfe && bytes[1] === 0xff) {
    return new TextDecoder("utf-16be").decode(bytes.subarray(2));
  }
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch (_) {
    return new TextDecoder("gb18030").decode(bytes);
  }
}
