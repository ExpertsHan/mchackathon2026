// rules.js：把申請人填的資料跟 OCR 擷取的資料交叉比對，判定綠燈/黃燈/紅燈（僅供承辦人員參考，不自動核准）
function normalize(str) {
  return (str || '').toString().toLowerCase().replace(/\s+/g, '');
}

function toolNameMatches(applied, ocrExtracted) {
  if (!applied || !ocrExtracted) return null; // 無法判斷
  const a = normalize(applied);
  const b = normalize(ocrExtracted);
  return a.includes(b) || b.includes(a);
}

function amountMatches(declared, ocrAmount) {
  if (!declared || !ocrAmount) return null; // 無法判斷
  const diffRatio = Math.abs(declared - ocrAmount) / Math.max(declared, ocrAmount);
  if (diffRatio <= 0.05) return 'match'; // 5% 以內視為一致（可能有匯率換算或手續費誤差）
  if (diffRatio <= 0.2) return 'minor_diff'; // 20% 以內算小差異
  return 'major_diff';
}

function evaluateRisk(application, docs) {
  const reasons = [];

  const idBack = docs.id_back;
  if (!idBack || idBack.ocr_status !== 'done') {
    reasons.push({ level: 'yellow', text: '身分證背面 OCR 辨識失敗或尚未完成，需人工確認設籍地址' });
  } else if (idBack.ocr_data?.is_hsinchu_city === false) {
    reasons.push({ level: 'red', text: 'OCR 判讀身分證地址不是新竹市，可能不符合設籍資格' });
  } else if (idBack.ocr_data?.is_hsinchu_city === null || idBack.ocr_data?.is_hsinchu_city === undefined) {
    reasons.push({ level: 'yellow', text: 'OCR 無法明確判讀身分證地址欄位，需人工確認' });
  }

  const receipt = docs.receipt;
  if (!receipt || receipt.ocr_status !== 'done') {
    reasons.push({ level: 'yellow', text: '發票 OCR 辨識失敗或尚未完成，需人工核對金額與工具名稱' });
  } else {
    const ocrAmount = receipt.ocr_data?.amount;
    const amountCheck = amountMatches(application.declared_amount, ocrAmount);
    if (amountCheck === 'major_diff') {
      reasons.push({
        level: 'red',
        text: `申請金額（${application.declared_amount}元）與發票 OCR 金額（${ocrAmount}元）差異過大`,
      });
    } else if (amountCheck === 'minor_diff') {
      reasons.push({
        level: 'yellow',
        text: `申請金額（${application.declared_amount}元）與發票 OCR 金額（${ocrAmount}元）有落差，需人工核對`,
      });
    } else if (amountCheck === null) {
      reasons.push({ level: 'yellow', text: '無法從發票 OCR 結果判讀金額，需人工核對' });
    }

    const toolMatch = toolNameMatches(application.applied_tool_name, receipt.ocr_data?.tool_name);
    if (toolMatch === false) {
      reasons.push({
        level: 'yellow',
        text: `申請填寫的工具名稱（${application.applied_tool_name}）與發票 OCR 品名（${receipt.ocr_data?.tool_name}）不一致，需人工核對`,
      });
    } else if (toolMatch === null) {
      reasons.push({ level: 'yellow', text: '無法從發票 OCR 結果判讀工具名稱，需人工核對' });
    }
  }

  let level = 'green';
  if (reasons.some((r) => r.level === 'red')) level = 'red';
  else if (reasons.some((r) => r.level === 'yellow')) level = 'yellow';

  return { level, reasons };
}

module.exports = { evaluateRisk };
