function renderUpload(container) {
  if (!Store.profile?.is_admin) {
    container.innerHTML = '<div class="empty-note">관리자만 접근할 수 있는 페이지입니다.</div>';
    return;
  }
  container.innerHTML = `
    <div class="grid grid-2">
      <div class="card card-pad">
        <div class="chart-card-title">매출 원장 업로드</div>
        <div class="text-faint" style="font-size:12px;margin:6px 0 14px">회계 프로그램에서 내려받은 판매현황내역(.xlsx)을 업로드하세요. 전체 파일이든, 새로 추가된 부분만이든 상관없습니다 &mdash; 이미 등록된 거래는 자동으로 건너뜁니다.</div>
        <div class="dropzone" id="salesDropzone">
          <div><strong>클릭</strong>하거나 파일을 끌어다 놓으세요</div>
          <div class="text-faint" style="margin-top:4px">.xlsx · 일자/담당자명/품명 및 규격/수량/단가... 형식</div>
        </div>
        <input type="file" id="salesFileInput" accept=".xlsx,.xls" class="hidden">
        <div class="upload-log hidden" id="salesLog"></div>
      </div>
      <div class="card card-pad">
        <div class="chart-card-title">재고현황 업로드</div>
        <div class="text-faint" style="font-size:12px;margin:6px 0 14px">'재고수량 YY.MM.DD' 시트로 구성된 재고현황.xlsx를 그대로 업로드하세요. 이미 반영된 날짜의 시트는 건너뛰고, 새 날짜만 처리합니다. 가장 최근 날짜 시트가 현재 재고로 반영됩니다.</div>
        <div class="dropzone" id="invDropzone">
          <div><strong>클릭</strong>하거나 파일을 끌어다 놓으세요</div>
          <div class="text-faint" style="margin-top:4px">.xlsx · '재고수량 YY.MM.DD' 시트 포함</div>
        </div>
        <input type="file" id="invFileInput" accept=".xlsx,.xls" class="hidden">
        <div class="upload-log hidden" id="invLog"></div>
      </div>
    </div>
  `;

  setupDropzone("salesDropzone", "salesFileInput", "salesLog", handleSalesUpload);
  setupDropzone("invDropzone", "invFileInput", "invLog", handleInventoryUpload);
}

function setupDropzone(zoneId, inputId, logId, handler) {
  const zone = document.getElementById(zoneId);
  const input = document.getElementById(inputId);
  zone.addEventListener("click", () => input.click());
  zone.addEventListener("dragover", (e) => { e.preventDefault(); zone.classList.add("dragover"); });
  zone.addEventListener("dragleave", () => zone.classList.remove("dragover"));
  zone.addEventListener("drop", (e) => {
    e.preventDefault(); zone.classList.remove("dragover");
    if (e.dataTransfer.files[0]) handler(e.dataTransfer.files[0], logId);
  });
  input.addEventListener("change", () => { if (input.files[0]) handler(input.files[0], logId); input.value = ""; });
}

function logTo(logId, msg) {
  const el = document.getElementById(logId);
  el.classList.remove("hidden");
  el.textContent += msg + "\n";
  el.scrollTop = el.scrollHeight;
}

function excelDateToIso(v) {
  if (v === null || v === undefined || v === "" || v === "-") return null;
  if (v instanceof Date) return isNaN(v.getTime()) ? null : fmtDate(v);
  if (typeof v === "number") {
    const d = new Date(Math.round((v - 25569) * 86400 * 1000));
    return isNaN(d.getTime()) ? null : fmtDate(d);
  }
  const s = String(v).trim();
  const m = s.match(/(\d{4})[.\-\/](\d{1,2})[.\-\/](\d{1,2})/);
  if (m) return `${m[1]}-${m[2].padStart(2, "0")}-${m[3].padStart(2, "0")}`;
  return null;
}

function toNum(v) {
  if (v === null || v === undefined || v === "") return null;
  if (typeof v === "number") return v;
  const n = parseFloat(String(v).replace(/,/g, ""));
  return isNaN(n) ? null : n;
}

const _rowKeyCounts = {};
function salesRowKey(saleDateIso, seq, itemName, customer, totalAmount) {
  const base = `${saleDateIso}#${seq || 0}#${itemName || ""}|${customer || ""}|${totalAmount || 0}`;
  const occ = _rowKeyCounts[base] || 0;
  _rowKeyCounts[base] = occ + 1;
  return `${base}#${occ}`;
}

async function handleSalesUpload(file, logId) {
  document.getElementById(logId).textContent = "";
  for (const k in _rowKeyCounts) delete _rowKeyCounts[k];
  logTo(logId, `파일 읽는 중: ${file.name}`);
  try {
    const buf = await file.arrayBuffer();
    const wb = XLSX.read(buf, { type: "array", cellDates: true });
    const sheetName = wb.SheetNames[0];
    const ws = wb.Sheets[sheetName];
    const arr = XLSX.utils.sheet_to_json(ws, { header: 1, defval: null });

    let headerIdx = -1;
    for (let i = 0; i < Math.min(arr.length, 10); i++) {
      if (arr[i] && arr[i][0] === "일자") { headerIdx = i; break; }
    }
    if (headerIdx === -1) { logTo(logId, "오류: '일자' 헤더 행을 찾을 수 없습니다. 파일 형식을 확인해주세요."); return; }
    logTo(logId, `헤더 행 발견 (${headerIdx + 1}행). 데이터 파싱 중...`);

    const rows = [];
    for (let i = headerIdx + 1; i < arr.length; i++) {
      const r = arr[i];
      if (!r || !r[2]) continue; // no item name
      const dateCell = String(r[0] || "");
      const dm = dateCell.match(/(\d{4})\/(\d{2})\/(\d{2})\s*-?(\d+)?/);
      if (!dm) continue;
      const saleDate = `${dm[1]}-${dm[2]}-${dm[3]}`;
      const seq = dm[4] ? parseInt(dm[4], 10) : 0;
      const item = String(r[2]).trim();
      const customer = r[8] ? String(r[8]).trim() : null;
      const totalAmount = toNum(r[7]);
      rows.push({
        sale_date: saleDate, seq, manager: r[1] || null, item_name: item,
        qty: toNum(r[3]), unit_price: toNum(r[4]), supply_amount: toNum(r[5]),
        vat: toNum(r[6]), total_amount: totalAmount, customer,
        fx_currency: r[9] || null, fx_amount: toNum(r[10]), note: r[11] || null,
        row_key: salesRowKey(saleDate, seq, item, customer, totalAmount)
      });
    }
    logTo(logId, `총 ${rows.length}건 파싱 완료. 업로드 중...`);
    if (!rows.length) { logTo(logId, "업로드할 신규 행이 없습니다."); return; }

    const chunkSize = 500;
    let uploaded = 0;
    for (let i = 0; i < rows.length; i += chunkSize) {
      const chunk = rows.slice(i, i + chunkSize);
      const { error } = await sb.from("sales").upsert(chunk, { onConflict: "row_key", ignoreDuplicates: true });
      if (error) { logTo(logId, `오류 발생 (${i}건째): ${error.message}`); return; }
      uploaded += chunk.length;
      logTo(logId, `진행: ${uploaded} / ${rows.length}`);
    }
    logTo(logId, `완료. 중복 거래는 자동으로 무시되었습니다.`);
    toast("매출 데이터 업로드 완료", "success");
    await loadAllData(true);
  } catch (e) {
    logTo(logId, "오류: " + e.message);
  }
}

async function handleInventoryUpload(file, logId) {
  document.getElementById(logId).textContent = "";
  logTo(logId, `파일 읽는 중: ${file.name}`);
  try {
    const buf = await file.arrayBuffer();
    const peek = XLSX.read(buf, { type: "array", bookSheets: true });
    const dateRe = /재고수량\s*(\d{2})\.(\d{2})\.(\d{2})/;
    const sheetDates = peek.SheetNames
      .map(name => { const m = name.match(dateRe); return m ? { name, date: `20${m[1]}-${m[2]}-${m[3]}` } : null; })
      .filter(Boolean);
    if (!sheetDates.length) { logTo(logId, "오류: '재고수량 YY.MM.DD' 형식의 시트를 찾을 수 없습니다."); return; }
    sheetDates.sort((a, b) => a.date < b.date ? 1 : -1);
    const latest = sheetDates[0];
    logTo(logId, `총 ${sheetDates.length}개 날짜 시트 발견. 최신: ${latest.date}`);

    const { data: histMax } = await sb.from("inventory_history").select("snapshot_date").order("snapshot_date", { ascending: false }).limit(1);
    const lastKnown = histMax && histMax[0] ? histMax[0].snapshot_date : null;
    const toProcess = lastKnown ? sheetDates.filter(s => s.date > lastKnown) : sheetDates;
    logTo(logId, lastKnown ? `기존 이력 최신일: ${lastKnown}. 새 날짜 ${toProcess.length}개만 처리합니다.` : `기존 이력이 없어 전체를 처리합니다.`);

    const namesToRead = [...new Set([latest.name, ...toProcess.map(s => s.name)])];
    const wb = XLSX.read(buf, { type: "array", cellDates: true, sheets: namesToRead });

    const historyRows = [];
    let currentRows = null;
    for (const sd of (toProcess.some(s => s.name === latest.name) ? toProcess : [...toProcess, latest])) {
      const parsed = parseInventorySheet(wb.Sheets[sd.name], sd.date);
      if (sd.date === latest.date) currentRows = parsed;
      if (toProcess.some(s => s.name === sd.name)) historyRows.push(...parsed);
      logTo(logId, `시트 파싱: ${sd.name} (${parsed.length}개 품목)`);
    }
    if (!currentRows) currentRows = parseInventorySheet(wb.Sheets[latest.name], latest.date);

    if (historyRows.length) {
      logTo(logId, `이력 테이블 업로드 중... (${historyRows.length}행)`);
      for (let i = 0; i < historyRows.length; i += 500) {
        const chunk = historyRows.slice(i, i + 500).map(r => ({
          snapshot_date: r.snapshot_date, item_name: r.item_name, line_category: r.line_category,
          total_qty: r.total_qty, hq_qty: r.hq_qty, saeseoul_qty: r.saeseoul_qty, daejeon_qty: r.daejeon_qty
        }));
        const { error } = await sb.from("inventory_history").upsert(chunk, { onConflict: "snapshot_date,item_name" });
        if (error) { logTo(logId, "이력 업로드 오류: " + error.message); return; }
      }
    }

    const { data: existingCurrent } = await sb.from("inventory_current").select("snapshot_date").limit(1);
    const existingDate = existingCurrent && existingCurrent[0] ? existingCurrent[0].snapshot_date : null;
    if (existingDate && latest.date < existingDate) {
      logTo(logId, `건너뜀: 업로드된 파일의 최신 시트(${latest.date})가 현재 반영된 재고 기준일(${existingDate})보다 오래되었습니다. 현재고는 변경하지 않았습니다.`);
    } else {
      logTo(logId, `현재 재고(${latest.date}) 반영 중... (${currentRows.length}개 품목)`);
      const { error: delErr } = await sb.from("inventory_current").delete().neq("id", 0);
      if (delErr) { logTo(logId, "초기화 오류: " + delErr.message); return; }
      for (let i = 0; i < currentRows.length; i += 500) {
        const chunk = currentRows.slice(i, i + 500);
        const { error } = await sb.from("inventory_current").upsert(chunk, { onConflict: "item_name" });
        if (error) { logTo(logId, "현재고 업로드 오류: " + error.message); return; }
      }
    }
    logTo(logId, "완료.");
    toast("재고 데이터 업로드 완료", "success");
    await loadAllData(true);
  } catch (e) {
    logTo(logId, "오류: " + e.message);
  }
}

function parseInventorySheet(ws, snapshotDate) {
  if (!ws) return [];
  const arr = XLSX.utils.sheet_to_json(ws, { header: 1, defval: null });
  let headerIdx = -1;
  for (let i = 0; i < Math.min(arr.length, 8); i++) {
    if (arr[i] && arr[i][7] === "품목") { headerIdx = i; break; }
  }
  if (headerIdx === -1) return [];
  const rows = [];
  let lastLine = null;
  for (let i = headerIdx + 1; i < arr.length; i++) {
    const r = arr[i];
    if (!r) continue;
    const line = r[6] ? String(r[6]).trim() : null;
    if (line) lastLine = line;
    const item = r[7] ? String(r[7]).trim() : null;
    if (!item) continue;
    rows.push({
      snapshot_date: snapshotDate,
      line_category: lastLine,
      item_name: item,
      total_qty: toNum(r[8]),
      hq_qty: toNum(r[9]),
      saeseoul_qty: toNum(r[10]),
      shipped_qty: toNum(r[11]),
      daejeon_qty: toNum(r[12]),
      received_date: excelDateToIso(r[13]),
      expiry_date: excelDateToIso(r[14]),
      production_qty: toNum(r[15])
    });
  }
  const seen = new Map();
  for (const r of rows) seen.set(r.item_name, r);
  return [...seen.values()];
}
