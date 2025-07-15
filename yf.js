const yahooFinance = require('yahoo-finance2').default;

async function queryStockDetails(ticker) {
  try {
    console.log(`\n--- 查詢 ${ticker} 資料 ---`);

    // --- 1. 查詢即時股價 (Current Quote) ---
    // quote 方法會返回最新的價格、開盤價、成交量、市值等綜合資訊
    const quote = await yahooFinance.quote(ticker);
    console.log(`\n即時股價資訊:`);
    console.log(`  當前價格: ${quote.regularMarketPrice ? quote.regularMarketPrice.toFixed(2) : 'N/A'}`);
    console.log(`  開盤價: ${quote.regularMarketOpen ? quote.regularMarketOpen.toFixed(2) : 'N/A'}`);
    console.log(`  盤中最高: ${quote.regularMarketDayHigh ? quote.regularMarketDayHigh.toFixed(2) : 'N/A'}`);
    console.log(`  盤中最低: ${quote.regularMarketDayLow ? quote.regularMarketDayLow.toFixed(2) : 'N/A'}`);
    console.log(`  成交量: ${quote.regularMarketVolume ? quote.regularMarketVolume.toLocaleString() : 'N/A'}`);
    console.log(`  市值: ${quote.marketCap ? quote.marketCap.toLocaleString() : 'N/A'}`);
    console.log(`  交易時間: ${quote.regularMarketTime ? new Date(quote.regularMarketTime * 1000).toLocaleString() : 'N/A'}`);


    // --- 2. 查詢除權息資料 (Dividends Data) ---
    // 這部分需要從歷史數據中篩選出 'div' (dividends) 事件。
    // 通常 Yahoo Finance 的數據中，除權息日期會是該事件的日期。
    // 注意：Yahoo Finance 可能不會明確區分「除權」和「除息」，通常只提供股息事件 (dividends)。
    // 如果是股票分割（stock splits），則需要查詢 'split' 事件。
    const currentYear = new Date().getFullYear();
    const dividends = await yahooFinance.historical(ticker, {
      period1: `${currentYear}-01-01`, // 從本年度開始
      period2: `${currentYear + 1}-01-01`, // 到下年度年初，確保涵蓋本年度所有數據
      events: 'div', // 只查詢股息事件
      // interval: '1d' // 確保是每日數據，以便獲取確切日期
    });

    console.log(`\n${currentYear} 年度除權息 (配息) 資料:`);
    if (dividends && dividends.length > 0) {
      // 通常 Yahoo Finance 提供的 'date' 就是除息日 (Ex-Dividend Date)
      dividends.forEach(div => {
        if (div.dividends) { // 確保這是股息數據
          console.log(`  除息日 (或事件日期): ${div.date.toISOString().slice(0, 10)}, 配息: ${div.dividends.toFixed(4)}`);
        }
      });
    } else {
      console.log(`  未找到 ${currentYear} 年度的除權息資料。`);
    }

    // --- (額外) 查詢股票分割 (Stock Splits) ---
    // 如果你也想看股票分割資料，可以這樣查詢：
    const splits = await yahooFinance.historical(ticker, {
        period1: `${currentYear}-01-01`,
        period2: `${currentYear + 1}-01-01`,
        events: 'split' // 只查詢分割事件
    });

    console.log(`\n${currentYear} 年度股票分割資料:`);
    if (splits && splits.length > 0) {
      splits.forEach(s => {
        if (s.splits) {
          console.log(`  分割日期: ${s.date.toISOString().slice(0, 10)}, 分割比例: ${s.splits}`);
        }
      });
    } else {
      console.log(`  未找到 ${currentYear} 年度的股票分割資料。`);
    }


  } catch (error) {
    console.error(`\n獲取 ${ticker} 資料時發生錯誤:`, error.message);
    if (error.result) {
        console.error("錯誤詳情:", error.result);
    }
  }
}

queryStockDetails("SPY");
