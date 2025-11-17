// /api/index.js
import express from 'express';
import { Readable } from 'stream';
const app = express();
const TARGET_API_URL = 'https://generativelanguage.googleapis.com';

app.all('*', async (req, res) => {
  // 根據請求 URL 決定目標 URL
  let targetUrl;
  if (req.url === '/') {
    targetUrl = 'https://aistudio.google.com/status'; // 根路徑代理到指定 URL
  } else {
    targetUrl = `${TARGET_API_URL}${req.url}`; // 其他路徑維持原代理目標
  }

  // 動態計算目標主機名和來源
  const targetHostname = new URL(targetUrl).hostname;
  const targetOrigin = new URL(targetUrl).origin;

  console.log(`\n==================== 新的代理請求 ====================`);
  console.log(`[${new Date().toISOString()}]`);
  console.log(`代理請求: ${req.method} ${req.url}`);
  console.log(`轉發目標: ${targetUrl}`);
  
  let rawApiKeys = '';
  let apiKeySource = '';
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
  
  if (selectedKey) {
    if (apiKeySource === 'x-goog') {
      headers['x-goog-api-key'] = selectedKey;
    } else if (apiKeySource === 'auth') {
      headers['Authorization'] = `Bearer ${selectedKey}`;
    }
  }
  
  headers.host = targetHostname;
  headers.origin = targetOrigin;
  headers.referer = targetOrigin;

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
      // 禁用自動重定向，手動處理
      redirect: 'manual'
    });
    
    console.log(`回應狀態碼: ${apiResponse.status}`);
    console.log(`回應標頭:`, Object.fromEntries(apiResponse.headers.entries()));
    
    // 檢查是否為重定向回應
    if (apiResponse.status >= 300 && apiResponse.status < 400) {
      const location = apiResponse.headers.get('location');
      console.log(`檢測到重定向到: ${location}`);
      
      if (location) {
        // 如果是根路徑的重定向，我們可以選擇跟隨或返回重定向
        if (req.url === '/') {
          // 選項1: 跟隨重定向
          console.log(`跟隨重定向到: ${location}`);
          const redirectResponse = await fetch(location, {
            method: req.method,
            headers: headers,
            body: (req.method !== 'GET' && req.method !== 'HEAD') ? req : undefined,
            duplex: 'half'
          });
          
          const responseHeaders = {};
          for (const [key, value] of redirectResponse.headers.entries()) {
            if (!['content-encoding', 'transfer-encoding', 'connection', 'strict-transport-security'].includes(key.toLowerCase())) {
              responseHeaders[key] = value;
            }
          }
          res.writeHead(redirectResponse.status, responseHeaders);
          
          if (redirectResponse.body) {
            Readable.fromWeb(redirectResponse.body).pipe(res);
          } else {
            res.end();
          }
          return;
          
        }
      }
    }
    
    // 正常處理非重定向回應
    const responseHeaders = {};
    for (const [key, value] of apiResponse.headers.entries()) {
      if (!['content-encoding', 'transfer-encoding', 'connection', 'strict-transport-security'].includes(key.toLowerCase())) {
        responseHeaders[key] = value;
      }
    }
    res.writeHead(apiResponse.status, responseHeaders);
    
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