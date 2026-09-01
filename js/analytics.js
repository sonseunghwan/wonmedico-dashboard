// ---------- text normalization & fuzzy item matching ----------

function normalizeName(s) {
  if (!s) return "";
  return String(s)
    .replace(/\[[^\]]*\]/g, " ")
    .replace(/[()（）]/g, " ")
    .replace(/new|NEW|New/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

function tokenize(s) {
  return normalizeName(s).split(/[\s\-\/,]+/).filter(t => t.length >= 2);
}

function tokenMatchScore(aTokens, bTokens) {
  if (!aTokens.length || !bTokens.length) return 0;
  const setB = new Set(bTokens);
  let hit = 0;
  for (const t of aTokens) if (setB.has(t)) hit++;
  return hit / Math.max(aTokens.length, bTokens.length);
}

const KNOWN_BRANDS = ["클라비안", "라비쥬", "라비뷰", "웰로", "welo", "liften", "리프텐", "헤어빔", "올리지오",
  "쁘띠글로우", "베케이션", "아큐덤", "크라이오덤", "오리지홈", "oligihome"];

function guessBrand(itemName) {
  const norm = normalizeName(itemName);
  for (const b of KNOWN_BRANDS) {
    if (norm.includes(b.toLowerCase())) return b;
  }
  const first = tokenize(itemName)[0];
  return first ? first : "기타";
}

let _matchCache = null;
function buildInventorySalesMatch(sales, inventory) {
  if (_matchCache) return _matchCache;
  const uniqueSalesNames = [...new Set(sales.map(s => s.item_name).filter(Boolean))];
  const salesTokenized = uniqueSalesNames.map(n => ({ name: n, tokens: tokenize(n) }));
  const map = {};
  for (const inv of inventory) {
    const invTokens = tokenize(inv.item_name);
    let matches = [];
    for (const s of salesTokenized) {
      const score = tokenMatchScore(invTokens, s.tokens);
      if (score >= 0.45) matches.push({ name: s.name, score });
    }
    matches.sort((a, b) => b.score - a.score);
    map[inv.item_name] = matches.map(m => m.name);
  }
  _matchCache = map;
  return map;
}

// ---------- date helpers ----------

function ymd(dateStr) {
  return dateStr ? dateStr.slice(0, 10) : null;
}
function monthKey(dateStr) {
  return dateStr ? dateStr.slice(0, 7) : null;
}
function yearOf(dateStr) {
  return dateStr ? parseInt(dateStr.slice(0, 4), 10) : null;
}

function filterByRange(sales, start, end) {
  return sales.filter(s => s.sale_date >= start && s.sale_date <= end);
}

function shiftRangeOneYearBack(start, end) {
  const s = new Date(start), e = new Date(end);
  s.setFullYear(s.getFullYear() - 1);
  e.setFullYear(e.getFullYear() - 1);
  return { start: fmtDate(s), end: fmtDate(e) };
}

// ---------- core sales aggregation ----------

function sumAmount(rows) {
  return rows.reduce((a, r) => a + (Number(r.total_amount) || 0), 0);
}
function sumQty(rows) {
  return rows.reduce((a, r) => a + (Number(r.qty) || 0), 0);
}

function computeOverviewKPIs(sales, range) {
  const cur = filterByRange(sales, range.start, range.end);
  const prevRange = shiftRangeOneYearBack(range.start, range.end);
  const prev = filterByRange(sales, prevRange.start, prevRange.end);

  const curRevenue = sumAmount(cur);
  const prevRevenue = sumAmount(prev);
  const yoy = prevRevenue > 0 ? ((curRevenue - prevRevenue) / prevRevenue) * 100 : null;

  const months = new Set(cur.map(r => monthKey(r.sale_date)));
  const monthlyAvg = months.size > 0 ? curRevenue / months.size : 0;

  const byProduct = groupSum(cur, "item_name");
  const topProduct = byProduct[0];

  const totalQty = sumQty(cur);
  const prevQty = sumQty(prev);
  const qtyYoy = prevQty > 0 ? ((totalQty - prevQty) / prevQty) * 100 : null;

  const productCount = new Set(cur.map(r => r.item_name)).size;
  const dealCount = cur.length;
  const avgDeal = dealCount > 0 ? curRevenue / dealCount : 0;

  const customerCount = new Set(cur.map(r => r.customer).filter(Boolean)).size;

  return {
    curRevenue, prevRevenue, yoy, monthlyAvg, topProduct, totalQty, qtyYoy,
    productCount, dealCount, avgDeal, customerCount, curRows: cur
  };
}

function groupSum(rows, key) {
  const m = new Map();
  for (const r of rows) {
    const k = r[key] || "(미지정)";
    if (!m.has(k)) m.set(k, { key: k, revenue: 0, qty: 0, count: 0 });
    const g = m.get(k);
    g.revenue += Number(r.total_amount) || 0;
    g.qty += Number(r.qty) || 0;
    g.count += 1;
  }
  return [...m.values()].sort((a, b) => b.revenue - a.revenue);
}

function computeMonthlySeries(sales, year) {
  const cur = new Array(12).fill(0);
  const prev = new Array(12).fill(0);
  for (const r of sales) {
    if (!r.sale_date) continue;
    const y = yearOf(r.sale_date);
    const m = parseInt(r.sale_date.slice(5, 7), 10) - 1;
    if (y === year) cur[m] += Number(r.total_amount) || 0;
    else if (y === year - 1) prev[m] += Number(r.total_amount) || 0;
  }
  return { cur, prev };
}

function computeProductRanking(sales, range, prevRange) {
  const cur = filterByRange(sales, range.start, range.end);
  const prev = filterByRange(sales, prevRange.start, prevRange.end);
  const curG = groupSum(cur, "item_name");
  const prevMap = new Map(groupSum(prev, "item_name").map(g => [g.key, g]));
  const totalRevenue = sumAmount(cur);
  let cum = 0;
  return curG.map((g, i) => {
    const p = prevMap.get(g.key);
    const growth = p && p.revenue > 0 ? ((g.revenue - p.revenue) / p.revenue) * 100 : null;
    const share = totalRevenue > 0 ? (g.revenue / totalRevenue) * 100 : 0;
    cum += share;
    return { rank: i + 1, ...g, growth, share, cumShare: cum, avgPrice: g.qty > 0 ? g.revenue / g.qty : 0 };
  });
}

function computeCustomerAnalysis(sales, range) {
  const cur = filterByRange(sales, range.start, range.end);
  const g = groupSum(cur, "customer");
  const totalRevenue = sumAmount(cur);

  const firstSeen = new Map();
  for (const r of sales) {
    const c = r.customer || "(미지정)";
    if (!firstSeen.has(c) || r.sale_date < firstSeen.get(c)) firstSeen.set(c, r.sale_date);
  }
  let newRevenue = 0, repeatRevenue = 0;
  for (const r of cur) {
    const c = r.customer || "(미지정)";
    if (firstSeen.get(c) >= range.start) newRevenue += Number(r.total_amount) || 0;
    else repeatRevenue += Number(r.total_amount) || 0;
  }

  const top5Share = totalRevenue > 0 ? (sumAmount2(g.slice(0, 5)) / totalRevenue) * 100 : 0;
  const top10Share = totalRevenue > 0 ? (sumAmount2(g.slice(0, 10)) / totalRevenue) * 100 : 0;

  return {
    ranking: g.map((row, i) => ({ rank: i + 1, ...row, share: totalRevenue > 0 ? (row.revenue / totalRevenue) * 100 : 0 })),
    totalRevenue, top5Share, top10Share, newRevenue, repeatRevenue,
    customerCount: g.length
  };
}
function sumAmount2(groups) { return groups.reduce((a, g) => a + g.revenue, 0); }

function computeManagerPerformance(sales, range) {
  const cur = filterByRange(sales, range.start, range.end);
  const totalRevenue = sumAmount(cur);
  return groupSum(cur, "manager").map((g, i) => ({
    rank: i + 1, ...g,
    share: totalRevenue > 0 ? (g.revenue / totalRevenue) * 100 : 0,
    avgDeal: g.count > 0 ? g.revenue / g.count : 0
  }));
}

function computeBrandBreakdown(sales, range) {
  const cur = filterByRange(sales, range.start, range.end);
  const totalRevenue = sumAmount(cur);
  const m = new Map();
  for (const r of cur) {
    const b = guessBrand(r.item_name);
    if (!m.has(b)) m.set(b, { key: b, revenue: 0, qty: 0 });
    const g = m.get(b);
    g.revenue += Number(r.total_amount) || 0;
    g.qty += Number(r.qty) || 0;
  }
  return [...m.values()]
    .sort((a, b) => b.revenue - a.revenue)
    .map(g => ({ ...g, share: totalRevenue > 0 ? (g.revenue / totalRevenue) * 100 : 0 }));
}

function computeLast12MonthsTrend(sales, endDate) {
  const end = new Date(endDate);
  const buckets = [];
  for (let i = 11; i >= 0; i--) {
    const d = new Date(end.getFullYear(), end.getMonth() - i, 1);
    buckets.push({ key: d.toISOString().slice(0, 7), revenue: 0, qty: 0 });
  }
  const idx = new Map(buckets.map((b, i) => [b.key, i]));
  for (const r of sales) {
    const k = monthKey(r.sale_date);
    if (idx.has(k)) {
      buckets[idx.get(k)].revenue += Number(r.total_amount) || 0;
      buckets[idx.get(k)].qty += Number(r.qty) || 0;
    }
  }
  return buckets;
}

function computeRecentMonthDetail(sales) {
  const latest = latestDataDateFromSales(sales);
  const mKey = latest.toISOString().slice(0, 7);
  const y = latest.getFullYear(), m = latest.getMonth();
  const prevMKey = new Date(y, m - 1, 1).toISOString().slice(0, 7);
  const prevYearMKey = new Date(y - 1, m, 1).toISOString().slice(0, 7);

  const cur = sales.filter(r => monthKey(r.sale_date) === mKey);
  const prevMonth = sales.filter(r => monthKey(r.sale_date) === prevMKey);
  const prevYear = sales.filter(r => monthKey(r.sale_date) === prevYearMKey);

  const curRevenue = sumAmount(cur);
  const momRevenue = sumAmount(prevMonth);
  const yoyRevenue = sumAmount(prevYear);

  const products = groupSum(cur, "item_name").slice(0, 5);
  const totalRevenue = curRevenue;
  return {
    monthLabel: `${y}년 ${m + 1}월`, mKey,
    curRevenue, momRevenue, yoyRevenue,
    momGrowth: momRevenue > 0 ? ((curRevenue - momRevenue) / momRevenue) * 100 : null,
    yoyGrowth: yoyRevenue > 0 ? ((curRevenue - yoyRevenue) / yoyRevenue) * 100 : null,
    dealCount: cur.length,
    products: products.map(p => ({ ...p, share: totalRevenue > 0 ? (p.revenue / totalRevenue) * 100 : 0 }))
  };
}

function latestDataDateFromSales(sales) {
  if (!sales.length) return new Date();
  let max = sales[0].sale_date;
  for (const r of sales) if (r.sale_date > max) max = r.sale_date;
  return new Date(max);
}

// ---------- inventory analytics ----------

function computeInventoryValuation(inventory, sales) {
  const matchMap = buildInventorySalesMatch(sales, inventory);
  const priceCache = {};
  for (const inv of inventory) {
    const names = matchMap[inv.item_name] || [];
    const rows = sales.filter(s => names.includes(s.item_name));
    const rows90 = rows.filter(r => r.sale_date >= isoDaysAgo(90));
    const source = rows90.length ? rows90 : rows;
    if (source.length) {
      const totalQty = sumQty(source);
      const totalRev = sumAmount(source);
      priceCache[inv.item_name] = totalQty > 0 ? totalRev / totalQty : null;
    } else {
      priceCache[inv.item_name] = null;
    }
  }
  return priceCache;
}

function isoDaysAgo(days) {
  const d = new Date();
  d.setDate(d.getDate() - days);
  return fmtDate(d);
}

function computeInventoryVelocity(inventory, sales, windowDays = 90) {
  const matchMap = buildInventorySalesMatch(sales, inventory);
  const since = isoDaysAgo(windowDays);
  return inventory.map(inv => {
    const names = matchMap[inv.item_name] || [];
    const recentRows = sales.filter(s => names.includes(s.item_name) && s.sale_date >= since);
    const soldQty = sumQty(recentRows);
    const dailyRate = soldQty / windowDays;
    const totalQty = Number(inv.total_qty) || 0;
    const daysOfStock = dailyRate > 0 ? totalQty / dailyRate : (totalQty > 0 ? Infinity : 0);
    let status = "normal";
    if (dailyRate === 0 && totalQty > 0) status = "no_recent_sales";
    else if (daysOfStock < 14) status = "reorder_urgent";
    else if (daysOfStock < 30) status = "reorder_soon";
    else if (daysOfStock > 365 && totalQty > 0) status = "overstock";
    return { item: inv, soldQty90: soldQty, dailyRate, daysOfStock, status, matched: names.length > 0 };
  });
}

function daysUntil(dateStr) {
  if (!dateStr) return null;
  const d = new Date(dateStr);
  if (isNaN(d.getTime())) return null;
  return daysBetween(new Date(new Date().toDateString()), d);
}

// ---------- inventory management (transactions, settings, reorder) ----------

const TX_TYPE_SIGN = {
  "입고": 1, "반품입고": 1, "조정(증가)": 1,
  "출고": -1, "폐기": -1, "조정(감소)": -1
};
const TX_TYPES = Object.keys(TX_TYPE_SIGN);

function computeEffectiveQtyMap(inventory, transactions) {
  const map = new Map();
  for (const inv of inventory) map.set(inv.item_name, Number(inv.total_qty) || 0);
  for (const tx of transactions) {
    const snap = inventory.find(i => i.item_name === tx.item_name);
    if (snap && tx.tx_date < snap.snapshot_date) continue;
    const sign = TX_TYPE_SIGN[tx.tx_type] ?? 0;
    const cur = map.has(tx.item_name) ? map.get(tx.item_name) : 0;
    map.set(tx.item_name, cur + sign * (Number(tx.qty) || 0));
  }
  return map;
}

function getItemSettingsMap(itemSettings) {
  return new Map(itemSettings.map(s => [s.item_name, s]));
}

function computeReorderSuggestions(inventory, effectiveQtyMap, settingsMap, velocity) {
  const velocityMap = new Map(velocity.map(v => [v.item.item_name, v]));
  const out = [];
  for (const inv of inventory) {
    const eff = effectiveQtyMap.get(inv.item_name) ?? (Number(inv.total_qty) || 0);
    const setting = settingsMap.get(inv.item_name);
    const v = velocityMap.get(inv.item_name);
    let reorderPoint, targetStock, basis;
    if (setting && setting.reorder_point !== null && setting.reorder_point !== undefined) {
      reorderPoint = Number(setting.reorder_point);
      targetStock = setting.target_stock !== null && setting.target_stock !== undefined ? Number(setting.target_stock) : reorderPoint * 2;
      basis = "설정값";
    } else if (v && v.dailyRate > 0) {
      const leadTime = setting?.lead_time_days || 14;
      const safety = setting?.safety_stock !== null && setting?.safety_stock !== undefined ? Number(setting.safety_stock) : v.dailyRate * 7;
      reorderPoint = v.dailyRate * leadTime + safety;
      targetStock = v.dailyRate * (leadTime + 30) + safety;
      basis = "판매속도 자동계산";
    } else if (eff <= 0) {
      reorderPoint = 0;
      targetStock = Number(inv.production_qty) > 0 ? Number(inv.production_qty) : 10;
      basis = "재고 소진 (판매 데이터 부족)";
    } else {
      continue;
    }
    if (eff <= reorderPoint) {
      out.push({
        item: inv, effectiveQty: eff, reorderPoint, targetStock, basis,
        suggestedOrderQty: Math.max(0, Math.round(targetStock - eff)),
        urgent: eff <= reorderPoint * 0.5
      });
    }
  }
  return out.sort((a, b) => (a.effectiveQty / (a.reorderPoint || 1)) - (b.effectiveQty / (b.reorderPoint || 1)));
}

function computeABCClass(cumShare) {
  if (cumShare <= 80) return "A";
  if (cumShare <= 95) return "B";
  return "C";
}

function computeCustomerLastPurchase(sales) {
  const map = new Map();
  for (const r of sales) {
    const c = r.customer || "(미지정)";
    if (!map.has(c) || r.sale_date > map.get(c)) map.set(c, r.sale_date);
  }
  return map;
}

function computeInventoryKPIs(inventory, sales) {
  const totalItems = inventory.length;
  const totalQty = inventory.reduce((a, r) => a + (Number(r.total_qty) || 0), 0);
  const hq = inventory.reduce((a, r) => a + (Number(r.hq_qty) || 0), 0);
  const saeseoul = inventory.reduce((a, r) => a + (Number(r.saeseoul_qty) || 0), 0);
  const daejeon = inventory.reduce((a, r) => a + (Number(r.daejeon_qty) || 0), 0);

  const expiringSoon = inventory.filter(r => {
    const d = daysUntil(r.expiry_date);
    return d !== null && d <= 90 && d >= 0;
  });
  const expired = inventory.filter(r => {
    const d = daysUntil(r.expiry_date);
    return d !== null && d < 0;
  });

  const priceMap = computeInventoryValuation(inventory, sales);
  let valuation = 0;
  let valuedCount = 0;
  for (const inv of inventory) {
    const p = priceMap[inv.item_name];
    if (p) { valuation += p * (Number(inv.total_qty) || 0); valuedCount++; }
  }

  return { totalItems, totalQty, hq, saeseoul, daejeon, expiringSoon, expired, valuation, valuedCount, priceMap };
}
