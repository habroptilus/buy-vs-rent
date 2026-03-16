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

// ── 月次返済スケジュールを年次サマリーに変換 ─────────────────
// 戻り値: 配列[y] = { balance, cumInterest } (y=0..loanYears)
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

// ── メイン計算 ───────────────────────────────────────────────
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
  const mgmtYen        = monthlyMgmtMan * 10000;
  const propTaxYen     = propertyTaxMan * 10000;
  const initialCostYen = propertyYen * initialCostRate / 100;
  const months         = loanYears * 12;

  // ラベル更新
  $('loanYearsVal').textContent  = loanYears;
  $('principalBadge').textContent = `借入額 ${principalMan.toLocaleString('ja-JP')} 万円`;

  $('zeroAlert').style.display = principal <= 0 ? '' : 'none';
  if (principal <= 0) return;

  // ── ① 月々の支払い ──────────────────────────────────────
  const monthlyLoan     = calcMonthlyPayment(principal, annualRate, months);
  const monthlyTotal    = monthlyLoan + mgmtYen + propTaxYen / 12;
  const totalLoanPay    = monthlyLoan * months;
  const totalInterest   = totalLoanPay - principal;

  $('kpiLoan').textContent        = fmt(monthlyLoan);
  $('kpiMgmt').textContent        = fmt(mgmtYen);
  $('kpiTax').textContent         = fmt(propTaxYen / 12);
  $('kpiMonthlyTotal').textContent= fmt(monthlyTotal);
  $('summaryPrincipal').textContent = fmt(principal);
  $('summaryInterest').textContent  = fmt(totalInterest);
  $('summaryTotal').textContent     = fmt(totalLoanPay);

  // ── 年次データ構築 ────────────────────────────────────────
  const years      = Array.from({ length: loanYears + 1 }, (_, i) => i);
  const yearlyData = buildYearlyData(principal, annualRate, loanYears);

  // 資産価値・残債
  const assetValues = years.map(y => propertyYen * Math.pow(1 + assetRate / 100, y));
  const balances    = years.map(y => yearlyData[y].balance);
  const cumInterests= years.map(y => yearlyData[y].cumInterest);

  // ── ② 累積コスト比較チャート用データ ────────────────────────
  // 購入実質損益（売却想定）= 資産価値 − 物件価格 − 初期費用 − 累積利息 − 累積管理費 − 累積固定資産税 − 売却費用
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
  const rentYen = monthlyRentMan * 10000;
  let cumRent = 0;
  const cumRentByYear = [0]; // index=year
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

  // 損益分岐点表示
  $('crossoverVal').textContent = crossoverYear !== null ? `${crossoverYear}年目〜` : '期間内なし';

  const rateSign = rentIncreaseRate >= 0 ? '+' : '';
  $('chartDesc').textContent =
    `賃貸条件: 月額${monthlyRentMan}万円 / 上昇率${rateSign}${rentIncreaseRate}%/年 / 更新料${renewalMonths}ヶ月分×${renewalInterval}年ごと　　` +
    `購入条件: 資産価値${assetRate >= 0 ? '+' : ''}${assetRate}%/年 / 売却費用率${sellCostRate}%`;

  renderChart(years, buyNetValues, rentNegValues, crossoverYear);

  // ── ③ 売却年別・実質月々コスト比較テーブル ───────────────────
  //
  // 購入の実質月々コスト（Y年後売却想定）
  //   = （総支払額 − 売却で回収した額） ÷ 居住月数
  //   総支払額 = 頭金 + 初期費用 + ローン返済累計(Y年分) + 管理費累計 + 固定資産税累計 + 売却費用
  //   売却回収 = 資産価値(Y年後)
  //   ※ 頭金 + ローン返済累計(Y年分) = downPayment×10000 + monthlyLoan×Y×12
  //      = (propertyYen - principal) + monthlyLoan×Y×12
  //
  // 賃貸の月々平均コスト（Y年間）
  //   = 賃貸累積支出(Y年) ÷ (Y × 12)

  const tableRows = years.filter(y => y > 0).map(y => {
    const downPaymentYen = downPaymentMan * 10000;
    const loanRepaidTotal = monthlyLoan * y * 12; // ローン返済累計（元金＋利息）
    const sellCost = assetValues[y] * sellCostRate / 100;

    const totalOut = downPaymentYen + initialCostYen + loanRepaidTotal
      + mgmtYen * 12 * y + propTaxYen * y + sellCost;
    const totalIn  = assetValues[y];
    const netCost  = totalOut - totalIn;
    const buyMonthlyCost = netCost / (y * 12);

    const rentMonthlyCost = cumRentByYear[y] / (y * 12);
    const diff = buyMonthlyCost - rentMonthlyCost;
    const isCrossover = y === crossoverYear;

    return { y, buyMonthlyCost, rentMonthlyCost, diff, assetValues, balances, isCrossover };
  });

  renderTable(tableRows, assetValues, balances);
}

// ── チャート描画 ─────────────────────────────────────────────
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

  // 損益分岐点に縦線を追加（アノテーション不要・シンプルにプラグインで対応）
  if (crossoverYear !== null) {
    const plugin = {
      id: 'crossoverLine',
      afterDraw(chart) {
        const { ctx, scales: { x, y: yScale } } = chart;
        const xPos = x.getPixelForValue(crossoverYear);
        ctx.save();
        ctx.strokeStyle = '#43A047';
        ctx.lineWidth   = 1.5;
        ctx.setLineDash([6, 4]);
        ctx.beginPath();
        ctx.moveTo(xPos, yScale.top);
        ctx.lineTo(xPos, yScale.bottom);
        ctx.stroke();
        ctx.fillStyle  = '#43A047';
        ctx.font       = 'bold 11px sans-serif';
        ctx.textAlign  = 'left';
        ctx.fillText(`${crossoverYear}年`, xPos + 4, yScale.top + 14);
        ctx.restore();
      },
    };
    // 既存プラグインを置き換え（複数回呼ばれても1つだけ）
    const existIdx = mainChart.config.plugins?.findIndex(p => p.id === 'crossoverLine') ?? -1;
    if (existIdx >= 0) mainChart.config.plugins[existIdx] = plugin;
    else (mainChart.config.plugins ??= []).push(plugin);
    mainChart.update();
  }
}

// ── テーブル描画 ─────────────────────────────────────────────
function renderTable(rows, assetValues, balances) {
  const tbody = $('costTable').querySelector('tbody');
  tbody.innerHTML = rows.map(({ y, buyMonthlyCost, rentMonthlyCost, diff, isCrossover }) => {
    const diffClass = diff <= 0 ? 'pos' : 'neg'; // 購入コストが低い=お得=pos
    return `
      <tr class="${isCrossover ? 'crossover-row' : ''}">
        <td>${y}年後</td>
        <td class="${diff <= 0 ? 'pos' : ''}">${fmt(buyMonthlyCost)}</td>
        <td>${fmt(rentMonthlyCost)}</td>
        <td class="${diffClass}">${fmt(diff)}</td>
        <td>${fmt(assetValues[y])}</td>
        <td>${fmt(balances[y])}</td>
      </tr>`;
  }).join('');
}

// ── イベントリスナー ─────────────────────────────────────────
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
});

// ── 初期描画 ──────────────────────────────────────────────────
update();
