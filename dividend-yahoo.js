// 取得股價、配股資料並寫入 google spreadsheet
const https = require('https');
const axios = require("axios");
const cheerio = require("cheerio");
const fs = require('fs');
const path = require('path');
const config = require('./config'); // 載入組態設定

// --- 組態設定 ---
const URL_SHEET_MGR = config.URL_SHEET_MGR; // 從設定檔讀取
const MIN_SLEEP_MS = 6000;
const MAX_SLEEP_MS = 20000;
const HTTPS_AGENT = new https.Agent({
  rejectUnauthorized: false
});
const MAX_RETRIES = 5;
const RETRY_DELAY_MS = 30000;
const LOG_DIR = 'log';
const MAX_LOG_FILES = 30;
const COMMON_HEADERS = {
    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,image/apng,*/*;q=0.8',
    'Accept-Encoding': 'gzip, deflate, br',
    'Accept-Language': 'en-US,en;q=0.9,zh-TW;q=0.8',
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36'
};


// --- 日誌記錄器設定 ---
/**
 * 獲取格式化的本地時間戳
 * @returns {string} YYYY-MM-DD HH:mm:ss.sss
 */
function getFormattedLocalTimestamp() {
    const d = new Date();
    const pad = (num) => num.toString().padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}.${d.getMilliseconds().toString().padStart(3, '0')}`;
}

const logFileName = `dividend-yahoo-${getFormattedLocalTimestamp().replace(/:/g, '-')}.log`;
const logFilePath = path.join(LOG_DIR, logFileName);
const logStream = fs.createWriteStream(logFilePath, { flags: 'a' });

/**
 * 建立格式化的日誌訊息，並處理開頭的換行符
 * @param {string} level - 日誌級別 (e.g., 'LOG', 'WARN')
 * @param {string | object} message - 日誌訊息或物件
 * @returns {string} 格式化後的日誌訊息
 */
function createFormattedMessage(level, message) {
  let leadingNewlines = '';
  let processedMessage = message;

  if (typeof message === 'string') {
    const match = message.match(/^(\n+)/);
    if (match) {
      leadingNewlines = match[1];
      processedMessage = message.substring(match[0].length);
    }
  }
  return `${leadingNewlines}[${level}] ${getFormattedLocalTimestamp()}: ${processedMessage}`;
}

const logger = {
  log: (message) => {
    const formattedMessage = createFormattedMessage('LOG', message);
    console.log(formattedMessage);
    logStream.write(formattedMessage + '\n');
  },
  warn: (message) => {
    const formattedMessage = createFormattedMessage('WARN', message);
    console.warn(formattedMessage);
    logStream.write(formattedMessage + '\n');
  },
  error: (message) => {
    const formattedMessage = createFormattedMessage('ERROR', message);
    console.error(formattedMessage);
    logStream.write(formattedMessage + '\n');
  },
  dir: (obj) => {
    const util = require('util');
    const formattedMessage = `[DIR] ${getFormattedLocalTimestamp()}: ${util.inspect(obj, { depth: null, colors: false })}`;
    console.dir(obj, { depth: null, colors: true });
    logStream.write(formattedMessage + '\n');
  }
};

// --- 輔助函式 ---

/**
 * 產生 min 到 max 之間的亂數
 */
function getRandom(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

/**
 * 睡眠指定的毫秒數
 */
function sleep(time) {
  return new Promise(resolve => setTimeout(resolve, time));
}

/**
 * 格式化日期字串
 */
function formatDate(dateString) {
  if (!dateString) return "";
  return dateString
    .replace("'", "/")
    .replace(/即將發放|即將除息|即將除權/g, "")
    .trim();
}

/**
 * 帶有重試機制的函數執行器
 * @param {Function} fn - 要執行的異步函數
 * @param {string} fnName - 函數名稱 (用於日誌)
 * @returns {Promise<any>}
 */
async function withRetry(fn, fnName) {
  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    try {
      return await fn();
    } catch (err) {
      logger.error(`嘗試 ${attempt}/${MAX_RETRIES} 執行 ${fnName} 失敗: ${err.message}`);
      logger.dir(err);
      if (attempt < MAX_RETRIES) {
        logger.log(`等待 ${RETRY_DELAY_MS / 1000} 秒後重試...`);
        await sleep(RETRY_DELAY_MS);
      } else {
        logger.error(`所有 ${MAX_RETRIES} 次嘗試執行 ${fnName} 皆失敗。放棄執行。`);
        throw err;
      }
    }
  }
}

/**
 * 管理日誌檔案，只保留最近的 N 個
 */
function cleanupLogFiles() {
    try {
        logger.log(`正在清理 '${LOG_DIR}' 目錄中的舊日誌檔案...`);
        const files = fs.readdirSync(LOG_DIR)
            .map(file => ({
                name: file,
                time: fs.statSync(path.join(LOG_DIR, file)).mtime.getTime()
            }))
            .sort((a, b) => b.time - a.time); // 依修改時間排序，最新的在前

        if (files.length > MAX_LOG_FILES) {
            const filesToDelete = files.slice(MAX_LOG_FILES);
            logger.log(`找到 ${files.length} 個日誌檔案，保留最新的 ${MAX_LOG_FILES} 個。正在刪除 ${filesToDelete.length} 個舊檔案。`);
            for (const file of filesToDelete) {
                fs.unlinkSync(path.join(LOG_DIR, file.name));
                logger.log(`已刪除舊日誌檔案: ${file.name}`);
            }
        } else {
            logger.log(`找到 ${files.length} 個日誌檔案。無需清理。`);
        }
    } catch (err) {
        logger.error(`清理日誌檔案時發生錯誤: ${err.message}`);
    }
}


// --- 核心邏輯 ---

/**
 * 抓取台灣加權指數(TAIEX)並寫入 Google Sheet
 */
async function fetchAndWriteTAIEX() {
  await withRetry(async () => {
    logger.log("--- 開始抓取台灣加權指數(TAIEX) ---");
    const taiexURL = "https://tw.stock.yahoo.com/quote/%5ETWII";
    
    logger.log(`正在從此網址獲取資料: ${taiexURL}`);
    // 參考 TAIEX.js 的成功經驗，移除 COMMON_HEADERS，但保留 httpsAgent
    const res = await axios.get(taiexURL, { httpsAgent: HTTPS_AGENT });
    const $ = cheerio.load(res.data);

    const indexValueText = $("#main-0-QuoteHeader-Proxy").find('span').eq(2).text();
    const indexValue = parseFloat(indexValueText.replace(/,/g, ''));

    if (isNaN(indexValue)) {
      throw new Error("無法解析 TAIEX 指數值，收到的內容為: " + indexValueText);
    }
    
    logger.log(`成功抓取到 TAIEX 指數: ${indexValue}`);

    const jsonData = {
      action: "TAIEX",
      data: JSON.stringify(indexValue),
    };

    logger.log("正在傳送 TAIEX 資料到 Google Sheet...");
    logger.dir(jsonData);
    
    // 參考 TAIEX.js，此處也移除 COMMON_HEADERS
    const response = await axios.post(URL_SHEET_MGR, jsonData, { httpsAgent: HTTPS_AGENT });
    logger.log("Google Sheet API 回應 (TAIEX):");
    logger.dir(response.data);
    logger.log("--- TAIEX 資料處理完畢 ---");

  }, 'fetchAndWriteTAIEX');
}


/**
 * 從 Google Sheet 取得股票列表
 * @returns {Promise<string[][]>}
 */
async function getStockList() {
  return withRetry(async () => {
    logger.log("正在從 Google Sheet 獲取股票列表...");
    const response = await axios.get(URL_SHEET_MGR, {
      params: { action: "getStockList" },
      httpsAgent: HTTPS_AGENT,
    });

    const stockList = [];
    response.data.forEach(item => {
      if (typeof item === 'string' && item.includes('|')) {
        const yahooTicker = item.split('|')[1];  // yahoo ticker是第二個
        stockList.push([yahooTicker, item]);     // [yahooTicker, 原始代碼字串]
      } else {
        logger.warn(`遇到無效的資料格式並已略過: ${item}`);
      }
    });

    logger.log(`成功獲取 ${stockList.length} 支股票。`);
    return stockList;
  }, 'getStockList');
}

/**
 * 抓取並解析單一股票的股利和股價資料
 * @param {string[]} stockItem - [yahooTicker, 原始代碼字串]
 * @returns {Promise<object|null>}
 */
async function fetchStockData(stockItem) {
  const [stockNo, originalTicker] = stockItem;
  const stockURL = `https://tw.stock.yahoo.com/quote/${stockNo}/dividend`;
  logger.log(`正在從此網址獲取資料: ${stockURL}`);

  try {
    const res = await axios.get(stockURL, { httpsAgent: HTTPS_AGENT });
    const $ = cheerio.load(res.data);
    
    // 先抓取價格
    const price = $("div", "#main-0-QuoteHeader-Proxy").next().find('span').first().text();
    if (!price) {
      logger.warn(`警告: 找不到 ${stockNo} 的股價。`);
    } else {
      logger.log(`讀取到 ${stockNo} 的股價: ${price}`);
    }

    let trArray = [];

    // 主要的資料擷取邏輯
    $("section", "#main-2-QuoteDividend-Proxy")
      .next().find('li').first().children().first().find('div')
      .each(function (i, elem) {
        trArray.push($(this).text());
      });

    // 適用於季配息/月配息的備用邏輯
    if (trArray.length > 0 && trArray[2].length === 0) {
      logger.log(`資訊: ${stockNo} 的第一列股利資料為空，嘗試讀取第二列。`);
      trArray = [];
      $("section", "#main-2-QuoteDividend-Proxy")
        .next().find('li').eq(1).children().first().find('div')
        .each(function (i, elem) {
          trArray.push($(this).text());
        });
    }

    // 處理「查無資料」的情況
    if (trArray.length === 0) {
      let noDataFound = false;
      $("section", "#main-2-QuoteDividend-Proxy").next().find('div').each(function (i, elem) {
        if ($(this).text() === '查無資料') {
          noDataFound = true;
        }
      });
      
      if (noDataFound) {
        logger.log(`資訊: 在 Yahoo 頁面上找不到 ${stockNo} 的股利資料。`);
        // 回傳一個包含價格但無股利資料的物件
        return {
            stockNo: stockNo,
            tickers: originalTicker,
            price: price || 'N/A',
            divYear: '',
            divDateCash: '',
            divDateCashPay: '',
            divDateStock: '',
            divDateStockPay: '',
            divCash: 0,
            divStock: 0,
            divTotal: 0,
        };
      } else {
        // 如果不是「查無資料」，但又抓不到，可能頁面結構改變或被阻擋
        logger.error(`錯誤: 解析 ${stockNo} 的股利資料失敗。頁面結構可能已變更或請求被阻擋。`);
        return null;
      }
    }

    const cashDividend = parseFloat(trArray[3]) || 0;
    const stockDividend = parseFloat(trArray[4]) || 0;

    const stockData = {
      stockNo: stockNo,
      tickers: originalTicker,
      price: price || 'N/A',
      divYear: trArray[2] || '',
      divDateCash: formatDate(trArray[7]),
      divDateCashPay: formatDate(trArray[9]),
      divDateStock: formatDate(trArray[8]),
      divDateStockPay: formatDate(trArray[10]),
      divCash: cashDividend,
      divStock: stockDividend,
      divTotal: cashDividend + stockDividend,
    };

    logger.log("成功解析資料:");
    return stockData;

  } catch (err) {
    logger.error(`處理 ${stockNo} 時發生錯誤: ${err.message}`);
    return null; // 確保發生任何錯誤時都能繼續處理下一筆
  }
}

/**
 * 將整理好的資料寫回 Google Sheet
 * @param {object[]} data - 整理好的股票資料陣列
 */
async function writeToGoogleSheet(data) {
  if (data.length === 0) {
    logger.log("沒有資料可寫入 Google Sheet。");
    return;
  }

  await withRetry(async () => {
    const jsonData = { action: "dividend", data: data };
    logger.log(`\n正在傳送 ${data.length} 筆記錄到 Google Sheet...`);
    logger.dir(jsonData);
    
    const response = await axios.post(URL_SHEET_MGR, jsonData, { httpsAgent: HTTPS_AGENT });
    logger.log("Google Sheet API 回應:");
    logger.dir(response.data);
  }, 'writeToGoogleSheet');
}

/**
 * 主執行函式
 */
async function main() {
  logger.log("--- 啟動股價資料抓取程式 ---");
  cleanupLogFiles();
  
  // 步驟 1: 抓取並寫入 TAIEX 資料
  try {
    await fetchAndWriteTAIEX();
  } catch (err) {
    logger.error(`\n處理 TAIEX 資料時發生無法復原的錯誤，但將繼續處理個股資料: ${err.message}`);
  }

  logger.log("\n--- 開始處理個股資料 ---");

  // 步驟 2: 抓取股票列表
  const allStocks = await getStockList();

  const filteredStocks = allStocks.filter(item => {
    const ticker = item[0];
    const isTaiwanStock = ticker.endsWith('.TW') || ticker.endsWith('.TWO');
    if (!isTaiwanStock) {
      logger.log(`略過非台灣股票: ${ticker}`);
    }
    return isTaiwanStock;
  });

  logger.log(`\n正在處理 ${filteredStocks.length} 支台灣股票...`);
  
  // 步驟 3: 迭代處理每支股票
  const results = [];
  for (const [index, stockItem] of filteredStocks.entries()) {
    logger.log(`\n\n---- [${index + 1}/${filteredStocks.length}] 正在處理: ${stockItem[0]} ----`);
    
    const data = await fetchStockData(stockItem);
    if (data) {
      // 只將有成功抓到資料的（即使是無股利資料）推進去
      if (data.price !== 'N/A') {
          results.push(data);
          logger.dir(data);
      }
    }

    if (index < filteredStocks.length - 1) {
      const sleepTime = getRandom(MIN_SLEEP_MS, MAX_SLEEP_MS);
      logger.log(`隨機延遲 ${sleepTime / 1000} 秒...`);
      await sleep(sleepTime);
    }
  }

  logger.log("\n\n--- 所有股票處理完畢 ---");
  logger.log(`成功抓取 ${results.length} / ${filteredStocks.length} 支股票的資料。`);

  // 步驟 4: 將結果寫入 Google Sheet
  await writeToGoogleSheet(results);

  logger.log("\n--- 腳本執行完畢 ---");
}

// --- 腳本執行 ---
main().catch(err => {
  logger.error(`\n發生無法復原的錯誤，腳本即將終止。 ${err.stack}`);
  process.exit(1);
}).finally(() => {
    logStream.end();
});
