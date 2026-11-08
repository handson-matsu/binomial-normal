'use strict';

// Mode-centered recurrence avoids factorial overflow and cancellation in the tails.
function binomialProbabilities(n, p) {
  const mode = Math.min(n, Math.floor((n + 1) * p));
  const values = new Float64Array(n + 1);
  values[mode] = 1;
  for (let k = mode; k > 0; k--) values[k - 1] = values[k] * k / (n - k + 1) * (1 - p) / p;
  for (let k = mode; k < n; k++) values[k + 1] = values[k] * (n - k) / (k + 1) * p / (1 - p);
  // Compensated summation, followed by normalization.
  let total = 0, correction = 0;
  for (const value of values) {
    const y = value - correction, next = total + y;
    correction = (next - total) - y;
    total = next;
  }
  for (let k = 0; k <= n; k++) values[k] /= total;
  return values;
}

// Upper standard-normal tail. The incomplete-gamma series / continued fraction
// is evaluated to near double precision. Tail differences avoid 1 - CDF cancellation.
function normalTail(z) {
  if (z === 0) return 0.5;
  if (z === Infinity) return 0;
  const x = z * z / 2;
  const factor = Math.exp(-x + 0.5 * Math.log(x) - 0.5 * Math.log(Math.PI));
  if (x < 1.5) {
    let term = 2, sum = term;
    for (let j = 1; j < 300; j++) {
      term *= x / (j + 0.5);
      sum += term;
      if (Math.abs(term) < Math.abs(sum) * 2e-16) break;
    }
    return Math.max(0, 0.5 * (1 - factor * sum));
  }
  let b = x + 0.5, c = 1e300, d = 1 / b, h = d;
  for (let j = 1; j < 300; j++) {
    const a = -j * (j - 0.5);
    b += 2;
    d = a * d + b;
    if (Math.abs(d) < 1e-300) d = 1e-300;
    c = b + a / c;
    if (Math.abs(c) < 1e-300) c = 1e-300;
    d = 1 / d;
    const delta = d * c;
    h *= delta;
    if (Math.abs(delta - 1) < 4e-16) break;
  }
  return Math.max(0, 0.5 * factor * h);
}
function normalCDF(z) { return z < 0 ? normalTail(-z) : 1 - normalTail(z); }
function normalInterval(a, b) {
  if (a >= 0) return Math.max(0, normalTail(a) - normalTail(b));
  if (b <= 0) return Math.max(0, normalTail(-b) - normalTail(-a));
  return Math.max(0, 1 - normalTail(-a) - normalTail(b));
}
function standardDensity(z) { return Math.exp(-z * z / 2) / Math.sqrt(2 * Math.PI); }

const $ = id => document.getElementById(id);
const state = { n: 20, p: 0.5, mode: 'normal', range: 'focus', min: 0, max: 20,
  selected: 10, digits: 6, curve: true, correction: true, playing: false, speed: 10 };
let probabilities, approximations, mean, variance, sd, timer = null, plot = null;
let tableCells = [], tableHeaders = [], resizeFrame = null, animationStarted = false;
const number = (x, digits = 4) => x.toLocaleString('ja-JP', { maximumFractionDigits: digits });
function probabilityText(x, digits = 10) {
  return x !== 0 && Math.abs(x) < 10 ** -digits ? x.toExponential(6) : x.toFixed(digits);
}
function recalculate() {
  mean = state.n * state.p;
  variance = mean * (1 - state.p);
  sd = Math.sqrt(variance);
  probabilities = binomialProbabilities(state.n, state.p);
  approximations = Float64Array.from(probabilities, (_, k) => normalInterval((k - 0.5 - mean) / sd, (k + 0.5 - mean) / sd));
}
function setAutomaticRange() {
  if (state.range === 'custom') return;
  if (state.mode === 'standard') {
    [state.min, state.max] = state.range === 'full' ? [(-0.5 - mean) / sd, (state.n + 0.5 - mean) / sd] : [-4, 4];
  } else {
    [state.min, state.max] = state.range === 'full' ? [-0.5, state.n + 0.5] : [Math.max(-0.5, Math.floor(mean - 4 * sd) - 0.5), Math.min(state.n + 0.5, Math.ceil(mean + 4 * sd) + 0.5)];
  }
}
function syncRangeControls() {
  $('xMin').value = Number(state.min.toFixed(6));
  $('xMax').value = Number(state.max.toFixed(6));
  $('focusRange').setAttribute('aria-pressed', state.range === 'focus');
  $('fullRange').setAttribute('aria-pressed', state.range === 'full');
  $('focusRange').textContent = state.mode === 'standard' ? '−4 〜 4' : '平均周辺';
  $('rangeError').textContent = '';
}
function updateParameters(n, p) {
  state.n = n; state.p = p;
  state.selected = Math.round(n * p);
  recalculate(); setAutomaticRange();
  $('nInput').value = $('nSlider').value = n;
  $('pInput').value = $('pSlider').value = p;
  document.querySelectorAll('[data-n]').forEach(button => button.setAttribute('aria-pressed', +button.dataset.n === n));
  $('mean').textContent = number(mean);
  $('variance').textContent = number(variance);
  $('sd').textContent = number(sd);
  $('conditions').textContent = `np = ${number(mean, 2)}　n(1−p) = ${number(n * (1 - p), 2)}`;
  $('approxNote').textContent = Math.min(mean, n * (1 - p)) >= 10 ? '両方とも 10 以上。近似がよくなる目安です。' : '小さい指標があります。近似のずれに注目。';
  $('animationProgress').style.width = `${Math.max(0, Math.min(100, (n - 10) / 190 * 100))}%`;
  $('selectedK').max = n;
  syncRangeControls(); buildTable(); updateSelection(false); draw(); centerTable();
}
function buildTable() {
  const labels = ['k', 'P(X = k)', '正規近似値'];
  const body = document.createElement('tbody');
  tableCells = []; tableHeaders = [];
  for (let row = 0; row < 3; row++) {
    const tr = document.createElement('tr');
    const label = document.createElement('th');
    label.scope = 'row'; label.textContent = labels[row]; tr.append(label);
    for (let k = 0; k <= state.n; k++) {
      const cell = document.createElement(row === 0 ? 'th' : 'td');
      cell.dataset.k = k;
      if (row === 0) {
        cell.scope = 'col';
        const button = document.createElement('button');
        button.textContent = k;
        button.setAttribute('aria-label', `成功回数 ${k} を選択`);
        cell.append(button); tableHeaders.push(button);
      } else cell.textContent = (row === 1 ? probabilities[k] : approximations[k]).toFixed(state.digits);
      if (!tableCells[k]) tableCells[k] = [];
      tableCells[k].push(cell); tr.append(cell);
    }
    body.append(tr);
  }
  $('distributionTable').tBodies[0].replaceWith(body);
  const sum = probabilities.reduce((a, b) => a + b, 0);
  $('sumCheck').textContent = `二項確率の総和 = ${sum.toFixed(12)}　${Math.abs(sum - 1) < 1e-12 ? '✓' : '要確認'}`;
  $('columnCount').textContent = `k = 0 〜 ${state.n} · 全 ${state.n + 1} 列（集約なし）`;
}
function centerTable() {
  const scroller = $('tableScroller'), cell = tableCells[state.selected]?.[0];
  if (!cell) return;
  const stickyWidth = $('distributionTable').rows[0].cells[0].getBoundingClientRect().width;
  // offsetLeft is avoided because an ancestor may become the offset parent.
  const offset = cell.getBoundingClientRect().left - scroller.getBoundingClientRect().left + scroller.scrollLeft;
  scroller.scrollLeft = offset - stickyWidth - (scroller.clientWidth - stickyWidth - cell.getBoundingClientRect().width) / 2;
}
function updateSelection(scroll = true) {
  for (let k = 0; k < tableCells.length; k++) {
    const selected = k === state.selected;
    for (const cell of tableCells[k]) cell.classList.toggle('selected', selected);
    tableHeaders[k].setAttribute('aria-pressed', selected);
  }
  const k = state.selected, exact = probabilities[k], approx = approximations[k];
  $('selectedK').value = k;
  $('selectedZ').textContent = `標準化した位置 z = ${number((k - mean) / sd)}`;
  $('exactValue').textContent = probabilityText(exact);
  $('exactPercent').textContent = `${probabilityText(exact * 100, 6)} %`;
  $('approxValue').textContent = probabilityText(approx);
  $('intervalLabel').textContent = `P(${k - 0.5} ≤ Y ≤ ${k + 0.5})`;
  const diff = approx - exact;
  $('difference').textContent = `${diff > 0 ? '+' : ''}${probabilityText(diff, 8)}`;
  if (scroll) centerTable();
}
function selectK(k, reveal = true) {
  state.selected = Math.max(0, Math.min(state.n, Math.round(k)));
  // A table selection outside the viewport moves that viewport without changing its width.
  const center = state.mode === 'standard' ? (state.selected - mean) / sd : state.selected;
  if (reveal && (center < state.min || center > state.max)) {
    const width = state.max - state.min;
    state.min = center - width / 2; state.max = center + width / 2;
    state.range = 'custom'; syncRangeControls();
  }
  updateSelection(); draw();
}
function ticks(min, max, count, integer = false) {
  const raw = (max - min) / count;
  const base = 10 ** Math.floor(Math.log10(raw));
  let step = [1, 2, 2.5, 5, 10].find(x => x * base >= raw) * base;
  if (integer) step = Math.max(1, Math.ceil(step));
  const values = [];
  for (let x = Math.ceil(min / step) * step, i = 0; x <= max + step * 1e-8 && i < 100; x += step, i++) values.push(Math.abs(x) < step * 1e-8 ? 0 : x);
  return { values, step };
}
function axisNumber(x, step) {
  if (x === 0) return '0';
  if (Math.abs(x) < 0.0001 || Math.abs(x) >= 100000) return x.toExponential(1);
  return x.toFixed(Math.max(0, Math.min(7, -Math.floor(Math.log10(step)))));
}
function draw(target = $('chart'), exporting = false) {
  const width = exporting ? 1600 : Math.max(280, target.getBoundingClientRect().width);
  const height = exporting ? 760 : target.getBoundingClientRect().height;
  const ratio = exporting ? 1 : Math.min(window.devicePixelRatio || 1, 3);
  target.width = Math.round(width * ratio); target.height = Math.round(height * ratio);
  const ctx = target.getContext('2d'); ctx.scale(ratio, ratio);
  ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, width, height);
  const standard = state.mode === 'standard';
  const compact = width < 500;
  const margin = { left: compact ? 61 : 82, right: compact ? 15 : 28, top: exporting ? 155 : 37, bottom: 62 };
  const pw = width - margin.left - margin.right, ph = height - margin.top - margin.bottom;
  const xValue = k => standard ? (k - mean) / sd : k;
  const barWidth = standard ? 1 / sd : 1;
  let ymax = 0;
  for (let k = 0; k <= state.n; k++) if (xValue(k) + barWidth / 2 >= state.min && xValue(k) - barWidth / 2 <= state.max) ymax = Math.max(ymax, probabilities[k] * (standard ? sd : 1));
  const density = x => standard ? standardDensity(x) : standardDensity((x - mean) / sd) / sd;
  if (state.curve || state.correction) ymax = Math.max(ymax, density(Math.max(state.min, Math.min(state.max, standard ? 0 : mean))));
  ymax = Math.max(ymax * 1.16, 1e-8);
  const xt = ticks(state.min, state.max, Math.max(4, Math.floor(pw / 85)), !standard);
  const yt = ticks(0, ymax, 5);
  const x = v => margin.left + (v - state.min) / (state.max - state.min) * pw;
  const y = v => margin.top + ph - v / ymax * ph;
  if (!exporting) plot = { left: margin.left, right: width - margin.right, top: margin.top, bottom: height - margin.bottom, xValue, width, height };
  ctx.font = `${compact ? 11 : 14}px -apple-system, BlinkMacSystemFont, sans-serif`;
  ctx.textBaseline = 'middle';
  for (const value of yt.values) {
    ctx.strokeStyle = '#e3eaf1'; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(margin.left, y(value)); ctx.lineTo(width - margin.right, y(value)); ctx.stroke();
    ctx.fillStyle = '#60758a'; ctx.textAlign = 'right'; ctx.fillText(axisNumber(value, yt.step), margin.left - 10, y(value));
  }
  for (const value of xt.values) {
    ctx.strokeStyle = '#edf1f5'; ctx.beginPath(); ctx.moveTo(x(value), margin.top); ctx.lineTo(x(value), y(0)); ctx.stroke();
    ctx.fillStyle = '#60758a'; ctx.textAlign = 'center'; ctx.fillText(axisNumber(value, xt.step), x(value), y(0) + 21);
  }
  ctx.save(); ctx.beginPath(); ctx.rect(margin.left, margin.top, pw, ph); ctx.clip();
  // Draw every visible integer as its own bar, including subpixel widths. No buckets.
  for (let k = 0; k <= state.n; k++) {
    const center = xValue(k);
    if (center + barWidth / 2 < state.min || center - barWidth / 2 > state.max) continue;
    const left = x(center - barWidth / 2), right = x(center + barWidth / 2);
    const gap = Math.min(1.5, (right - left) * 0.08);
    const top = y(probabilities[k] * (standard ? sd : 1));
    ctx.fillStyle = k === state.selected ? '#174c82' : '#70a5da';
    ctx.fillRect(left + gap / 2, top, Math.max(0, right - left - gap), y(0) - top);
    if (k === state.selected) {
      ctx.strokeStyle = '#173b67'; ctx.lineWidth = 1.5;
      ctx.strokeRect(left + gap / 2, top, right - left - gap, y(0) - top);
    }
  }
  // True interval area, not a rectangle at the center density.
  const lo = Math.max(state.min, xValue(state.selected) - barWidth / 2);
  const hi = Math.min(state.max, xValue(state.selected) + barWidth / 2);
  if (state.correction && lo < hi) {
    ctx.beginPath(); ctx.moveTo(x(lo), y(0));
    const samples = Math.max(30, Math.ceil((x(hi) - x(lo)) / 2));
    for (let j = 0; j <= samples; j++) { const v = lo + (hi - lo) * j / samples; ctx.lineTo(x(v), y(density(v))); }
    ctx.lineTo(x(hi), y(0)); ctx.closePath(); ctx.fillStyle = 'rgba(235, 147, 111, 0.40)'; ctx.fill();
    ctx.setLineDash([4, 4]); ctx.strokeStyle = '#c5684b'; ctx.lineWidth = 1;
    for (const v of [lo, hi]) { ctx.beginPath(); ctx.moveTo(x(v), y(0)); ctx.lineTo(x(v), y(density(v))); ctx.stroke(); }
    ctx.setLineDash([]);
  }
  if (state.curve) {
    ctx.strokeStyle = '#d05b4e'; ctx.lineWidth = 2.8; ctx.beginPath();
    // Include a dense grid near the mean even in a very wide full-range plot.
    const points = new Set([state.min, state.max]);
    for (let j = 0; j <= Math.ceil(pw); j++) points.add(state.min + (state.max - state.min) * j / Math.ceil(pw));
    for (let j = -500; j <= 500; j++) { const v = standard ? j / 50 : mean + sd * j / 50; if (v > state.min && v < state.max) points.add(v); }
    let first = true;
    for (const v of [...points].sort((a, b) => a - b)) { if (first) ctx.moveTo(x(v), y(density(v))); else ctx.lineTo(x(v), y(density(v))); first = false; }
    ctx.stroke();
  }
  ctx.restore();
  ctx.strokeStyle = '#9fb1c3'; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(margin.left, margin.top); ctx.lineTo(margin.left, y(0)); ctx.lineTo(width - margin.right, y(0)); ctx.stroke();
  ctx.fillStyle = '#3f566f'; ctx.textAlign = 'left'; ctx.font = `${compact ? 11 : 14}px -apple-system, BlinkMacSystemFont, sans-serif`;
  ctx.fillText(standard ? '確率密度  P(X=k) × σ' : '確率 P(X=k) / 確率密度', margin.left, margin.top - 20);
  ctx.textAlign = 'center'; ctx.fillText(standard ? '標準化した値  z = (k − μ) / σ' : '成功回数 k', margin.left + pw / 2, height - 15);
  if (exporting) {
    ctx.textAlign = 'left'; ctx.fillStyle = '#19344f'; ctx.font = 'bold 29px sans-serif'; ctx.fillText(`二項分布と正規分布${standard ? ' — 標準化表示' : ''}`, 50, 38);
    ctx.font = '19px sans-serif'; ctx.fillText(`n = ${state.n}    p = ${state.p}    平均 μ = ${number(mean, 6)}    標準偏差 σ = ${number(sd, 6)}    選択 k = ${state.selected}`, 50, 78);
    ctx.fillStyle = '#70a5da'; ctx.fillRect(52, 104, 22, 13); ctx.fillStyle = '#476078'; ctx.font = '16px sans-serif'; ctx.fillText('二項分布', 84, 111);
    if (state.curve) { ctx.fillStyle = '#d05b4e'; ctx.fillRect(232, 109, 25, 3); ctx.fillStyle = '#476078'; ctx.fillText(standard ? '標準正規分布 N(0, 1)' : '正規分布 N(μ, σ²)', 268, 111); }
    if (state.correction) { ctx.fillStyle = '#f2c6b4'; ctx.fillRect(530, 104, 22, 13); ctx.fillStyle = '#476078'; ctx.fillText('連続補正の面積', 564, 111); }
  } else updateGraphNotes();
}
function updateGraphNotes() {
  $('curveLegend').hidden = !state.curve; $('areaLegend').hidden = !state.correction;
  $('curveLegend').lastChild.textContent = state.mode === 'standard' ? '標準正規分布 N(0, 1)' : '正規分布 N(μ, σ²)';
  let visible = 0;
  for (let k = 0; k <= state.n; k++) { const v = state.mode === 'standard' ? (k - mean) / sd : k; if (v >= state.min && v <= state.max) visible++; }
  $('rangeMessage').textContent = `中心が表示範囲内にある棒：${visible} / ${state.n + 1} 本。各整数の棒を個別に描画しています。${visible < state.n + 1 ? '範囲外の値は「全範囲」または表で確認できます。' : ''} 棒をタップ／グラフ上で ← → キーで選択。`;
  $('modeExplanation').textContent = state.mode === 'standard' ? '標準化：棒の中心は (k − μ) / σ、幅は 1 / σ、高さは P(X=k) × σ。棒の面積は元の確率のままです。「−4 〜 4」では n を変えても横軸を固定します。' : '通常表示：棒の幅は 1、高さは P(X=k)。赤い曲線の高さは確率密度です。連続補正で区間の面積を比較できます。';
  $('chart').setAttribute('aria-label', `n=${state.n}, p=${state.p} の${state.mode === 'standard' ? '標準化した' : ''}分布。選択中 k=${state.selected}, 二項確率 ${probabilityText(probabilities[state.selected])}, 正規近似 ${probabilityText(approximations[state.selected])}。左右の矢印キーで選択。`);
}
function setPlaying(playing) {
  clearInterval(timer); timer = null; state.playing = playing;
  $('play').textContent = playing ? 'Ⅱ 一時停止' : '▶ 再生';
  $('play').setAttribute('aria-pressed', playing);
  $('pInput').disabled = $('pSlider').disabled = playing;
  if (playing) timer = setInterval(() => {
    if (state.n >= 200) { setPlaying(false); $('status').textContent = 'n = 200 までの再生が完了しました。'; return; }
    updateParameters(state.n + 1, state.p);
    if (state.n === 200) { setPlaying(false); $('status').textContent = 'n = 200 までの再生が完了しました。'; }
  }, 1000 / state.speed);
}
function bindParameter(inputId, sliderId, type) {
  const apply = element => {
    const raw = element.valueAsNumber;
    if (!Number.isFinite(raw)) return;
    const valid = type === 'n' ? Number.isInteger(raw) && raw >= 1 && raw <= 1000 : raw >= 0.01 && raw <= 0.99;
    // Let users finish typing a temporarily out-of-range number.
    if (!valid) return;
    animationStarted = false; setPlaying(false); updateParameters(type === 'n' ? raw : state.n, type === 'p' ? raw : state.p);
  };
  for (const id of [inputId, sliderId]) {
    $(id).addEventListener('input', e => apply(e.target));
    $(id).addEventListener('change', e => {
      const raw = e.target.valueAsNumber;
      const val = Number.isFinite(raw) ? raw : state[type];
      const safe = type === 'n' ? Math.max(1, Math.min(1000, Math.round(val))) : Math.max(0.01, Math.min(0.99, val));
      animationStarted = false; setPlaying(false); updateParameters(type === 'n' ? safe : state.n, type === 'p' ? safe : state.p);
    });
  }
}
function initialize() {
  bindParameter('nInput', 'nSlider', 'n'); bindParameter('pInput', 'pSlider', 'p');
  document.querySelectorAll('[data-n]').forEach(button => button.addEventListener('click', () => { animationStarted = false; setPlaying(false); updateParameters(+button.dataset.n, state.p); }));
  for (const [id, mode] of [['normalMode', 'normal'], ['standardMode', 'standard']]) $(id).addEventListener('click', () => {
    state.mode = mode; state.range = 'focus'; setAutomaticRange(); syncRangeControls();
    $('normalMode').setAttribute('aria-pressed', mode === 'normal'); $('standardMode').setAttribute('aria-pressed', mode === 'standard'); draw();
  });
  $('showCurve').addEventListener('change', e => { state.curve = e.target.checked; draw(); });
  $('showCorrection').addEventListener('change', e => { state.correction = e.target.checked; draw(); });
  for (const [id, range] of [['focusRange', 'focus'], ['fullRange', 'full']]) $(id).addEventListener('click', () => { state.range = range; setAutomaticRange(); syncRangeControls(); draw(); });
  const applyRange = () => {
    const min = $('xMin').valueAsNumber, max = $('xMax').valueAsNumber;
    if (!Number.isFinite(min) || !Number.isFinite(max) || max <= min || max - min < 1e-6 || Math.max(Math.abs(min), Math.abs(max)) > 1000000) {
      $('rangeError').textContent = '最小値 < 最大値となる範囲を入力してください（幅は 0.000001 以上、値は ±1,000,000 以内）。'; return;
    }
    state.min = min; state.max = max; state.range = 'custom'; syncRangeControls(); draw();
  };
  $('applyRange').addEventListener('click', applyRange);
  for (const id of ['xMin', 'xMax']) $(id).addEventListener('keydown', e => { if (e.key === 'Enter') applyRange(); });
  $('selectedK').addEventListener('input', e => { const k = e.target.valueAsNumber; if (Number.isInteger(k) && k >= 0 && k <= state.n) selectK(k); });
  $('selectedK').addEventListener('change', e => selectK(Number.isFinite(e.target.valueAsNumber) ? e.target.valueAsNumber : state.selected));
  $('distributionTable').addEventListener('click', e => { const cell = e.target.closest('[data-k]'); if (cell) selectK(+cell.dataset.k); });
  $('distributionTable').addEventListener('keydown', e => { if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') { e.preventDefault(); selectK(state.selected + (e.key === 'ArrowLeft' ? -1 : 1)); tableHeaders[state.selected].focus({ preventScroll: true }); } });
  $('scrollSelected').addEventListener('click', centerTable);
  $('chart').addEventListener('click', e => {
    if (!plot) return;
    const rect = $('chart').getBoundingClientRect(), px = e.clientX - rect.left, py = e.clientY - rect.top;
    if (px < plot.left || px > plot.right || py < plot.top || py > plot.bottom) return;
    const value = state.min + (px - plot.left) / (plot.right - plot.left) * (state.max - state.min);
    const k = Math.round(state.mode === 'standard' ? value * sd + mean : value);
    if (k >= 0 && k <= state.n) selectK(k, false);
  });
  $('chart').addEventListener('keydown', e => { if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') { e.preventDefault(); selectK(state.selected + (e.key === 'ArrowLeft' ? -1 : 1)); } });
  $('precision').addEventListener('change', e => { state.digits = +e.target.value; const scroll = $('tableScroller').scrollLeft; buildTable(); updateSelection(false); $('tableScroller').scrollLeft = scroll; });
  $('play').addEventListener('click', () => {
    if (state.playing) { setPlaying(false); $('status').textContent = '一時停止しました。'; }
    else { if (!animationStarted || state.n < 10 || state.n >= 200) updateParameters(10, state.p); animationStarted = true; setPlaying(true); $('status').textContent = 'n を増やしています。p は固定です。'; }
  });
  $('reset').addEventListener('click', () => { setPlaying(false); updateParameters(10, state.p); $('status').textContent = 'n = 10 にリセットしました。'; });
  $('speed').addEventListener('change', e => { state.speed = +e.target.value; if (state.playing) setPlaying(true); });
  $('save').addEventListener('click', () => {
    const filename = `binomial-normal_n${state.n}_p${state.p}_${state.mode}.png`;
    const canvas = document.createElement('canvas'); draw(canvas, true);
    canvas.toBlob(blob => {
      if (!blob) { $('status').textContent = 'PNGを作成できませんでした。'; return; }
      const url = URL.createObjectURL(blob), link = document.createElement('a');
      link.href = url; link.download = filename;
      document.body.append(link); link.click(); link.remove();
      setTimeout(() => URL.revokeObjectURL(url), 60000);
      $('status').textContent = 'PNGを作成しました。保存先を確認してください。';
    }, 'image/png');
  });
  new ResizeObserver(() => { cancelAnimationFrame(resizeFrame); resizeFrame = requestAnimationFrame(() => { draw(); centerTable(); }); }).observe($('chart').parentElement);
  document.addEventListener('visibilitychange', () => { if (document.hidden && state.playing) { setPlaying(false); $('status').textContent = '画面を離れたため一時停止しました。'; } });
  updateParameters(state.n, state.p);
}
if (typeof document !== 'undefined') initialize();

// Record one visit per page load without waiting for the response or retrying.
try {
  fetch('https://script.google.com/macros/s/AKfycbxssCIHsD-N97SHxNC_GN0ihYeC0qy-lb-EY0KmSs6Gnztaph1sITMerLVEnNWOGkYc/exec?app=binomial-normal', {
    method: 'GET',
    mode: 'no-cors',
    cache: 'no-store',
    credentials: 'omit',
    keepalive: true,
  }).catch(() => {});
} catch {
  // Access logging must never interrupt the app.
}
