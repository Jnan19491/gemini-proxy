// /api/index.js
import express from 'express';
import { Readable } from 'stream';

const app = express();

const TARGET_API_URL = 'https://generativelanguage.googleapis.com';
const TARGET_HOSTNAME = new URL(TARGET_API_URL).hostname;
const TARGET_ORIGIN = new URL(TARGET_API_URL).origin;

app.all('*', async (req, res) => {
  if (req.url === '/') { // (新增對根路徑的判斷)
    return res.send('proxy is running, you can see more at https://github.com/spectre-pro/gemini-proxy'); // (如果是根路徑，返回指定訊息並結束請求)
  } 
  const targetUrl = `${TARGET_API_URL}${req.url}`;
  
  console.log(`\n==================== 新的代理請求 ====================`);
  console.log(`[${new Date().toISOString()}]`);
  console.log(`代理請求: ${req.method} ${req.url}`);
  console.log(`轉發目標: ${targetUrl}`);
  console.log(`--- 原始請求標頭 (Raw Request Headers) ---`);
  // 使用 JSON.stringify(obj, null, 2) 可以讓輸出的物件格式更美觀，方便閱讀
  console.log(JSON.stringify(req.headers, null, 2));
  console.log(`------------------------------------------`);

  let rawApiKeys = '';
  let apiKeySource = ''; // 用來記錄金鑰來源: 'x-goog' 或 'auth'

  if (req.headers['x-goog-api-key']) {
    rawApiKeys = req.headers['x-goog-api-key'];
    apiKeySource = 'x-goog';
    console.log('在 x-goog-api-key 標頭中找到 API 金鑰');
  } 
  else if (req.headers.authorization && req.headers.authorization.toLowerCase().startsWith('bearer ')) {
    rawApiKeys = req.headers.authorization.substring(7); 
    apiKeySource = 'auth';
    console.log('在 Authorization 標頭中找到 API 金鑰');
  }

  let selectedKey = '';
  if (apiKeySource) {
    const apiKeys = String(rawApiKeys).split(',').map(k => k.trim()).filter(k => k);
    if (apiKeys.length > 0) {
      selectedKey = apiKeys[Math.floor(Math.random() * apiKeys.length)];
      console.log(`Gemini Selected API Key: ${selectedKey}`);
    }
  }

  const headers = {};
  for (const [key, value] of Object.entries(req.headers)) {
    const lowerKey = key.toLowerCase();
    if (lowerKey !== 'x-goog-api-key' && lowerKey !== 'authorization') {
      headers[key] = value;
    }
  }

  // 根據金鑰來源，將選擇的金鑰以正確的標頭格式加回去
  if (selectedKey) {
    if (apiKeySource === 'x-goog') {
      headers['x-goog-api-key'] = selectedKey;
    } else if (apiKeySource === 'auth') {
      headers['Authorization'] = `Bearer ${selectedKey}`;
    }
  }

  headers.host = TARGET_HOSTNAME;
  headers.origin = TARGET_ORIGIN;
  headers.referer = TARGET_API_URL;
  
  headers['x-forwarded-for'] = req.headers['x-forwarded-for'] || req.socket.remoteAddress;
  headers['x-forwarded-proto'] = req.headers['x-forwarded-proto'] || req.protocol;

  const hopByHopHeaders = [
    'connection', 'keep-alive', 'proxy-authenticate', 'proxy-authorization',
    'te', 'trailers', 'transfer-encoding', 'upgrade'
  ];
  for (const header of hopByHopHeaders) {
    delete headers[header];
  }

  try {
    const apiResponse = await fetch(targetUrl, {
      method: req.method,
      headers: headers,
      body: (req.method !== 'GET' && req.method !== 'HEAD') ? req : undefined,
      duplex: 'half',
    });

    // 將目標 API 的回應頭部轉發給客戶端
    // 過濾掉不應直接轉發的標頭
    const responseHeaders = {};
    for (const [key, value] of apiResponse.headers.entries()) {
      if (!['content-encoding', 'transfer-encoding', 'connection', 'strict-transport-security'].includes(key.toLowerCase())) {
        responseHeaders[key] = value;
      }
    }
    res.writeHead(apiResponse.status, responseHeaders);

    // 將目標 API 的回應流式傳輸回客戶端
    if (apiResponse.body) {
      Readable.fromWeb(apiResponse.body).pipe(res);
    } else {
      res.end();
    }
  } catch (error) {
    console.error(`代理請求時發生錯誤:`, error);
    if (!res.headersSent) {
      res.status(502).send('代理伺服器錯誤 (Bad Gateway)');
    }
  }
});

export default app;