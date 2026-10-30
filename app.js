/* ===================================================
   酒店比价助手 v2 — 定位 → 附近酒店 → 逐个平台比价
   =================================================== */
(function () {
  'use strict';

  const PLATFORMS = window.HPC_PLATFORMS;
  const CITIES = window.HPC_CITIES;
  const GEO = window.HPC_GEO;
  const $ = (s) => document.querySelector(s);
  const $$ = (s) => Array.prototype.slice.call(document.querySelectorAll(s));

  const LS = 'hpc.v2';

  /* ---------------- 状态 ---------------- */

  const state = {
    q: { checkin: '', checkout: '', rooms: 1, adults: 2, children: 0 },
    dest: '',
    place: null,        // { name, display, lat, lon, kind, city, key }
    hotels: [],         // 当前附近酒店
    hotelSource: 'overpass',
    hotel: null,        // 选中的酒店
    radius: 1000,
    listLimit: 15,
    prices: {},         // hotelKey -> { platformId: {amount, unit, note, at} }
    sort: 'price',
    settings: { currency: '¥', autocopy: true, cityId: '' },
    hist: []
  };

  function load() {
    try {
      const raw = localStorage.getItem(LS);
      if (!raw) return;
      const d = JSON.parse(raw);
      Object.assign(state.q, d.q || {});
      state.dest = d.dest || '';
      state.place = d.place || null;
      state.hotel = d.hotel || null;
      state.radius = d.radius || 1000;
      state.prices = d.prices || {};
      state.sort = d.sort || 'price';
      Object.assign(state.settings, d.settings || {});
      state.hist = d.hist || [];
    } catch (e) { }
  }

  function save() {
    try {
      localStorage.setItem(LS, JSON.stringify({
        q: state.q, dest: state.dest, place: state.place, hotel: state.hotel,
        radius: state.radius, prices: state.prices, sort: state.sort,
        settings: state.settings, hist: state.hist
      }));
    } catch (e) { }
  }

  /* ---------------- 工具 ---------------- */

  const iso = (d) => d.getFullYear() + '-' +
    String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');

  const parseDate = (s) => {
    const p = String(s).split('-').map(Number);
    return new Date(p[0], p[1] - 1, p[2]);
  };
  const addDays = (d, n) => { const x = new Date(d.getTime()); x.setDate(x.getDate() + n); return x; };

  const nightsOf = () => {
    if (!state.q.checkin || !state.q.checkout) return 1;
    const n = Math.round((parseDate(state.q.checkout) - parseDate(state.q.checkin)) / 864e5);
    return n > 0 ? n : 1;
  };

  const nf = new Intl.NumberFormat('zh-CN', { maximumFractionDigits: 0 });
  const num = (n) => nf.format(Math.round(n));
  const symbol = () => state.settings.currency || '¥';
  const money = (n) => symbol() + num(n);
  const fmtDist = (m) => (m < 1000 ? Math.round(m) + 'm' : (m / 1000).toFixed(1) + 'km');

  const esc = (s) => String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');

  const shortDate = (s) => {
    const p = String(s).split('-');
    return p.length === 3 ? `${+p[1]}/${+p[2]}` : s;
  };

  function ctx() {
    return {
      keyword: (state.hotel && state.hotel.name) || state.dest || '',
      checkin: state.q.checkin,
      checkout: state.q.checkout,
      rooms: Math.max(1, +state.q.rooms || 1),
      adults: Math.max(1, +state.q.adults || 1),
      children: Math.max(0, +state.q.children || 0),
      nights: nightsOf(),
      cityId: +state.settings.cityId || 0
    };
  }

  /* ---------------- 价格存取 ---------------- */

  function curKey() { return state.hotel ? state.hotel.key : 'none'; }
  function pricesMap() {
    const k = curKey();
    if (!state.prices[k]) state.prices[k] = {};
    return state.prices[k];
  }
  function bestFor(key) {
    const map = state.prices[key];
    if (!map) return null;
    const n = nightsOf();
    let best = null;
    PLATFORMS.forEach((p) => {
      const e = map[p.id];
      if (!e || !e.amount) return;
      const per = e.unit === 'night' ? e.amount : e.amount / n;
      if (!best || per < best.per) best = { p, per };
    });
    return best;
  }

  function computeStats(c) {
    const map = pricesMap();
    const rec = [];
    PLATFORMS.forEach((p) => {
      const e = map[p.id];
      if (!e || !e.amount) return;
      const per = e.unit === 'night' ? e.amount : e.amount / c.nights;
      const tot = e.unit === 'total' ? e.amount : e.amount * c.nights;
      rec.push({ p, per, tot });
    });
    const byPrice = rec.slice().sort((a, b) => a.per - b.per);
    return { rec, sorted: byPrice, min: byPrice[0] || null, max: byPrice[byPrice.length - 1] || null };
  }

  /* ===================================================
     首页
     =================================================== */

  function renderPlaceBox() {
    const box = $('#placeBox');

    if (!state.place) {
      box.innerHTML =
        '<div class="examples">' +
          '<span class="ex-label">试试</span>' +
          ['上海外滩', '北京国贸', '东京银座', '香港铜锣湾', '杭州西湖']
            .map((x) => `<button data-ex="${esc(x)}">${esc(x)}</button>`).join('') +
        '</div>';
      return;
    }

    const p = state.place;
    box.innerHTML =
      '<div class="place-chip">' +
        '<div class="pc-pin"><svg viewBox="0 0 24 24"><path d="M12 21s7-6.1 7-11a7 7 0 1 0-14 0c0 4.9 7 11 7 11Z"/><circle cx="12" cy="10" r="2.4"/></svg></div>' +
        '<div class="pc-txt">' +
          `<div class="pc-name">${esc(p.name)}</div>` +
          `<div class="pc-sub">${esc(p.display || p.city || '')}</div>` +
        '</div>' +
        '<button class="pc-change" id="btnChangePlace">换</button>' +
      '</div>';
  }

  function renderCandidates(list) {
    window.__cands = list;
    $('#placeBox').innerHTML =
      '<div class="card cands">' +
        '<h3 class="cand-h">选了哪个地方？</h3>' +
        list.map((p, i) =>
          `<button class="cand" data-ci="${i}">` +
            `<span class="cand-name">${esc(p.name)}</span>` +
            `<span class="cand-sub">${esc((p.display || '').slice(0, 60))}</span>` +
          '</button>').join('') +
      '</div>';
  }

  function showPlaceError(msg) {
    $('#placeBox').innerHTML = `<div class="card notice">${esc(msg)}</div>`;
  }

  function renderNearbyLoading() {
    $('#nearbyHead').hidden = false;
    $('#nearbyTitle').textContent = (state.place ? state.place.name : '') + ' 附近';
    $('#nearbyCount').textContent = '';
    $('#nearbyBox').innerHTML = [0, 1, 2, 3, 4].map(() =>
      '<div class="hotel-row skeleton"><div class="hr-main"><div class="sk-a"></div><div class="sk-b"></div></div></div>'
    ).join('');
  }

  function renderNearbyError(msg) {
    $('#nearbyBox').innerHTML =
      '<div class="card notice">' +
        '<b>没拉到酒店数据</b>' +
        `<p>${esc(msg || 'Overpass 公共接口可能繁忙，等几秒再试。')}</p>` +
        '<button class="mini-btn" id="btnRetryNearby">重试</button>' +
      '</div>';
  }

  function renderNearby() {
    const box = $('#nearbyBox');
    $('#nearbyHead').hidden = false;
    $('#nearbyTitle').textContent = (state.place ? state.place.name : '') + ' 附近';
    $('#nearbyCount').textContent = state.hotels.length ? state.hotels.length + ' 家' : '';

    if (!state.hotels.length) {
      const big = state.radius >= 5000;
      const nm = state.place ? state.place.name : '目的地';
      box.innerHTML =
        '<div class="card notice">' +
          `<b>${big ? '这一带没有登记到酒店' : '这个范围内没找到酒店'}</b>` +
          `<p>${big ? '换个地标试试，或直接用下面的方式继续。' : '把范围放大到 2km / 5km 再看看。'}</p>` +
          `<button class="mini-btn" id="btnFallbackPlace">按「${esc(nm)}」直接比价</button>` +
        '</div>';
      return;
    }

    const shown = state.hotels.slice(0, state.listLimit);
    let html = '';

    if (state.hotelSource === 'photon' && state.hotels.length) {
      html += '<div class="tipbar warn"><span>主数据源繁忙，这是备用结果，可能不全</span><button data-retry="1">重试</button></div>';
    } else if (state.hotels.length < 5 && state.radius < 5000) {
      const next = state.radius < 1000 ? 1000 : state.radius < 2000 ? 2000 : 5000;
      html += '<div class="tipbar">只有 ' + state.hotels.length + ' 家，范围放大会更全 <button data-r2="' + next + '">扩大到 ' +
        (next >= 1000 ? (next / 1000) + 'km' : next + 'm') + '</button></div>';
    }

    html += shown.map((h) => {
      const best = bestFor(h.key);
      const stars = h.stars ? ' · ' + '★'.repeat(Math.max(0, Math.min(5, parseInt(h.stars, 10) || 0))) : '';
      return (
        `<button class="hotel-row" data-hkey="${esc(h.key)}">` +
          '<div class="hr-main">' +
            `<div class="hr-name">${esc(h.name)}<span class="hr-type">${esc(h.kindLabel)}</span></div>` +
            `<div class="hr-sub">${fmtDist(h.dist)}${h.street ? ' · ' + esc(h.street) : ''}${stars}</div>` +
          '</div>' +
          (best
            ? `<div class="hr-best">${money(best.per)}<small>/晚</small><span>${esc(best.p.name)}</span></div>`
            : '<div class="hr-go">比价<svg viewBox="0 0 24 24"><path d="M9 5l7 7-7 7"/></svg></div>') +
        '</button>'
      );
    }).join('');

    if (state.hotels.length > state.listLimit) {
      html += `<button class="btn-text" id="btnMoreHotel">显示更多（还有 ${state.hotels.length - state.listLimit} 家）</button>`;
    }
    box.innerHTML = html;
  }

  function renderHome() {
    if (document.activeElement !== $('#f-dest')) $('#f-dest').value = state.dest || '';
    renderPlaceBox();
    if (state.place) {
      if (state.hotels.length) renderNearby();
      else $('#nearbyHead').hidden = true;
    } else {
      $('#nearbyHead').hidden = true;
      $('#nearbyBox').innerHTML = '';
    }
    $('#nightsTip').innerHTML = `共 <b>${nightsOf()}</b> 晚`;
  }

  /* ===================================================
     附近酒店 & 定位
     =================================================== */

  async function searchDest() {
    const q = ($('#f-dest').value || '').trim();
    if (!q) { toast('先输入目的地'); $('#f-dest').focus(); return; }
    state.dest = q;
    state.place = null;
    state.hotels = [];
    $('#nearbyBox').innerHTML = '';
    $('#nearbyHead').hidden = true;
    $('#geoNotice').innerHTML = '';
    $('#placeBox').innerHTML = '<div class="card loading-line">正在查找「' + esc(q) + '」…</div>';

    try {
      const list = await GEO.searchPlace(q);
      if (!list.length) { showPlaceError('没找到「' + q + '」，换个说法试试（比如「上海外滩」）'); return; }
      if (list.length === 1) { pickPlace(list[0]); return; }
      renderCandidates(list);
    } catch (e) {
      window.__lastGeoErr = String((e && e.message) || e);
      showPlaceError('地名服务暂时连不上，检查网络后再试');
    }
  }

  function pickPlace(p) {
    state.place = p;
    state.dest = p.name;
    state.listLimit = 15;
    $('#f-dest').value = p.name;
    $('#placeBox').innerHTML = '';
    save();
    renderPlaceBox();
    switchView('home');
    loadNearby();
  }

  async function loadNearby() {
    if (!state.place) return;
    const p = state.place;
    const r = state.radius;
    renderNearbyLoading();
    state.hotelSource = 'overpass';
    try {
      const res = await GEO.nearbyHotels(p.lat, p.lon, r);
      if (!state.place || state.place.key !== p.key || state.radius !== r) return;
      state.hotels = (res && res.list) || [];
      state.hotelSource = (res && res.source) || 'overpass';
      renderNearby();
    } catch (e) {
      renderNearbyError();
    }
  }

  async function useMyLocation() {
    const btn = $('#btnLocate');
    if (btn.classList.contains('busy')) return;
    btn.classList.add('busy');
    try {
      const pos = await GEO.locate();
      const place = await GEO.reverse(pos.lat, pos.lon);
      place.acc = pos.acc;
      pickPlace(place);
      toast('已定位：' + place.name);
    } catch (e) {
      const m = e && e.message;
      if (m === 'INSECURE') showInsecureNotice();
      else if (m === 'DENIED') toast('定位被拒绝，可在 设置 → Safari 里放开');
      else toast('定位失败，请手动输入目的地');
    } finally {
      btn.classList.remove('busy');
    }
  }

  function showInsecureNotice() {
    $('#geoNotice').innerHTML =
      '<div class="card notice warn">' +
        '<b>当前是 http，iOS 不允许定位</b>' +
        '<p>Safari 只在 https 页面开放定位权限。两种办法：把本页部署到 https（GitHub Pages / Cloudflare Pages 免费）；或者直接输入目的地，效果完全一样。</p>' +
        '<button class="mini-btn" id="btnDismissNotice">知道了</button>' +
      '</div>';
  }

  /* ===================================================
     比价页
     =================================================== */

  function openHotel(h) {
    state.hotel = h;
    save();
    switchView('compare');
  }

  function renderHotelHead() {
    const h = state.hotel;
    const c = ctx();
    if (!h) { $('#hotelHead').innerHTML = ''; return; }
    const maps = 'https://maps.apple.com/?ll=' + h.lat.toFixed(5) + ',' + h.lon.toFixed(5) +
      '&q=' + encodeURIComponent(h.name);
    $('#hotelHead').innerHTML =
      '<div class="hotel-head">' +
        '<div class="hh-row">' +
          '<div class="hh-txt">' +
            `<div class="hh-name">${esc(h.name)}</div>` +
            `<div class="hh-sub">${esc(h.kindLabel || '住宿')} · ${fmtDist(h.dist || 0)}${h.street ? ' · ' + esc(h.street) : ''}</div>` +
          '</div>' +
          `<a class="map-btn" href="${esc(maps)}" target="_blank" rel="noopener">地图</a>` +
        '</div>' +
        `<div class="hh-dates">${shortDate(c.checkin)}–${shortDate(c.checkout)} · ${c.nights} 晚 · ${c.rooms} 间 ${c.adults} 人</div>` +
      '</div>';
  }

  function renderSummary(c) {
    const s = computeStats(c);
    const n = s.rec.length;
    let mid, saveV;
    if (!n) {
      mid = '<span class="v muted">—</span>';
      saveV = '<span class="v muted">—</span>';
    } else if (n === 1) {
      mid = `<span class="v">${money(s.min.per)}</span>`;
      saveV = '<span class="v muted">仅 1 家</span>';
    } else {
      mid = `<span class="v good">${money(s.min.per)}</span>`;
      saveV = `<span class="v">${money(s.max.per - s.min.per)}</span>`;
    }

    let bar;
    if (!n) bar = '记录任意一个平台的价格，这里会立刻算出最低';
    else if (n === 1) bar = `目前只有 <b>${esc(s.min.p.name)}</b> 报价，再记 1 家就能比出差价`;
    else {
      const pct = Math.round(((s.max.per - s.min.per) / s.max.per) * 100);
      bar = `最低在 <b>${esc(s.min.p.name)}</b> · ${c.nights} 晚合计 <b>${money(s.min.tot)}</b> · 比最贵省 <b>${pct}%</b>`;
    }

    $('#summary').innerHTML =
      '<div class="summary">' +
        '<div class="sum-grid">' +
          `<div class="sum-item"><span class="k">已记录</span><span class="v">${n}<small>/ ${PLATFORMS.length}</small></span></div>` +
          `<div class="sum-item"><span class="k">最低 / 晚</span>${mid}</div>` +
          `<div class="sum-item"><span class="k">最多可省</span>${saveV}</div>` +
        '</div>' +
        `<div class="sum-bar">${bar}</div>` +
      '</div>';
  }

  function cardHTML(p, idx, c, s) {
    const e = pricesMap()[p.id];
    const precise = !!p.precise(c);
    const url = p.link(c);
    const best = s.min && s.min.p.id === p.id && s.rec.length > 1;

    let body;
    if (e && e.amount) {
      const per = e.unit === 'night' ? e.amount : e.amount / c.nights;
      const tot = e.unit === 'total' ? e.amount : e.amount * c.nights;
      const delta = s.min ? per - s.min.per : 0;
      const deltaHTML = (s.rec.length > 1 && delta > 0.5) ? `<span class="delta">+${money(delta)}</span>` : '';
      body =
        '<div class="price-block">' +
          `<div class="price">${money(per)}<small>/晚</small>${deltaHTML}</div>` +
          `<div class="price-total">${c.nights} 晚合计 ${money(tot)}${e.note ? ' · ' + esc(e.note) : ''}</div>` +
        '</div>' +
        `<button class="rec-btn" data-rec="${p.id}">改价</button>`;
    } else {
      body =
        '<div class="price-block"><div class="price none">未记录</div></div>' +
        `<button class="rec-btn solid" data-rec="${p.id}">+ 记价</button>`;
    }

    return (
      `<div class="plat${best ? ' best' : ''}" style="--i:${idx}">` +
        '<div class="plat-head">' +
          `<div class="logo" style="background:${p.brand};color:${p.ink || '#fff'}">${esc(p.short)}</div>` +
          '<div class="plat-meta">' +
            `<div class="plat-name">${esc(p.name)}` +
              (best ? '<span class="badge">最低价</span>' : '') +
              (precise ? '' : '<span class="tag">需粘贴</span>') +
            '</div>' +
            `<div class="plat-sub">${esc(p.region)} · ${esc(p.hint)}</div>` +
          '</div>' +
          `<a class="open-btn" href="${esc(url)}" target="_blank" rel="noopener noreferrer" data-open="${p.id}" data-precise="${precise ? 1 : 0}">打开` +
            '<svg viewBox="0 0 24 24"><path d="M7 17 17 7M9 7h8v8"/></svg>' +
          '</a>' +
        '</div>' +
        `<div class="plat-body${e && e.amount ? '' : ' compact'}">${body}</div>` +
      '</div>'
    );
  }

  function renderCards(c) {
    const s = computeStats(c);
    const map = pricesMap();
    let list = PLATFORMS.slice();

    if (state.sort === 'price') {
      const withPrice = list.filter((p) => map[p.id] && map[p.id].amount).sort((a, b) => {
        const ea = map[a.id], eb = map[b.id];
        const na = ea.unit === 'night' ? ea.amount : ea.amount / c.nights;
        const nb = eb.unit === 'night' ? eb.amount : eb.amount / c.nights;
        return na - nb;
      });
      const withOut = list.filter((p) => !(map[p.id] && map[p.id].amount));
      list = withPrice.concat(withOut);
    }

    $('#cards').innerHTML = list.map((p, i) => cardHTML(p, i, c, s)).join('');
    $('#listCount').textContent = `共 ${PLATFORMS.length} 个平台`;
  }

  function renderCompare() {
    renderHotelHead();
    const c = ctx();
    $('#topTitle').textContent = '比价';
    $('#topSub').textContent = (state.hotel ? state.hotel.name : '') + ' · ' + shortDate(c.checkin) + '–' + shortDate(c.checkout);
    renderSummary(c);
    renderCards(c);
  }

  /* ===================================================
     记价弹层
     =================================================== */

  let sheetId = null;
  let sheetUnit = 'night';

  function updatePriceHint() {
    const el = $('#priceHint');
    const v = parseFloat($('#f-price').value);
    const n = nightsOf();
    if (!isFinite(v) || v <= 0) {
      el.innerHTML = sheetUnit === 'night' ? `按每晚填写，${n} 晚合计会自动算` : `按 ${n} 晚总价填写，均价会自动算`;
      return;
    }
    el.innerHTML = sheetUnit === 'night'
      ? `× ${n} 晚 = <b>${money(v * n)}</b>`
      : `平均 <b>${money(v / n)}</b> / 晚`;
  }

  function openSheet(id) {
    const p = PLATFORMS.find((x) => x.id === id);
    if (!p) return;
    sheetId = id;
    const c = ctx();
    const e = pricesMap()[id];

    sheetUnit = (e && e.unit) || 'night';
    $('#sheetTitle').textContent = p.name;
    $('#sheetSub').textContent = (state.hotel ? state.hotel.name : c.keyword) +
      ' · ' + shortDate(c.checkin) + '–' + shortDate(c.checkout) + ' · ' + c.nights + ' 晚';
    $('#f-price').value = e && e.amount ? String(e.amount) : '';
    $('#f-note').value = e && e.note ? e.note : '';
    $('#btnDeletePrice').hidden = !e;

    $$('#unitSeg button').forEach((b) => b.classList.toggle('on', b.dataset.unit === sheetUnit));
    updatePriceHint();
    $('#sheetWrap').hidden = false;
    document.body.style.overflow = 'hidden';
    setTimeout(() => $('#f-price').focus(), 260);
  }

  function closeSheet() {
    $('#sheetWrap').hidden = true;
    document.body.style.overflow = '';
    sheetId = null;
  }

  function savePrice() {
    if (!sheetId) return;
    const v = parseFloat($('#f-price').value);
    if (!isFinite(v) || v <= 0) { toast('请输入大于 0 的价格'); return; }
    pricesMap()[sheetId] = { amount: v, unit: sheetUnit, note: $('#f-note').value.trim(), at: Date.now() };
    upsertHistory();
    save(); renderCompare(); closeSheet();
    toast('已记录' + (sheetUnit === 'night' ? '每晚价格' : '总价'));
  }

  function deletePrice() {
    if (!sheetId) return;
    delete pricesMap()[sheetId];
    upsertHistory();
    save(); renderCompare(); closeSheet();
    toast('已删除');
  }

  /* ===================================================
     历史记录
     =================================================== */

  function upsertHistory() {
    if (!state.hotel) return;
    const key = curKey();
    const snap = {
      id: 'h' + Date.now().toString(36) + Math.random().toString(36).slice(2, 5),
      at: Date.now(),
      q: Object.assign({}, state.q),
      hotel: {
        name: state.hotel.name, lat: state.hotel.lat, lon: state.hotel.lon,
        key: state.hotel.key, dist: state.hotel.dist,
        kindLabel: state.hotel.kindLabel, street: state.hotel.street
      },
      prices: Object.assign({}, pricesMap())
    };
    const idx = state.hist.findIndex((h) => h.hotel && h.hotel.key === key);
    if (idx >= 0) { snap.id = state.hist[idx].id; state.hist.splice(idx, 1); }
    state.hist.unshift(snap);
    state.hist = state.hist.slice(0, 40);
  }

  function renderHistory() {
    const list = state.hist;
    $('#historyEmpty').hidden = list.length > 0;
    $('#btnClearHistory').hidden = list.length === 0;
    if (!list.length) { $('#historyList').innerHTML = ''; return; }

    $('#historyList').innerHTML = list.map((h) => {
      const n = Object.keys(h.prices || {}).length;
      const nights = Math.max(1, Math.round((parseDate(h.q.checkout) - parseDate(h.q.checkin)) / 864e5));
      let best = null;
      PLATFORMS.forEach((p) => {
        const e = h.prices[p.id];
        if (!e || !e.amount) return;
        const per = e.unit === 'night' ? e.amount : e.amount / nights;
        if (!best || per < best.per) best = { p, per };
      });
      const name = h.hotel ? h.hotel.name : '未命名';
      return (
        `<button class="hotel-row" data-hid="${esc(h.id)}">` +
          '<div class="hr-main">' +
            `<div class="hr-name">${esc(name)}</div>` +
            `<div class="hr-sub">${shortDate(h.q.checkin)}–${shortDate(h.q.checkout)} · ${nights} 晚 · ${n} 家报价</div>` +
          '</div>' +
          (best
            ? `<div class="hr-best">${money(best.per)}<small>/晚</small><span>${esc(best.p.name)}</span></div>`
            : '<span class="tag">无价格</span>') +
        '</button>'
      );
    }).join('');
  }

  function loadHistory(hid) {
    const h = state.hist.find((x) => x.id === hid);
    if (!h) return;
    state.q = Object.assign({}, h.q);
    if (h.hotel) {
      state.hotel = h.hotel;
      state.prices[h.hotel.key] = Object.assign({}, h.prices);
    }
    syncInputs();
    save();
    switchView('compare');
  }

  /* ===================================================
     复制摘要
     =================================================== */

  async function copyText(text) {
    try {
      if (navigator.clipboard && window.isSecureContext) {
        await navigator.clipboard.writeText(text);
        return true;
      }
    } catch (e) { }
    try {
      const ta = document.createElement('textarea');
      ta.value = text;
      ta.setAttribute('readonly', '');
      ta.style.cssText = 'position:fixed;top:0;left:0;width:1px;height:1px;opacity:0;';
      document.body.appendChild(ta);
      ta.select();
      ta.setSelectionRange(0, text.length);
      const ok = document.execCommand('copy');
      ta.remove();
      return ok;
    } catch (e) { return false; }
  }

  function buildSummaryText() {
    const c = ctx();
    const s = computeStats(c);
    const lines = [];
    lines.push('🏨 ' + (state.hotel ? state.hotel.name : state.dest));
    if (state.hotel) lines.push('📍 ' + fmtDist(state.hotel.dist || 0) + ' · ' + (state.place ? state.place.name + ' 附近' : ''));
    lines.push('📅 ' + c.checkin + ' → ' + c.checkout + ' · ' + c.nights + ' 晚 · ' + c.rooms + ' 间 ' + c.adults + ' 人');
    lines.push('————————');
    if (!s.rec.length) {
      lines.push('（还没有记录任何平台价格）');
    } else {
      s.sorted.forEach((r) => {
        const e = pricesMap()[r.p.id];
        lines.push(r.p.name + '  ' + money(r.per) + '/晚  ' + money(r.tot) + (e && e.note ? '  ' + e.note : ''));
      });
      lines.push('————————');
      lines.push(s.rec.length > 1
        ? '✅ 最低：' + s.min.p.name + '，比最高省 ' + money(s.max.per - s.min.per) + '/晚'
        : '✅ ' + s.min.p.name + ' ' + money(s.min.per) + '/晚');
    }
    return lines.join('\n');
  }

  /* ===================================================
     视图切换
     =================================================== */

  function switchView(name) {
    $$('.view').forEach((v) => { v.hidden = v.id !== 'view-' + name; });
    const tab = name === 'compare' ? 'home' : name;
    $$('.tabbar button').forEach((b) => b.classList.toggle('on', b.dataset.view === tab));
    $('#btnBack').hidden = name !== 'compare';
    $('#brandMark').hidden = name === 'compare';

    if (name === 'history') renderHistory();
    if (name === 'home') {
      $('#topTitle').textContent = '酒店比价';
      $('#topSub').textContent = state.place
        ? state.place.name + ' · ' + shortDate(state.q.checkin) + '–' + shortDate(state.q.checkout)
        : '定位或输入目的地，看附近酒店';
    }
    if (name === 'compare' && state.hotel) renderCompare();
    window.scrollTo(0, 0);
  }

  /* ---------------- Toast ---------------- */

  let toastTimer = null;
  function toast(msg) {
    const el = $('#toast');
    el.textContent = msg;
    el.hidden = false;
    requestAnimationFrame(() => el.classList.add('show'));
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => {
      el.classList.remove('show');
      setTimeout(() => { el.hidden = true; }, 260);
    }, 2000);
  }

  /* ===================================================
     表单
     =================================================== */

  function syncInputs() {
    $('#f-dest').value = state.dest || '';
    $('#f-checkin').value = state.q.checkin || '';
    $('#f-checkout').value = state.q.checkout || '';
    $('#f-rooms').value = state.q.rooms;
    $('#f-adults').value = state.q.adults;
    $('#f-children').value = state.q.children;
    $('#f-currency').value = state.settings.currency;
    $('#f-autocopy').checked = !!state.settings.autocopy;
    $('#f-cityid').value = state.settings.cityId || '';
    $$('#radiusSeg button').forEach((b) => b.classList.toggle('on', +b.dataset.r === state.radius));
    $$('#sortSeg button').forEach((b) => b.classList.toggle('on', b.dataset.sort === state.sort));
  }

  function initDateDefaults() {
    const today = new Date();
    if (!state.q.checkin) state.q.checkin = iso(today);
    if (!state.q.checkout) state.q.checkout = iso(addDays(parseDate(state.q.checkin), 1));
  }

  function renderCityChips() {
    $('#cityChips').innerHTML = CITIES.map((c) =>
      `<button data-city="${c.id}" class="${String(state.settings.cityId) === String(c.id) ? 'on' : ''}">${c.name} ${c.id}</button>`
    ).join('');
  }

  function checkSecure() {
    const ok = GEO.isSecure();
    const el = $('#secureState');
    if (el) el.textContent = ok ? '安全（https）· 定位可用' : '不安全（http）· 定位不可用';
    $('#btnLocate').classList.toggle('muted', !ok);
  }

  /* ===================================================
     绑定事件
     =================================================== */

  function bind() {
    $('#btnSearch').addEventListener('click', searchDest);
    $('#f-dest').addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { e.preventDefault(); $('#f-dest').blur(); searchDest(); }
    });
    $('#btnLocate').addEventListener('click', useMyLocation);

    $('#placeBox').addEventListener('click', (e) => {
      const ex = e.target.closest('[data-ex]');
      if (ex) { $('#f-dest').value = ex.dataset.ex; searchDest(); return; }
      const cand = e.target.closest('[data-ci]');
      if (cand) { pickPlace(window.__cands[+cand.dataset.ci]); return; }
      if (e.target.closest('#btnChangePlace')) {
        state.place = null; state.hotels = []; state.dest = '';
        $('#f-dest').value = '';
        renderPlaceBox();
        $('#nearbyHead').hidden = true;
        $('#nearbyBox').innerHTML = '';
        $('#f-dest').focus();
      }
    });

    $('#radiusSeg').addEventListener('click', (e) => {
      const b = e.target.closest('button[data-r]');
      if (!b) return;
      state.radius = +b.dataset.r;
      state.listLimit = 15;
      $$('#radiusSeg button').forEach((x) => x.classList.toggle('on', x === b));
      save();
      loadNearby();
    });

    $('#nearbyBox').addEventListener('click', (e) => {
      const row = e.target.closest('[data-hkey]');
      if (row) {
        const h = state.hotels.find((x) => x.key === row.dataset.hkey);
        if (h) openHotel(h);
        return;
      }
      if (e.target.closest('[data-retry]')) {
        try { localStorage.removeItem('hpc.geo.v1'); } catch (err) { }
        renderNearbyLoading();
        loadNearby();
        return;
      }
      const r2 = e.target.closest('[data-r2]');
      if (r2) {
        state.radius = +r2.dataset.r2;
        state.listLimit = 15;
        $$('#radiusSeg button').forEach((x) => x.classList.toggle('on', +x.dataset.r === state.radius));
        save(); loadNearby();
        return;
      }
      if (e.target.closest('#btnMoreHotel')) { state.listLimit += 20; renderNearby(); return; }
      if (e.target.closest('#btnRetryNearby')) { loadNearby(); return; }
      if (e.target.closest('#btnFallbackPlace') && state.place) {
        openHotel({
          name: state.place.name, lat: state.place.lat, lon: state.place.lon,
          dist: 0, kindLabel: '目的地', street: state.place.display || '',
          key: 'place:' + state.place.key
        });
      }
    });

    $('#geoNotice').addEventListener('click', (e) => {
      if (e.target.closest('#btnDismissNotice')) $('#geoNotice').innerHTML = '';
    });

    $('#f-checkin').addEventListener('change', (e) => {
      state.q.checkin = e.target.value;
      if (!state.q.checkout || state.q.checkout <= state.q.checkin) {
        state.q.checkout = iso(addDays(parseDate(state.q.checkin), 1));
        $('#f-checkout').value = state.q.checkout;
      }
      save(); renderHome();
    });
    $('#f-checkout').addEventListener('change', (e) => {
      state.q.checkout = e.target.value;
      if (state.q.checkout <= state.q.checkin) {
        state.q.checkin = iso(addDays(parseDate(state.q.checkout), -1));
        $('#f-checkin').value = state.q.checkin;
      }
      save(); renderHome();
    });
    ['rooms', 'adults', 'children'].forEach((k) => {
      $('#f-' + k).addEventListener('change', (e) => {
        state.q[k] = Math.max(k === 'children' ? 0 : 1, +e.target.value || 0);
        e.target.value = state.q[k];
        save(); renderHome();
      });
    });

    $('#cards').addEventListener('click', (e) => {
      const rec = e.target.closest('[data-rec]');
      if (rec) { openSheet(rec.dataset.rec); return; }
      const open = e.target.closest('[data-open]');
      if (open && open.dataset.precise === '0' && state.settings.autocopy && ctx().keyword) {
        copyText(ctx().keyword).then((ok) => { if (ok) toast('酒店名已复制，进平台后长按粘贴'); });
      }
    });

    $('#sortSeg').addEventListener('click', (e) => {
      const b = e.target.closest('button[data-sort]');
      if (!b) return;
      state.sort = b.dataset.sort;
      $$('#sortSeg button').forEach((x) => x.classList.toggle('on', x === b));
      save(); renderCompare();
    });

    $('#btnBack').addEventListener('click', () => switchView('home'));
    $('#btnOtherHotel').addEventListener('click', () => switchView('home'));

    $('#sheetWrap').addEventListener('click', (e) => { if (e.target.closest('[data-close]')) closeSheet(); });
    $('#unitSeg').addEventListener('click', (e) => {
      const b = e.target.closest('button[data-unit]');
      if (!b) return;
      sheetUnit = b.dataset.unit;
      $$('#unitSeg button').forEach((x) => x.classList.toggle('on', x === b));
      updatePriceHint();
    });
    $('#btnSavePrice').addEventListener('click', savePrice);
    $('#btnDeletePrice').addEventListener('click', deletePrice);
    $('#f-price').addEventListener('input', updatePriceHint);
    $('#f-price').addEventListener('keydown', (e) => { if (e.key === 'Enter') savePrice(); });

    $$('.tabbar button').forEach((b) => b.addEventListener('click', () => switchView(b.dataset.view)));

    $('#historyList').addEventListener('click', (e) => {
      const row = e.target.closest('[data-hid]');
      if (row) loadHistory(row.dataset.hid);
    });
    $('#btnClearHistory').addEventListener('click', () => {
      if (!confirm('清空全部历史记录？')) return;
      state.hist = [];
      save(); renderHistory();
      toast('已清空');
    });

    $('#f-currency').addEventListener('change', (e) => {
      state.settings.currency = e.target.value;
      save();
      renderHome();
      if (state.hotel) renderCompare();
    });
    $('#f-autocopy').addEventListener('change', (e) => {
      state.settings.autocopy = e.target.checked;
      save();
    });
    $('#f-cityid').addEventListener('change', (e) => {
      state.settings.cityId = e.target.value.replace(/\D/g, '');
      e.target.value = state.settings.cityId;
      renderCityChips(); save();
    });
    $('#cityChips').addEventListener('click', (e) => {
      const b = e.target.closest('[data-city]');
      if (!b) return;
      state.settings.cityId = String(b.dataset.city);
      $('#f-cityid').value = state.settings.cityId;
      renderCityChips(); save();
      toast('携程已可精准跳转');
    });

    $('#btnShare').addEventListener('click', async () => {
      if (!state.hotel) { toast('先进到某家酒店的比价页'); return; }
      const ok = await copyText(buildSummaryText());
      toast(ok ? '比价摘要已复制' : '复制失败，请长按选择');
    });

    $('#btnDemo').addEventListener('click', () => {
      if (!state.hotel) { toast('先在首页选一家酒店'); return; }
      const base = 1280;
      const demo = { ctrip: 0.96, booking: 1.0, agoda: 0.91, trip: 1.05, expedia: 1.12 };
      Object.keys(demo).forEach((id) => {
        pricesMap()[id] = {
          amount: Math.round(base * demo[id] / 10) * 10,
          unit: 'night', note: id === 'agoda' ? '含早' : '', at: Date.now()
        };
      });
      upsertHistory(); save(); switchView('compare'); renderCompare();
      toast('已载入 5 家示例价格（演示）');
    });

    $('#btnReset').addEventListener('click', () => {
      if (!confirm('清空全部本地数据？')) return;
      try { localStorage.removeItem(LS); } catch (e) { }
      state.q = { checkin: '', checkout: '', rooms: 1, adults: 2, children: 0 };
      state.dest = ''; state.place = null; state.hotel = null; state.hotels = [];
      state.prices = {}; state.hist = [];
      state.settings = { currency: '¥', autocopy: true, cityId: '' };
      initDateDefaults(); syncInputs(); renderCityChips(); renderHome(); renderHistory(); switchView('home');
      toast('已恢复出厂设置');
    });

    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && !$('#sheetWrap').hidden) closeSheet();
    });
  }

  /* ===================================================
     启动
     =================================================== */

  load();
  initDateDefaults();
  syncInputs();
  renderCityChips();
  checkSecure();
  bind();
  renderHome();
  renderHistory();

  const minDate = iso(new Date());
  $('#f-checkin').min = minDate;
  $('#f-checkout').min = minDate;

  if (state.place) loadNearby();

  const hash = (location.hash || '').replace('#', '');
  if (hash === 'history' || hash === 'settings') switchView(hash);

  if ('serviceWorker' in navigator && (location.protocol === 'https:' || location.hostname === 'localhost' || location.hostname === '127.0.0.1')) {
    window.addEventListener('load', () => {
      navigator.serviceWorker.register('sw.js').catch(() => { });
    });
  }
})();
