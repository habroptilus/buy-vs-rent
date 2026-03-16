'use strict';

let mainChart = null;
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

// ── 年末残高テーブル（年次のみ）──────────────────────────────
function buildYearlyBalances(principal, annualRate, loanYears) {
  const balances = [principal];
  const monthly = calcMonthlyPayment(principal, annualRate, loanYears * 12);

  if (annualRate === 0) {
    const repayPerMonth = principal / (loanYears * 12);
    for (let y = 1; y <= loanYears; y++) {
      balances.push(Math.max(principal - repayPerMonth * y * 12, 0));
    }
  } else {
    const r = annualRate / 12 / 100;
    let bal = principal;
    for (let y = 1; y <= loanYears; y++) {
      for (let m = 0; m < 12; m++) {
        const interest = bal * r;
        bal = Math.max(bal - (monthly - interest), 0);
      }
      balances.push(bal);
    }
  }
  return balances; // length = loanYears + 1
}

// ── メイン計算 ───────────────────────────────────────────────
function update() {
  // 入力値
  const propertyPriceMan  = parseFloat($('propertyPrice').value)   || 5000;
  const downPaymentMan    = parseFloat($('downPayment').value)     || 0;
  const annualRate        = parseFloat($('annualRate').value)      || 0;
  const loanYears         = parseInt($('loanYears').value)         || 35;

  const initialCostRate   = parseFloat($('initialCostRate').value) || 6;
  const monthlyMgmtMan    = parseFloat($('monthlyMgmt').value)     || 0;
  const propertyTaxMan    = parseFloat($('propertyTax').value)     || 0;
  const sellCostRate      = parseFloat($('sellCostRate').value)    || 4;
  const assetRate         = parseFloat($('assetRate').value)       || 0;

  const monthlyRentMan    = parseFloat($('monthlyRent').value)     || 15;
  const rentIncreaseRate  = parseFloat($('rentIncreaseRate').value)|| 0;
  const renewalMonths     = parseFloat($('renewalMonths').value)   || 1;
  const renewalInterval   = parseInt($('renewalInterval').value)   || 2;

  // 派生（円換算）
  const principalMan    = Math.max(propertyPriceMan - downPaymentMan, 0);
  const principal       = principalMan * 10000;
  const propertyYen     = propertyPriceMan * 10000;
  const mgmtYen         = monthlyMgmtMan * 10000;
  const propTaxYen      = propertyTaxMan * 10000;
  const initialCostYen  = propertyYen * initialCostRate / 100;
  const months          = loanYears * 12;

  // ラベル更新
  $('loanYearsVal').textContent = loanYears;
  $('principalBadge').textContent = `借入額 ${principalMan.toLocaleString('ja-JP')} 万円`;

  // 借入額0チェック
  $('zeroAlert').style.display = principal <= 0 ? '' : 'none';
  if (principal <= 0) return;

  // 月々返済額
  const monthlyLoan  = calcMonthlyPayment(principal, annualRate, months);
  const monthlyBuy   = monthlyLoan + mgmtYen + propTaxYen / 12;
  const monthlyRent  = monthlyRentMan * 10000;
  const renewalAnnual = renewalMonths > 0
    ? (monthlyRent * renewalMonths) / renewalInterval / 12
    : 0;
  const monthlyRentTotal = monthlyRent + renewalAnnual;

  // 月々コスト比較 更新
  $('cLoan').textContent     = fmt(monthlyLoan);
  $('cMgmt').textContent     = fmt(mgmtYen);
  $('cTax').textContent      = fmt(propTaxYen / 12);
  $('cBuyTotal').textContent = fmt(monthlyBuy);
  $('cRent').textContent     = fmt(monthlyRent);
  $('cRenewal').textContent  = fmt(renewalAnnual);
  $('cRentTotal').textContent= fmt(monthlyRentTotal);

  // 年次データ
  const years = Array.from({ length: loanYears + 1 }, (_, i) => i);
  const balances = buildYearlyBalances(principal, annualRate, loanYears);

  const assetValues  = years.map(y => propertyYen * Math.pow(1 + assetRate / 100, y));

  // 購入実質損益（売却想定）
  // 累積利息は年次で近似（精度より軽量化優先）
  const cumInterests = years.map(y => {
    const totalPaid = monthlyLoan * y * 12;
    const principalRepaid = principal - balances[y];
    return Math.max(totalPaid - principalRepaid, 0);
  });

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
  const cumRentByYear = { 0: 0 };
  let cumRent = 0;
  for (let y = 1; y <= loanYears; y++) {
    const base = monthlyRent * Math.pow(1 + rentIncreaseRate / 100, y - 1);
    cumRent += base * 12;
    if (renewalMonths > 0 && y % renewalInterval === 0) cumRent += base * renewalMonths;
    cumRentByYear[y] = cumRent;
  }
  const rentNegValues = years.map(y => -(cumRentByYear[y] ?? 0));

  // 損益分岐点
  let crossoverYear = null;
  for (let i = 0; i < years.length; i++) {
    if (buyNetValues[i] - rentNegValues[i] >= 0) { crossoverYear = i; break; }
  }

  // ヒーローカード更新
  if (crossoverYear !== null) {
    $('heroCrossover').textContent = `${crossoverYear}年目〜`;
    $('heroSub').textContent = `${crossoverYear}年以降に売却すると、賃貸より有利になります`;
  } else {
    $('heroCrossover').textContent = '期間内なし';
    $('heroSub').textContent = `${loanYears}年の返済期間内に購入が賃貸を上回ることはありません`;
  }

  // グラフ説明文
  const rateSign = rentIncreaseRate >= 0 ? '+' : '';
  $('chartDesc').textContent =
    `購入実質損益 ＝ 資産価値 − 物件価格 − 諸費用 − 累積利息 − 累積管理費 − 累積固定資産税 − 売却費用　／　` +
    `賃貸累積支出 ＝ 月額賃料（上昇率 ${rateSign}${rentIncreaseRate}%/年）＋ 更新料 ${renewalMonths}ヶ月分/${renewalInterval}年ごと`;

  // チャート更新
  renderChart(years, buyNetValues, rentNegValues, crossoverYear);

  // テーブル更新
  renderTable(years, assetValues, balances, buyNetValues, rentNegValues, crossoverYear);
}

// ── チャート ─────────────────────────────────────────────────
function renderChart(years, buyNet, rentNeg, crossoverYear) {
  if (mainChart) mainChart.destroy();

  mainChart = new Chart($('mainChart').getContext('2d'), {
    type: 'line',
    data: {
      labels: years,
      datasets: [
        {
          label: '購入 実質損益（売却想定）',
          data: buyNet,
          borderColor: '#1565C0',
          backgroundColor: 'rgba(21,101,192,0.07)',
          borderWidth: 2.5,
          pointRadius: 2,
          fill: false,
        },
        {
          label: '賃貸 累積支出（マイナス表示）',
          data: rentNeg,
          borderColor: '#E65100',
          backgroundColor: 'rgba(230,81,0,0.07)',
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
            label: ctx => `${ctx.dataset.label}: ¥${Math.round(ctx.raw).toLocaleString('ja-JP')}`,
            afterBody: items => {
              const diff = (items[0]?.raw ?? 0) - (items[1]?.raw ?? 0);
              return [`差（購入−賃貸）: ¥${Math.round(diff).toLocaleString('ja-JP')}`];
            },
          },
        },
        annotation: crossoverYear !== null ? {
          annotations: {
            crossLine: {
              type: 'line',
              scaleID: 'x',
              value: crossoverYear,
              borderColor: '#43A047',
              borderWidth: 2,
              borderDash: [6, 4],
              label: {
                display: true,
                content: `損益分岐 ${crossoverYear}年`,
                position: 'start',
                backgroundColor: '#43A047',
                color: '#fff',
                font: { size: 11 },
              },
            },
          },
        } : {},
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
}

// ── テーブル ─────────────────────────────────────────────────
function renderTable(years, assetValues, balances, buyNet, rentNeg, crossoverYear) {
  const tbody = $('yearTable').querySelector('tbody');
  tbody.innerHTML = years.map(y => {
    const diff = buyNet[y] - rentNeg[y];
    const isCross = y === crossoverYear;
    return `
      <tr class="${isCross ? 'crossover' : ''}">
        <td>${y}年</td>
        <td>${fmt(assetValues[y])}</td>
        <td>${fmt(balances[y])}</td>
        <td class="${buyNet[y] >= 0 ? 'positive' : 'negative'}">${fmt(buyNet[y])}</td>
        <td class="negative">${fmt(rentNeg[y])}</td>
        <td class="${diff >= 0 ? 'positive' : 'negative'}">${fmt(diff)}</td>
      </tr>`;
  }).join('');
}

// ── イベント ─────────────────────────────────────────────────
document.querySelectorAll('input').forEach(el => el.addEventListener('input', update));

$('sidebarToggle').addEventListener('click', () => {
  const body = $('sidebarBody');
  const open = body.classList.toggle('open');
  $('sidebarToggle').textContent = open ? '条件を入力 ▲' : '条件を入力 ▼';
});

$('propertyPrice').addEventListener('input', () => {
  const max = parseFloat($('propertyPrice').value) || 100000;
  $('downPayment').max = max;
  if (parseFloat($('downPayment').value) > max) $('downPayment').value = max;
  update();
});

// ── 初期描画 ──────────────────────────────────────────────────
update();
