// ===== State =====
const STORAGE_PROXY = 'proxy_origin';
const STORAGE_BOOKMARKS = 'proxy_bookmarks';
const STORAGE_HISTORY = 'proxy_history';

let proxyOrigin = localStorage.getItem(STORAGE_PROXY) || '';
let history = JSON.parse(localStorage.getItem(STORAGE_HISTORY) || '[]');
let historyIndex = parseInt(localStorage.getItem('proxy_history_index') || '-1');
let currentUrl = '';

// ===== Elements =====
const urlInput = document.getElementById('url-input');
const goBtn = document.getElementById('go-btn');
const backBtn = document.getElementById('back-btn');
const forwardBtn = document.getElementById('forward-btn');
const reloadBtn = document.getElementById('reload-btn');
const configBtn = document.getElementById('config-btn');
const configPanel = document.getElementById('config-panel');
const proxyInput = document.getElementById('proxy-input');
const saveProxyBtn = document.getElementById('save-proxy-btn');
const proxyStatus = document.getElementById('proxy-status');
const frame = document.getElementById('proxy-frame');
const errorOverlay = document.getElementById('error-overlay');
const errorMsg = document.getElementById('error-msg');
const errorConfigBtn = document.getElementById('error-config-btn');
const bookmarksList = document.getElementById('bookmarks-list');
const addBookmarkBtn = document.getElementById('add-bookmark-btn');

// ===== Proxy helpers =====
function buildProxyUrl(targetUrl) {
  if (!proxyOrigin) return null;
  const base = proxyOrigin.replace(/\/$/, '');
  return `${base}/proxy?url=${encodeURIComponent(targetUrl)}`;
}

// 探测当前 Codespace 的 3000 端口转发地址。
// Codespaces 会把 Codespace 名注入到 window.csgo / 环境变量，
// 拼出的域名形如 <name>-3000.app.github.dev
async function autoDetectProxy() {
  const candidates = [];

  // 1) 同源推断：若本页面正好由 xxx-3000.app.github.dev 提供，直接用它
  if (/\-\d+\.app\.github\.dev$/.test(location.hostname)) {
    candidates.push(location.origin);
  }

  // 2) Codespaces 注入的全局变量
  try {
    const cs = window.csgo || window.Codespaces || null;
    const name = cs?.codespaceName || cs?.name;
    if (name) candidates.push(`https://${name}-3000.app.github.dev`);
  } catch {}

  // 3) 端口转发地址通常出现在 DOM 的链接里
  try {
    document.querySelectorAll('a[href*="app.github.dev"]').forEach((a) => {
      try {
        const u = new URL(a.href);
        if (/-3000\./.test(u.hostname)) candidates.push(u.origin);
      } catch {}
    });
  } catch {}

  for (const c of [...new Set(candidates)]) {
    try {
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), 3000);
      const r = await fetch(`${c}/health`, { signal: ctrl.signal });
      clearTimeout(timer);
      if (r.ok) {
        const j = await r.json();
        if (j && j.status === 'ok') return c;
      }
    } catch {}
  }
  return null;
}

function showProxyConfig() {
  configPanel.classList.remove('hidden');
  proxyInput.value = proxyOrigin;
  proxyInput.placeholder = '留空则自动探测';
  proxyInput.focus();
}

function hideProxyConfig() {
  configPanel.classList.add('hidden');
}

async function saveProxy() {
  const val = proxyInput.value.trim().replace(/\/$/, '');

  // 留空 = 自动探测
  if (!val) {
    proxyStatus.textContent = '正在探测…';
    const found = await autoDetectProxy();
    if (found) {
      proxyOrigin = found;
      localStorage.setItem(STORAGE_PROXY, found);
      proxyStatus.textContent = `已自动探测到：${found}`;
      setTimeout(hideProxyConfig, 900);
      if (urlInput.value.trim()) navigate(urlInput.value.trim());
      return;
    }
    proxyStatus.textContent = '自动探测失败，请手动填写地址';
    return;
  }

  try {
    new URL(val);
  } catch {
    alert('地址格式无效，请输入完整的 URL（如 https://xxx-3000.app.github.dev）');
    return;
  }
  proxyOrigin = val;
  localStorage.setItem(STORAGE_PROXY, val);
  hideProxyConfig();
  if (urlInput.value.trim()) navigate(urlInput.value.trim());
}

// ===== Navigation =====
function navigate(targetUrl, pushHistory = true) {
  if (!targetUrl) return;

  // Auto-add https://
  if (!/^https?:\/\//.test(targetUrl)) {
    targetUrl = 'https://' + targetUrl;
  }

  if (!proxyOrigin) {
    showProxyConfig();
    return;
  }

  const proxyUrl = buildProxyUrl(targetUrl);
  if (!proxyUrl) return;

  currentUrl = targetUrl;
  urlInput.value = targetUrl;

  if (pushHistory) {
    history = history.slice(0, historyIndex + 1);
    history.push(targetUrl);
    historyIndex = history.length - 1;
    localStorage.setItem(STORAGE_HISTORY, JSON.stringify(history));
    localStorage.setItem('proxy_history_index', String(historyIndex));
  }

  updateNavButtons();
  frame.src = proxyUrl;
}

function goBack() {
  if (historyIndex <= 0) return;
  historyIndex--;
  localStorage.setItem('proxy_history_index', String(historyIndex));
  navigate(history[historyIndex], false);
  updateNavButtons();
}

function goForward() {
  if (historyIndex >= history.length - 1) return;
  historyIndex++;
  localStorage.setItem('proxy_history_index', String(historyIndex));
  navigate(history[historyIndex], false);
  updateNavButtons();
}

function reload() {
  if (currentUrl) {
    frame.src = buildProxyUrl(currentUrl);
  }
}

function updateNavButtons() {
  backBtn.disabled = historyIndex <= 0;
  forwardBtn.disabled = historyIndex >= history.length - 1;
  backBtn.style.opacity = backBtn.disabled ? '0.4' : '1';
  forwardBtn.style.opacity = forwardBtn.disabled ? '0.4' : '1';
}

// ===== Bookmarks =====
function getBookmarks() {
  return JSON.parse(localStorage.getItem(STORAGE_BOOKMARKS) || '[]');
}

function saveBookmarks(list) {
  localStorage.setItem(STORAGE_BOOKMARKS, JSON.stringify(list));
}

function renderBookmarks() {
  const list = getBookmarks();
  bookmarksList.innerHTML = '';
  list.forEach((bm, i) => {
    const item = document.createElement('span');
    item.className = 'bookmark-item';
    item.textContent = bm.name;
    item.addEventListener('click', () => navigate(bm.url));

    const remove = document.createElement('span');
    remove.className = 'remove';
    remove.textContent = '\u00d7';
    remove.addEventListener('click', (e) => {
      e.stopPropagation();
      const newList = getBookmarks();
      newList.splice(i, 1);
      saveBookmarks(newList);
      renderBookmarks();
    });

    item.appendChild(remove);
    bookmarksList.appendChild(item);
  });
}

function addBookmark() {
  if (!currentUrl) return;
  const name = prompt('书签名称:', currentUrl.replace(/^https?:\/\//, '').split('/')[0]);
  if (!name) return;
  const list = getBookmarks();
  list.push({ name, url: currentUrl });
  saveBookmarks(list);
  renderBookmarks();
}

// ===== Event listeners =====
goBtn.addEventListener('click', () => navigate(urlInput.value));
urlInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') navigate(urlInput.value);
});
backBtn.addEventListener('click', goBack);
forwardBtn.addEventListener('click', goForward);
reloadBtn.addEventListener('click', reload);
configBtn.addEventListener('click', showProxyConfig);
saveProxyBtn.addEventListener('click', saveProxy);
proxyInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') saveProxy();
});
addBookmarkBtn.addEventListener('click', addBookmark);
errorConfigBtn.addEventListener('click', () => {
  errorOverlay.classList.add('hidden');
  showProxyConfig();
});

// Listen for navigation messages from proxied iframe
window.addEventListener('message', (e) => {
  if (e.data && e.data.type === 'proxy-navigate') {
    if (e.data.url && e.data.url !== currentUrl) {
      currentUrl = e.data.url;
      urlInput.value = e.data.url;
    }
  }
});

// Frame load error detection
frame.addEventListener('error', () => {
  errorMsg.textContent = '无法连接到代理服务器';
  errorOverlay.classList.remove('hidden');
});

// ===== Init =====
proxyInput.value = proxyOrigin;
updateNavButtons();
renderBookmarks();

if (!proxyOrigin) {
  showProxyConfig();
  proxyStatus.textContent = '正在自动探测…';
  autoDetectProxy().then((found) => {
    if (found) {
      proxyOrigin = found;
      localStorage.setItem(STORAGE_PROXY, found);
      hideProxyConfig();
      if (history.length > 0 && historyIndex >= 0) navigate(history[historyIndex], false);
    } else {
      proxyStatus.textContent = '自动探测失败，请手动填写';
    }
  });
}

// If history exists, load last page
if (history.length > 0 && historyIndex >= 0 && proxyOrigin) {
  navigate(history[historyIndex], false);
}
