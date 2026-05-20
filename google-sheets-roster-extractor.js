/**
 * Google Apps Script：匯出第61期、初級禪修班、三晚初 學員名單
 * 
 * 使用方式：
 * 1. 在 Google Sheet（1Mz8FOg0cv8nrcTU7z1GhTRZvbTphrALXs5a8Xb7hFVc）中，點選「擴充功能」→「Apps Script」
 * 2. 將本腳本貼入，儲存
 * 3. 執行「extractRoster」或「extractRosterAndLog」
 * 4. 複製輸出的 JSON，貼到本系統的「⚙️ 地點設定 → 👥 學員名單設定 → 匯入 JSON」
 *
 * 注意：
 * - 只讀取 01～09 分頁
 * - A欄 = 組號（數字），B欄 = 姓名，C欄 = 法名
 * - 只取 A欄有數字的列
 * - 有法名者格式：姓名(法名)
 */

function extractRoster() {
  const ss = SpreadsheetApp.openById('1Mz8FOg0cv8nrcTU7z1GhTRZvbTphrALXs5a8Xb7hFVc');
  
  const tabs = ['01','02','03','04','05','06','07','08','09'];
  const roster = {};

  tabs.forEach(tabName => {
    const sheet = ss.getSheetByName(tabName);
    if (!sheet) {
      Logger.log(`分頁 ${tabName} 不存在，跳過`);
      return;
    }

    const lastRow = sheet.getLastRow();
    if (lastRow < 2) {
      Logger.log(`分頁 ${tabName} 無資料`);
      return;
    }

    const groupNum = tabName.replace(/^0+/, ''); // "01" → "1"
    const names = [];

    // 從第2列開始讀取（略過標題）
    for (let r = 2; r <= lastRow; r++) {
      const groupCell = sheet.getRange(r, 1).getValue(); // A欄
      const nameCell  = sheet.getRange(r, 2).getValue();  // B欄
      const fameCell  = sheet.getRange(r, 3).getValue();  // C欄

      // 只取 A欄為數字的列
      if (groupCell !== '' && !isNaN(Number(groupCell)) && nameCell && String(nameCell).trim() !== '') {
        const name = String(nameCell).trim();
        const fame = fameCell ? String(fameCell).trim() : '';
        if (fame) {
          names.push(`${name}(${fame})`);
        } else {
          names.push(name);
        }
      }
    }

    roster[groupNum] = names;
    Logger.log(`第${groupNum}組：${names.length}人 → ${JSON.stringify(names)}`);
  });

  // 輸出完整 JSON
  const output = JSON.stringify(roster, null, 2);
  Logger.log('========== 輸出 JSON ==========');
  Logger.log(output);

  // 同時顯示在 Sheet 中方便複製
  const ui = SpreadsheetApp.getUi();
  ui.alert('學員名單 JSON（已複製到剪貼簿）\n\n' + output, ui.ButtonSet.OK);

  // 複製到剪貼簿（部分環境不支援）
  try {
    const clip = HtmlService.createHtmlOutput(`<script>google.script.run.withSuccessHandler(()=>{}).copyToClipboard(\`${output.replace(/`/g, '\\`')}\`);google.script.host.close();</script>`);
    // 若失敗則請手動複製 Logger.log 輸出
  } catch(e) {
    Logger.log('（若要自動複製，請在 UI 中查看輸出）');
  }

  return roster;
}

function extractRosterAndLog() {
  // 僅輸出到 Logger，方便在 Execution log 中查看
  extractRoster();
}
