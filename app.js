'use strict';

let mainChart = null;
// 計算済みデータをキャッシュ（年スライダーが参照する）
let calcCache = null;

const $ = id => document.getElementById(id);

// ── フォーマット ────────────────────────────────────────────
function fmt(v) {
  return '¥' + Math.round(v).toLocaleString('ja-JP');
}
function yenTick(v) {
  const m = v / 10000;
  if (Math.abs(m) >= 10000) return (m / 10000).toFixed(1) + '億円';
  return m.toLocaleString('ja-JP') + '万円';
}

// ── 元利均等返済 月々返済額 ─────────────────────────────────
function calcMonthlyPayment(principal, annualRate, months) {
  if (annualRate === 0) return principal / months;
  const r = annualRate / 12 / 100;
  const pow = Math.pow(1 + r, months);
  return principal * r * pow / (pow - 1);
}

// ── 年次残高・累積利息を計算 ─────────────────────────────────
function buildYearlyData(principal, annualRate, loanYears) {
  const result = [{ balance: principal, cumInterest: 0 }];
  if (annualRate === 0) {
    const monthly = principal / (loanYears * 12);
    let bal = principal;
    for (let y = 1; y <= loanYears; y++) {
      bal = Math.max(bal - monthly * 12, 0);
      result.push({ balance: bal, cumInterest: 0 });
    }
  } else {
    const r = annualRate / 12 / 100;
    const monthly = calcMonthlyPayment(principal, annualRate, loanYears * 12);
    let bal = principal;
    let cumInterest = 0;
    for (let y = 1; y <= loanYears; y++) {
      for (let m = 0; m < 12; m++) {
        const interest = bal * r;
        cumInterest += interest;
        bal = Math.max(bal - (monthly - interest), 0);
      }
      result.push({ balance: bal, cumInterest });
    }
  }
  return result;
}

// ── メイン計算（入力変更時に呼ばれる）──────────────────────
function update() {
  // 入力値取得
  const propertyPriceMan = parseFloat($('propertyPrice').value)    || 5000;
  const downPaymentMan   = parseFloat($('downPayment').value)      || 0;
  const annualRate       = parseFloat($('annualRate').value)       || 0;
  const loanYears        = parseInt($('loanYears').value)          || 35;
  const initialCostRate  = parseFloat($('initialCostRate').value)  || 6;
  const monthlyMgmtMan   = parseFloat($('monthlyMgmt').value)      || 0;
  const propertyTaxMan   = parseFloat($('propertyTax').value)      || 0;
  const sellCostRate     = parseFloat($('sellCostRate').value)     || 4;
  const assetRate        = parseFloat($('assetRate').value)        || 0;
  const monthlyRentMan   = parseFloat($('monthlyRent').value)      || 15;
  const rentIncreaseRate = parseFloat($('rentIncreaseRate').value) || 0;
  const renewalMonths    = parseFloat($('renewalMonths').value)    || 1;
  const renewalInterval  = parseInt($('renewalInterval').value)    || 2;

  // 派生値（円）
  const principalMan   = Math.max(propertyPriceMan - downPaymentMan, 0);
  const principal      = principalMan * 10000;
  const propertyYen    = propertyPriceMan * 10000;
  const downPaymentYen = downPaymentMan * 10000;
  const mgmtYen        = monthlyMgmtMan * 10000;
  const propTaxYen     = propertyTaxMan * 10000;
  const initialCostYen = propertyYen * initialCostRate / 100;
  const months         = loanYears * 12;
  const rentYen        = monthlyRentMan * 10000;

  // ラベル更新
  $('loanYearsVal').textContent   = loanYears;
  $('principalBadge').textContent = `借入額 ${principalMan.toLocaleString('ja-JP')} 万円`;

  $('zeroAlert').style.display = principal <= 0 ? '' : 'none';
  if (principal <= 0) return;

  // ── ① 月々の支払い ─────────────────────────────────────
  const monthlyLoan   = calcMonthlyPayment(principal, annualRate, months);
  const monthlyTotal  = monthlyLoan + mgmtYen + propTaxYen / 12;
  const totalLoanPay  = monthlyLoan * months;
  const totalInterest = totalLoanPay - principal;

  $('kpiLoan').textContent         = fmt(monthlyLoan);
  $('kpiMgmt').textContent         = fmt(mgmtYen);
  $('kpiTax').textContent          = fmt(propTaxYen / 12);
  $('kpiMonthlyTotal').textContent = fmt(monthlyTotal);
  $('summaryPrincipal').textContent= fmt(principal);
  $('summaryInterest').textContent = fmt(totalInterest);
  $('summaryTotal').textContent    = fmt(totalLoanPay);

  // ── 年次データ ──────────────────────────────────────────
  const years      = Array.from({ length: loanYears + 1 }, (_, i) => i);
  const yearlyData = buildYearlyData(principal, annualRate, loanYears);
  const assetValues = years.map(y => propertyYen * Math.pow(1 + assetRate / 100, y));
  const balances    = years.map(y => yearlyData[y].balance);
  const cumInterests= years.map(y => yearlyData[y].cumInterest);

  // ── ② チャート用データ ─────────────────────────────────
  // 購入実質損益（売却想定）
  const buyNetValues = years.map(y => {
    const sellCost = assetValues[y] * sellCostRate / 100;
    return assetValues[y]
      - propertyYen
      - initialCostYen
      - cumInterests[y]
      - mgmtYen * 12 * y
      - propTaxYen * y
      - sellCost;
  });

  // 賃貸累積支出（マイナス値）
  const cumRentByYear = [0];
  let cumRent = 0;
  for (let y = 1; y <= loanYears; y++) {
    const base = rentYen * Math.pow(1 + rentIncreaseRate / 100, y - 1);
    cumRent += base * 12;
    if (renewalMonths > 0 && y % renewalInterval === 0) cumRent += base * renewalMonths;
    cumRentByYear.push(cumRent);
  }
  const rentNegValues = cumRentByYear.map(v => -v);

  // 損益分岐点
  let crossoverYear = null;
  for (let i = 0; i < years.length; i++) {
    if (buyNetValues[i] - rentNegValues[i] >= 0) { crossoverYear = i; break; }
  }
  $('crossoverVal').textContent = crossoverYear !== null ? `${crossoverYear}年目〜` : '期間内なし';

  const rateSign = rentIncreaseRate >= 0 ? '+' : '';
  $('chartDesc').textContent =
    `賃貸: 月額${monthlyRentMan}万円 / 上昇率${rateSign}${rentIncreaseRate}%/年 / 更新料${renewalMonths}ヶ月分×${renewalInterval}年ごと　` +
    `購入: 資産価値${assetRate >= 0 ? '+' : ''}${assetRate}%/年 / 売却費用率${sellCostRate}%`;

  // ── キャッシュ保存 ─────────────────────────────────────
  calcCache = {
    loanYears,
    monthlyLoan,
    downPaymentYen,
    initialCostYen,
    mgmtYen,
    propTaxYen,
    sellCostRate,
    assetValues,
    balances,
    cumRentByYear,
    buyNetValues,
    rentNegValues,
    crossoverYear,
  };

  // 年スライダーの max を返済期間に合わせる
  const slider = $('sellYear');
  slider.max = loanYears;
  if (parseInt(slider.value) > loanYears) slider.value = loanYears;

  renderChart(years, buyNetValues, rentNegValues, parseInt(slider.value));
  updateYearDetail(parseInt(slider.value));
}

// ── 年スライダーで詳細を更新 ────────────────────────────────
function updateYearDetail(year) {
  if (!calcCache) return;

  const {
    sellCostRate,
    assetValues, balances, cumRentByYear, buyNetValues,
  } = calcCache;

  $('sellYearVal').textContent = year;

  const assetVal = assetValues[year];
  const balance  = balances[year];
  const sellCost = assetVal * sellCostRate / 100;
  const sellGain = assetVal - balance - sellCost;

  // 購入の実質損益を月数で割る（チャートのY値と同じ定義）
  const buyMonthly  = buyNetValues[year] / (year * 12);
  // 賃貸の月々平均コスト（正値＝支出）
  const rentMonthly = cumRentByYear[year] / (year * 12);

  // 売却結果
  $('dAssetValue').textContent = fmt(assetVal);
  $('dBalance').textContent    = fmt(balance);
  $('dSellCost').textContent   = fmt(sellCost);

  const gainEl = $('dSellGain');
  gainEl.textContent = fmt(sellGain);
  gainEl.className   = sellGain >= 0 ? 'pos' : 'neg';

  // 月々損益表示（購入はプラス=得、マイナス=損）
  const buyEl = $('dBuyCost');
  buyEl.textContent = fmt(buyMonthly);
  buyEl.className   = buyMonthly >= 0 ? 'pos' : 'neg';
  $('dRentCost').textContent = fmt(rentMonthly);

  // 判定：購入の月割り損益 + 賃貸の月々コスト > 0 なら購入が有利
  // （賃貸払いを免れた分 + 資産増減が、購入コストを上回るかどうか）
  const advantage = buyMonthly + rentMonthly;
  const verdictEl = $('dVerdict');
  if (Math.abs(advantage) < 500) {
    verdictEl.textContent = `ほぼ同等（差: ${fmt(Math.abs(advantage))}）`;
    verdictEl.className   = 'verdict even';
  } else if (advantage > 0) {
    verdictEl.textContent = `購入の方が月々 ${fmt(advantage)} 有利`;
    verdictEl.className   = 'verdict buy-wins';
  } else {
    verdictEl.textContent = `賃貸の方が月々 ${fmt(Math.abs(advantage))} 有利`;
    verdictEl.className   = 'verdict rent-wins';
  }

  // チャートの選択年ラインを更新
  if (mainChart) {
    mainChart._selectedYear = year;
    mainChart.update('none'); // アニメーションなし
  }
}

// ── チャート描画 ─────────────────────────────────────────────
function renderChart(years, buyNet, rentNeg, selectedYear) {
  if (mainChart) mainChart.destroy();

  // 選択年ライン + 損益分岐ラインを描くカスタムプラグイン
  const overlayPlugin = {
    id: 'overlay',
    afterDraw(chart) {
      const { ctx, scales: { x, y: yScale } } = chart;
      const sel      = chart._selectedYear ?? selectedYear;
      const crossover = calcCache?.crossoverYear ?? null;

      // 選択年ライン（オレンジ）
      if (sel != null && sel >= 0) {
        const xPos = x.getPixelForValue(sel);
        ctx.save();
        ctx.strokeStyle = '#FF6F00';
        ctx.lineWidth   = 2;
        ctx.setLineDash([4, 3]);
        ctx.beginPath();
        ctx.moveTo(xPos, yScale.top);
        ctx.lineTo(xPos, yScale.bottom);
        ctx.stroke();
        const label = `${sel}年`;
        ctx.font = 'bold 11px sans-serif';
        const tw = ctx.measureText(label).width;
        ctx.fillStyle = '#FF6F00';
        ctx.fillRect(xPos - tw / 2 - 4, yScale.bottom + 4, tw + 8, 16);
        ctx.fillStyle = '#fff';
        ctx.textAlign = 'center';
        ctx.fillText(label, xPos, yScale.bottom + 15);
        ctx.restore();
      }

      // 損益分岐ライン（緑）
      if (crossover != null) {
        const xPos = x.getPixelForValue(crossover);
        ctx.save();
        ctx.strokeStyle = '#2E7D32';
        ctx.lineWidth   = 1.5;
        ctx.setLineDash([6, 4]);
        ctx.beginPath();
        ctx.moveTo(xPos, yScale.top);
        ctx.lineTo(xPos, yScale.bottom);
        ctx.stroke();
        ctx.fillStyle = '#2E7D32';
        ctx.font      = 'bold 11px sans-serif';
        ctx.textAlign = 'left';
        ctx.fillText(`分岐 ${crossover}年`, xPos + 4, yScale.top + 14);
        ctx.restore();
      }
    },
  };

  mainChart = new Chart($('mainChart').getContext('2d'), {
    type: 'line',
    plugins: [overlayPlugin],
    data: {
      labels: years,
      datasets: [
        {
          label: '購入 実質損益（売却想定）',
          data: buyNet,
          borderColor: '#1565C0',
          backgroundColor: 'rgba(21,101,192,0.06)',
          borderWidth: 2.5,
          pointRadius: 2,
          fill: false,
        },
        {
          label: '賃貸 累積支出（マイナス値）',
          data: rentNeg,
          borderColor: '#E65100',
          backgroundColor: 'rgba(230,81,0,0.06)',
          borderWidth: 2.5,
          pointRadius: 2,
          fill: false,
        },
      ],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      interaction: { mode: 'index', intersect: false },
      plugins: {
        legend: {
          position: 'bottom',
          labels: { boxWidth: 12, font: { size: 11 } },
        },
        tooltip: {
          callbacks: {
            label: ctx =>
              `${ctx.dataset.label}: ¥${Math.round(ctx.raw).toLocaleString('ja-JP')}`,
            afterBody: items => {
              if (items.length < 2) return [];
              const diff = (items[0]?.raw ?? 0) - (items[1]?.raw ?? 0);
              return [`差（購入−賃貸）: ¥${Math.round(diff).toLocaleString('ja-JP')}`];
            },
          },
        },
      },
      scales: {
        x: {
          title: { display: true, text: '経過年数' },
          ticks: { font: { size: 11 } },
        },
        y: {
          title: { display: true, text: '金額（円）' },
          ticks: { callback: yenTick, font: { size: 11 } },
        },
      },
    },
  });

  mainChart._selectedYear = selectedYear;
}

// ── イベントリスナー ─────────────────────────────────────────
document.querySelectorAll('input:not(#sellYear)').forEach(el =>
  el.addEventListener('input', update)
);

$('sellYear').addEventListener('input', () => {
  const year = parseInt($('sellYear').value);
  updateYearDetail(year);
  if (mainChart) {
    mainChart._selectedYear = year;
    mainChart.update('none');
  }
});

$('sidebarToggle').addEventListener('click', () => {
  const body = $('sidebarBody');
  const open = body.classList.toggle('open');
  $('sidebarToggle').textContent = open ? '条件を入力 ▲' : '条件を入力 ▼';
});

$('propertyPrice').addEventListener('input', () => {
  const max = parseFloat($('propertyPrice').value) || 100000;
  $('downPayment').max = max;
  if (parseFloat($('downPayment').value) > max) $('downPayment').value = max;
});

// ── 初期描画 ──────────────────────────────────────────────────
update();
