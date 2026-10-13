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

function showProxyConfig() {
  configPanel.classList.remove('hidden');
  proxyInput.value = proxyOrigin;
  proxyInput.focus();
}

function hideProxyConfig() {
  configPanel.classList.add('hidden');
}

function saveProxy() {
  const val = proxyInput.value.trim().replace(/\/$/, '');
  if (!val) {
    alert('请输入代理服务器地址');
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
}

// If history exists, load last page
if (history.length > 0 && historyIndex >= 0 && proxyOrigin) {
  navigate(history[historyIndex], false);
}
