

const axios = require('axios');
const https = require('https');

// --- 要測試的設定 ---
const testUrl = 'https://tw.stock.yahoo.com/quote/2330.TW/dividend';
const newHeaders = {
  'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,image/apng,*/*;q=0.8',
  'Accept-Encoding': 'gzip, deflate, br',
  'Accept-Language': 'en-US,en;q=0.9,zh-TW;q=0.8',
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36'
};
const httpsAgent = new https.Agent({
  rejectUnauthorized: false
});

// --- 測試函式 ---
async function testYahooConnection() {
  console.log(`正在使用新的 headers 測試連線到: ${testUrl}`);
  
  try {
    const response = await axios.get(testUrl, {
      headers: newHeaders,
      httpsAgent: httpsAgent,
      timeout: 15000 // 設定 15 秒超時
    });

    console.log(`\n--- 測試結果 ---`);
    console.log(`狀態碼: ${response.status} ${response.statusText}`);
    
    if (response.status === 200) {
      console.log('✅ 連線成功！Yahoo Finance 沒有阻擋這個請求。');
      console.log('這組 headers 看起來是有效的。');
      // 簡單檢查一下回傳內容的長度，確保不是空的頁面
      if (response.data && response.data.length > 1000) {
        console.log(`回傳內容長度: ${response.data.length} (正常)`);
      } else {
        console.warn(`⚠️ 警告: 回傳的內容長度過短 (${response.data.length})，頁面可能不完整或是一個錯誤頁面。`);
      }
    } else {
      console.error(`❌ 連線失敗！Yahoo Finance 回傳了非 200 的狀態碼。`);
    }

  } catch (error) {
    console.error(`\n--- 測試結果 ---`);
    console.error(`❌ 發生錯誤，連線失敗！`);
    if (error.response) {
      // 請求已發出，但伺服器回應了錯誤狀態碼
      console.error(`狀態碼: ${error.response.status}`);
      console.error(`回應 Headers:`, error.response.headers);
      console.error('這表示伺服器拒絕了我們的請求，很可能是因為 headers 被識別為爬蟲。');
    } else if (error.request) {
      // 請求已發出，但沒有收到回應
      console.error('請求已發出，但沒有收到回應。可能是網路問題、DNS 問題或請求被中途阻擋。');
    } else {
      // 設定請求時發生錯誤
      console.error('設定請求時發生錯誤:', error.message);
    }
  }
}

// --- 執行測試 ---
testYahooConnection();

