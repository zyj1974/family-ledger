/* 家账本 · 轻量 SVG 图表（无第三方依赖） */
(function (global) {
  'use strict';

  const INCOME = '#2f9e79';
  const EXPENSE = '#d1735a';
  const GRID = '#efeae1';
  const AXIS_TEXT = '#8b9188';

  function esc(value) {
    return String(value == null ? '' : value)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function money(n) {
    return Number(n || 0).toLocaleString('zh-CN', {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2
    });
  }

  function axisLabel(n) {
    if (n >= 10000) {
      const w = n / 10000;
      return (w >= 10 ? Math.round(w) : Math.round(w * 10) / 10) + '万';
    }
    return Math.round(n).toLocaleString('zh-CN');
  }

  function niceMax(value) {
    if (!(value > 0)) return 100;
    const rough = value / 5;
    const exp = Math.pow(10, Math.floor(Math.log10(rough)));
    const f = rough / exp;
    let mult;
    if (f <= 1) mult = 1;
    else if (f <= 2) mult = 2;
    else if (f <= 2.5) mult = 2.5;
    else if (f <= 5) mult = 5;
    else mult = 10;
    return mult * exp * 5;
  }

  function empty(container, text) {
    container.innerHTML = '<div class="chart-empty"><span>◌</span>' + esc(text) + '</div>';
  }

  /**
   * 分组柱状图：每月收入 / 支出
   * data: [{ label, income, expense }]
   */
  function trend(container, data, opts) {
    if (!container) return;
    opts = opts || {};
    data = Array.isArray(data) ? data : [];
    if (!data.length) { empty(container, '暂无数据'); return; }

    const width = Math.max(container.clientWidth || 600, 280);
    const height = opts.height || 240;
    const pad = { top: 16, right: 8, bottom: 28, left: 46 };
    const innerW = width - pad.left - pad.right;
    const innerH = height - pad.top - pad.bottom;
    const peak = data.reduce(function (max, d) {
      return Math.max(max, d.income || 0, d.expense || 0);
    }, 0);
    const max = niceMax(peak);
    const ticks = 5;
    const baseY = pad.top + innerH;
    const groupW = innerW / data.length;
    const barW = Math.max(4, Math.min(16, groupW * 0.24));
    const gap = Math.max(2, barW * 0.4);
    const showEvery = data.length > 8 ? 2 : 1;

    const parts = [];
    parts.push('<svg viewBox="0 0 ' + width + ' ' + height + '" width="' + width + '" height="' + height +
      '" role="img" aria-label="月度收支趋势">');

    for (let i = 0; i <= ticks; i++) {
      const y = baseY - (innerH * i / ticks);
      parts.push('<line x1="' + pad.left + '" x2="' + (width - pad.right) + '" y1="' + y + '" y2="' + y +
        '" stroke="' + (i === 0 ? '#e2ddd3' : GRID) + '" stroke-width="1"' +
        (i === 0 ? '' : ' stroke-dasharray="3 5"') + '/>');
      parts.push('<text x="' + (pad.left - 9) + '" y="' + (y + 4) +
        '" text-anchor="end" fill="' + AXIS_TEXT + '" font-size="11">' + axisLabel(max * i / ticks) + '</text>');
    }

    data.forEach(function (d, i) {
      const centerX = pad.left + groupW * i + groupW / 2;
      const incomeH = innerH * Math.min(1, (d.income || 0) / max);
      const expenseH = innerH * Math.min(1, (d.expense || 0) / max);
      const incomeX = centerX - gap / 2 - barW;
      const expenseX = centerX + gap / 2;

      if (incomeH > 0.5) {
        parts.push('<rect x="' + incomeX + '" y="' + (baseY - incomeH) + '" width="' + barW +
          '" height="' + incomeH + '" rx="' + Math.min(4, barW / 2) + '" fill="' + INCOME + '" opacity="0.92">' +
          '<title>' + esc(d.label) + ' 收入 ¥' + money(d.income) + '</title></rect>');
      } else {
        parts.push('<rect x="' + incomeX + '" y="' + (baseY - 1) + '" width="' + barW + '" height="1.5" rx="0.75" fill="' + INCOME + '" opacity="0.25"/>');
      }

      if (expenseH > 0.5) {
        parts.push('<rect x="' + expenseX + '" y="' + (baseY - expenseH) + '" width="' + barW +
          '" height="' + expenseH + '" rx="' + Math.min(4, barW / 2) + '" fill="' + EXPENSE + '" opacity="0.92">' +
          '<title>' + esc(d.label) + ' 支出 ¥' + money(d.expense) + '</title></rect>');
      } else {
        parts.push('<rect x="' + expenseX + '" y="' + (baseY - 1) + '" width="' + barW + '" height="1.5" rx="0.75" fill="' + EXPENSE + '" opacity="0.25"/>');
      }

      if (i % showEvery === 0 || i === data.length - 1) {
        parts.push('<text x="' + centerX + '" y="' + (height - 8) +
          '" text-anchor="middle" fill="' + AXIS_TEXT + '" font-size="11">' + esc(d.label) + '</text>');
      }
    });

    parts.push('</svg>');
    container.innerHTML = parts.join('');
  }

  /**
   * 环形图：分类占比
   * items: [{ name, amount, color }]
   */
  function donut(container, items, total, label) {
    if (!container) return;
    items = (items || []).filter(function (it) { return it.amount > 0; });
    total = Number(total || 0);
    if (!items.length || total <= 0) { empty(container, '暂无支出'); return; }

    const width = container.clientWidth || 280;
    const size = Math.round(Math.min(Math.max(width, 170), 204));
    const stroke = Math.max(16, Math.round(size * 0.1));
    const r = (size - stroke) / 2 - 2;
    const c = 2 * Math.PI * r;
    const cx = size / 2;
    const cy = size / 2;
    const gap = items.length > 1 ? 3 : 0;

    let offset = 0;
    const segments = items.map(function (it) {
      const frac = it.amount / total;
      const len = Math.max(0.5, frac * c - gap);
      const seg = '<circle cx="' + cx + '" cy="' + cy + '" r="' + r +
        '" fill="none" stroke="' + esc(it.color) + '" stroke-width="' + stroke +
        '" stroke-dasharray="' + len + ' ' + (c - len) + '" stroke-dashoffset="' + (-offset) +
        '" transform="rotate(-90 ' + cx + ' ' + cy + ')">' +
        '<title>' + esc(it.name) + ' ¥' + money(it.amount) + '</title></circle>';
      offset += frac * c;
      return seg;
    }).join('');

    const compact = total >= 100000
      ? '¥' + (total / 10000).toFixed(1) + '万'
      : '¥' + Math.round(total).toLocaleString('zh-CN');

    container.innerHTML =
      '<div class="donut-inner" style="width:' + size + 'px;height:' + size + 'px">' +
        '<svg viewBox="0 0 ' + size + ' ' + size + '" width="' + size + '" height="' + size + '" role="img" aria-label="' + esc(label) + '构成">' +
          '<circle cx="' + cx + '" cy="' + cy + '" r="' + r + '" fill="none" stroke="#f4f0e8" stroke-width="' + stroke + '"/>' +
          segments +
        '</svg>' +
        '<div class="donut-center"><span>' + esc(label) + '</span><strong>' + compact + '</strong></div>' +
      '</div>';
  }

  global.LedgerCharts = { trend: trend, donut: donut };
})(window);
