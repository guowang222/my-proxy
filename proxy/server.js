import express from 'express';
import * as cheerio from 'cheerio';

const app = express();
const PROXY_PREFIX = '/proxy';
const PORT = process.env.PORT || 3000;

// CORS: allow GitHub Pages origin
app.use((req, res, next) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, PATCH, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Cookie');
  res.setHeader('Access-Control-Allow-Credentials', 'true');
  if (req.method === 'OPTIONS') {
    return res.sendStatus(200);
  }
  next();
});

app.use(express.urlencoded({ extended: true }));
app.use(express.text({ type: 'application/x-www-form-urlencoded' }));

function resolveUrl(url, base) {
  try {
    return new URL(url, base).href;
  } catch {
    return null;
  }
}

function toProxyUrl(originalUrl, base) {
  const resolved = resolveUrl(originalUrl, base);
  if (!resolved) return originalUrl;
  return `${PROXY_PREFIX}?url=${encodeURIComponent(resolved)}`;
}

// Injected script: intercepts fetch, XHR, window.open to route through proxy
function buildInjectScript(targetUrl) {
  return `<script>(function(){
  var P='${PROXY_PREFIX}';
  var B='${targetUrl}';
  // Intercept fetch
  var _fetch=window.fetch;
  window.fetch=function(input,init){
    try{
      if(typeof input==='string'){
        input=P+'?url='+encodeURIComponent(new URL(input,B).href);
      }else if(input instanceof Request){
        input=new Request(P+'?url='+encodeURIComponent(new URL(input.url,B).href),input);
      }
    }catch(e){}
    return _fetch.call(this,input,init);
  };
  // Intercept XHR
  var _open=XMLHttpRequest.prototype.open;
  XMLHttpRequest.prototype.open=function(m,u){
    try{u=P+'?url='+encodeURIComponent(new URL(u,B).href);}catch(e){}
    return _open.call(this,m,u);
  };
  // Intercept window.open -> navigate within iframe
  window.open=function(u){
    if(u){try{u=P+'?url='+encodeURIComponent(new URL(u,B).href);}catch(e){} window.location.href=u;}
    return null;
  };
  // Disable Service Worker registration
  if(navigator.serviceWorker){
    navigator.serviceWorker.register=function(){return Promise.reject(new Error('disabled'));};
  }
  // Notify parent frame of current URL
  try{window.parent.postMessage({type:'proxy-navigate',url:B},'*');}catch(e){}
})();<\/script>`;
}

function rewriteHtml(html, targetUrl, reqOrigin) {
  const $ = cheerio.load(html);

  // Strip base tag, set our own
  $('base').remove();

  // Rewrite links - strip target to keep in iframe
  $('a[href]').each((_, el) => {
    const href = $(el).attr('href');
    if (!href) return;
    if (href.startsWith('#') || href.startsWith('javascript:') || href.startsWith('mailto:')) return;
    $(el).attr('href', toProxyUrl(href, targetUrl));
    $(el).removeAttr('target');
  });

  // Rewrite resource URLs
  $('link[href]').each((_, el) => {
    const href = $(el).attr('href');
    if (href && !href.startsWith('#')) $(el).attr('href', toProxyUrl(href, targetUrl));
  });

  $('script[src]').each((_, el) => {
    const src = $(el).attr('src');
    if (src) $(el).attr('src', toProxyUrl(src, targetUrl));
  });

  $('img[src]').each((_, el) => {
    const src = $(el).attr('src');
    if (src && !src.startsWith('data:')) $(el).attr('src', toProxyUrl(src, targetUrl));
  });

  $('img[srcset]').each((_, el) => {
    const srcset = $(el).attr('srcset');
    if (!srcset) return;
    const rewritten = srcset.split(',').map((s) => {
      const parts = s.trim().split(/\s+/);
      if (parts[0] && !parts[0].startsWith('data:')) parts[0] = toProxyUrl(parts[0], targetUrl);
      return parts.join(' ');
    }).join(', ');
    $(el).attr('srcset', rewritten);
  });

  // Rewrite form actions
  $('form[action]').each((_, el) => {
    const action = $(el).attr('action');
    if (action) $(el).attr('action', toProxyUrl(action, targetUrl));
  });

  // Inject interception script
  $('head').prepend(buildInjectScript(targetUrl));

  return $.html();
}

function rewriteCss(css, targetUrl) {
  return css.replace(/url\(\s*['"]?([^'")]+)['"]?\s*\)/g, (match, url) => {
    if (url.startsWith('data:') || url.startsWith('#')) return match;
    const resolved = resolveUrl(url, targetUrl);
    if (!resolved) return match;
    return `url(${PROXY_PREFIX}?url=${encodeURIComponent(resolved)})`;
  });
}

async function doProxy(req, res) {
  const targetUrl = req.query.url;
  if (!targetUrl) {
    return res.status(400).send('Missing "url" parameter. Usage: /proxy?url=https://example.com');
  }

  try {
    const headers = {
      'User-Agent': req.headers['user-agent'] || 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
      'Accept': req.headers['accept'] || '*/*',
      'Accept-Language': req.headers['accept-language'] || 'en-US,en;q=0.9',
    };

    // Forward cookies from client
    if (req.headers['cookie']) {
      headers['Cookie'] = req.headers['cookie'];
    }

    const fetchOptions = { headers, redirect: 'follow' };
    if (req.method === 'POST') {
      fetchOptions.method = 'POST';
      const ct = req.headers['content-type'] || '';
      if (ct.includes('application/json')) {
        fetchOptions.body = JSON.stringify(req.body);
        fetchOptions.headers['Content-Type'] = 'application/json';
      } else {
        fetchOptions.body = new URLSearchParams(req.body).toString();
        fetchOptions.headers['Content-Type'] = 'application/x-www-form-urlencoded';
      }
    }

    const response = await fetch(targetUrl, fetchOptions);
    const contentType = response.headers.get('content-type') || '';

    // Strip security headers that would block embedding/inline scripts
    const resHeaders = {};
    for (const [key, value] of response.headers) {
      const lk = key.toLowerCase();
      if (lk === 'content-security-policy' || lk === 'content-security-policy-report-only' || lk === 'x-frame-options' || lk === 'x-content-type-options') continue;
      resHeaders[key] = value;
    }

    // Forward Set-Cookie
    const setCookies = response.headers.getSetCookie?.() || [];
    setCookies.forEach((cookie) => res.append('Set-Cookie', cookie));

    if (contentType.includes('text/html')) {
      const html = await response.text();
      const rewritten = rewriteHtml(html, targetUrl);
      res.set('Content-Type', 'text/html; charset=utf-8');
      return res.send(rewritten);
    }

    if (contentType.includes('text/css')) {
      const css = await response.text();
      const rewritten = rewriteCss(css, targetUrl);
      res.set('Content-Type', 'text/css');
      return res.send(rewritten);
    }

    // Pass through other resources (JS, images, fonts, etc.)
    const buffer = Buffer.from(await response.arrayBuffer());
    res.set('Content-Type', contentType);
    return res.send(buffer);
  } catch (err) {
    return res.status(502).send(`Proxy error: ${err.message}`);
  }
}

app.get(PROXY_PREFIX, doProxy);
app.post(PROXY_PREFIX, doProxy);

// Health check
app.get('/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`[proxy] running on http://0.0.0.0:${PORT}`);
  console.log(`[proxy] proxy endpoint: /proxy?url=<target>`);
});
