/* ===================================================
   地理能力：定位 / 地名搜索 / 附近酒店
   ---------------------------------------------------
   数据源：OpenStreetMap
     · 地名搜索   Nominatim  （免 key，支持 CORS）
     · 附近酒店   Overpass    （多镜像并发竞速，谁先回用谁）
                 Photon      （兜底，按名称匹配酒店类 POI）
   所有结果本地缓存 12 小时，避免反复打公共接口。
   =================================================== */

(function () {
  'use strict';

  const NOMINATIM = 'https://nominatim.openstreetmap.org';
  const PHOTON = 'https://photon.komoot.io/api/';
  const OVERPASS = [
    'https://overpass-api.de/api/interpreter',
    'https://overpass.kumi.systems/api/interpreter',
    'https://overpass.private.coffee/api/interpreter',
    'https://maps.mail.ru/osm/tools/overpass/api/interpreter'
  ];
  const CACHE_KEY = 'hpc.geo.v1';
  const CACHE_TTL = 12 * 3600 * 1000;

  /* ---------------- 缓存 ---------------- */

  function readCache() {
    try { return JSON.parse(localStorage.getItem(CACHE_KEY) || '{}'); } catch (e) { return {}; }
  }
  function writeCache(obj) {
    try {
      const keys = Object.keys(obj);
      if (keys.length > 24) {
        keys.sort((a, b) => (obj[a].t || 0) - (obj[b].t || 0));
        keys.slice(0, keys.length - 24).forEach((k) => delete obj[k]);
      }
      localStorage.setItem(CACHE_KEY, JSON.stringify(obj));
    } catch (e) { }
  }
  function cacheGet(key) {
    const c = readCache()[key];
    if (!c) return null;
    const ttl = c.ttl || CACHE_TTL;
    return Date.now() - c.t < ttl ? c.v : null;
  }
  function cacheSet(key, v, ttl) {
    const c = readCache();
    c[key] = { t: Date.now(), v: v, ttl: ttl || 0 };
    writeCache(c);
  }

  /* ---------------- 请求 ---------------- */

  function timedFetch(url, opts, ms, signal) {
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), ms);
    if (signal) {
      if (signal.aborted) ctl.abort();
      else signal.addEventListener('abort', () => ctl.abort(), { once: true });
    }
    return fetch(url, Object.assign({}, opts, { signal: ctl.signal }))
      .finally(() => clearTimeout(timer));
  }

  /* 返回解析后的 JSON；任何失败都返回 null，由调用方决定是否降级 */
  async function tryJson(url, opts, ms) {
    try {
      const res = await timedFetch(url, opts, ms);
      if (!res.ok) return null;
      const txt = await res.text();
      if (!txt) return null;
      return JSON.parse(txt);
    } catch (e) {
      return null;
    }
  }

  /* Photon 兜底地理编码（Nominatim 挂了 / 被限流时用）
     ---------------------------------------------------
     关键技巧：先用 osm_tag 把范围限制在「地名 / 道路 / 车站」，
     这样搜「上海外滩」不会返回一堆叫「上海外滩 XX 酒店」的商家，
     而是直接命中「外滩」本身（highway=pedestrian）。
     限制性查询为空时，再退回不带过滤的普通查询。 */
  function photonQuery(term, tag) {
    const params = new URLSearchParams({ q: term, limit: '12' });
    if (tag) params.set('osm_tag', tag);
    return tryJson(PHOTON + '?' + params, { headers: { Accept: 'application/json' } }, 8000);
  }

  function photonToPlaces(packs, qn) {
    const seen = new Set();
    const out = [];

    packs.forEach((data) => {
      if (!data || !Array.isArray(data.features)) return;
      data.features.forEach((f) => {
        const p = f.properties || {};
        const c = (f.geometry && f.geometry.coordinates) || [];
        const name = p.name || '';
        if (!name || !isFinite(c[1]) || !isFinite(c[0])) return;

        const sig = name + '@' + (+c[1]).toFixed(3) + ',' + (+c[0]).toFixed(3);
        if (seen.has(sig)) return;
        seen.add(sig);

        let score = 0;
        if (name === qn) score += 8;
        else if (qn.endsWith(name) && name.length >= 2) score += 6;
        else if (name.startsWith(qn)) score += 5;
        else if (qn.includes(name) && name.length >= 2) score += 4;

        out.push({
          score: score,
          name: name,
          display: [p.city, p.district, p.street, p.country].filter(Boolean).join(' · '),
          lat: c[1], lon: c[0],
          kind: p.osm_value || p.type || '',
          city: p.city || p.state || p.county || '',
          key: 'p:' + (+c[1]).toFixed(4) + ',' + (+c[0]).toFixed(4)
        });
      });
    });

    out.sort((a, b) => b.score - a.score);
    return out.slice(0, 8).map((x) => { delete x.score; return x; });
  }

  async function photonSearch(q) {
    const qn = q.trim();
    const hasCJK = /[\u4e00-\u9fa5]/.test(qn);

    const terms = [qn];
    if (hasCJK && qn.length >= 4) terms.push(qn.slice(-2));
    if (hasCJK && qn.length >= 5) terms.push(qn.slice(-3));

    /* 1) 限制性地名查询 */
    const tagJobs = [];
    ['place', 'highway', 'railway'].forEach((tag) => {
      terms.forEach((t) => tagJobs.push(photonQuery(t, tag)));
    });
    const tagged = await Promise.all(tagJobs);
    const places = photonToPlaces(tagged, qn);
    if (places.length) return places;

    /* 2) 退回普通查询（找商场、酒店、景点等 POI 时用） */
    const plain = await Promise.all(terms.map((t) => photonQuery(t)));
    return photonToPlaces(plain, qn);
  }

  /* ---------------- 定位 ---------------- */

  function locate() {
    return new Promise((resolve, reject) => {
      if (!window.isSecureContext) { reject(new Error('INSECURE')); return; }
      if (!navigator.geolocation) { reject(new Error('UNSUPPORTED')); return; }
      navigator.geolocation.getCurrentPosition(
        (pos) => resolve({ lat: pos.coords.latitude, lon: pos.coords.longitude, acc: pos.coords.accuracy }),
        (err) => reject(new Error(err.code === 1 ? 'DENIED' : 'FAILED')),
        { enableHighAccuracy: true, timeout: 12000, maximumAge: 300000 }
      );
    });
  }

  /* ---------------- 距离 ---------------- */

  function haversine(lat1, lon1, lat2, lon2) {
    const R = 6371000;
    const toRad = (d) => (d * Math.PI) / 180;
    const dLat = toRad(lat2 - lat1);
    const dLon = toRad(lon2 - lon1);
    const a = Math.sin(dLat / 2) ** 2 +
      Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
    return 2 * R * Math.asin(Math.sqrt(a));
  }

  /* ---------------- 地名搜索 ---------------- */

  const cityOf = (addr) => !addr ? '' :
    (addr.city || addr.town || addr.county || addr.state || addr.province || '');

  async function searchPlace(q) {
    const key = 's:' + q.trim().toLowerCase();
    const hit = cacheGet(key);
    if (hit) return hit;

    /* 1) Nominatim 直连（最准） */
    const url = NOMINATIM + '/search?' + new URLSearchParams({
      q: q, format: 'jsonv2', limit: '8', addressdetails: '1',
      'accept-language': 'zh-CN,zh'
    });
    let arr = await tryJson(url, { headers: { Accept: 'application/json' } }, 8000);

    if (Array.isArray(arr) && arr.length) {
      const list = arr.map((x) => {
        const addr = x.address || {};
        const dn = x.display_name || '';
        const rest = dn.split(',').slice(1).join(',').trim();
        return {
          name: x.name || dn.split(',')[0] || dn,
          display: rest || dn,
          lat: parseFloat(x.lat),
          lon: parseFloat(x.lon),
          kind: x.addresstype || x.type || '',
          city: cityOf(addr),
          key: 'p:' + (+x.lat).toFixed(4) + ',' + (+x.lon).toFixed(4)
        };
      });
      cacheSet(key, list);
      return list;
    }

    /* 2) Photon 兜底（Nominatim 限流 / 连不上时） */
    const ph = await photonSearch(q);
    if (ph.length) { cacheSet(key, ph); return ph; }

    /* 3) 同源代理（serve.js 提供，部署到静态托管时不存在） */
    const purl = '/api/geo/nominatim?' + new URLSearchParams({
      path: '/search', q: q, format: 'jsonv2', limit: '8', addressdetails: '1',
      'accept-language': 'zh-CN,zh'
    });
    arr = await tryJson(purl, {}, 12000);

    if (Array.isArray(arr) && arr.length) {
      const list = arr.map((x) => {
        const addr = x.address || {};
        const dn = x.display_name || '';
        return {
          name: x.name || dn.split(',')[0] || dn,
          display: dn.split(',').slice(1).join(',').trim() || dn,
          lat: parseFloat(x.lat), lon: parseFloat(x.lon),
          kind: x.addresstype || x.type || '',
          city: cityOf(addr),
          key: 'p:' + (+x.lat).toFixed(4) + ',' + (+x.lon).toFixed(4)
        };
      });
      cacheSet(key, list);
      return list;
    }

    throw new Error('SEARCH_FAILED');
  }

  async function reverse(lat, lon) {
    /* 1) Nominatim */
    const url = NOMINATIM + '/reverse?' + new URLSearchParams({
      lat: lat, lon: lon, format: 'jsonv2', 'accept-language': 'zh-CN,zh', zoom: '16'
    });
    let x = await tryJson(url, { headers: { Accept: 'application/json' } }, 8000);

    if (x && x.address) {
      const addr = x.address;
      return {
        name: addr.suburb || addr.neighbourhood || addr.road ||
          addr.city_district || addr.quarter || cityOf(addr) || '当前位置',
        display: [cityOf(addr), addr.district, addr.suburb].filter(Boolean).join(' · '),
        lat: lat, lon: lon, kind: 'current', city: cityOf(addr),
        key: 'p:' + lat.toFixed(4) + ',' + lon.toFixed(4)
      };
    }

    /* 2) Photon 反向 */
    const ph = await tryJson(PHOTON + 'reverse?' + new URLSearchParams({
      lat: String(lat), lon: String(lon), limit: '1'
    }), { headers: { Accept: 'application/json' } }, 10000);

    if (ph && Array.isArray(ph.features) && ph.features.length) {
      const pr = ph.features[0].properties || {};
      return {
        name: pr.district || pr.street || pr.city || '当前位置',
        display: [pr.city, pr.district, pr.street].filter(Boolean).join(' · '),
        lat: lat, lon: lon, kind: 'current', city: pr.city || '',
        key: 'p:' + lat.toFixed(4) + ',' + lon.toFixed(4)
      };
    }

    /* 3) 都失败也别让定位流程中断：用坐标兜底 */
    return {
      name: '当前位置',
      display: lat.toFixed(4) + ', ' + lon.toFixed(4),
      lat: lat, lon: lon, kind: 'current', city: '',
      key: 'p:' + lat.toFixed(4) + ',' + lon.toFixed(4)
    };
  }

  /* ---------------- 附近酒店 ---------------- */

  const TYPE_LABEL = {
    hotel: '酒店', guest_house: '民宿', hostel: '青旅',
    apartment: '公寓', resort: '度假村', motel: '汽车旅馆'
  };
  const TYPES = Object.keys(TYPE_LABEL);

  function buildQuery(lat, lon, radius) {
    const around = `(around:${radius},${lat.toFixed(6)},${lon.toFixed(6)})`;
    const re = '^(' + TYPES.join('|') + ')$';
    return '[out:json][timeout:20];(' +
      `node["tourism"~"${re}"]${around};` +
      `way["tourism"~"${re}"]${around};` +
      `relation["tourism"~"${re}"]${around};` +
      ');out center tags 300;';
  }

  /* 多镜像并发，谁先给出合法结果用谁 */
  async function overpassRace(query) {
    const ctrls = OVERPASS.map(() => new AbortController());
    const killer = setTimeout(() => ctrls.forEach((c) => c.abort()), 18000);

    const tries = OVERPASS.map((ep, i) => (async () => {
      const res = await timedFetch(ep, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: 'data=' + encodeURIComponent(query)
      }, 18000, ctrls[i].signal);
      if (!res.ok) throw new Error('HTTP_' + res.status);
      const data = await res.json();
      if (!data || !Array.isArray(data.elements)) throw new Error('BAD_PAYLOAD');
      return data.elements;
    })());

    try {
      return await Promise.any(tries);
    } catch (e) {
      // 全部镜像都失败：试一次同源代理
      const viaProxy = await tryJson('/api/geo/overpass?' + new URLSearchParams({ data: query }), {}, 25000);
      if (viaProxy && Array.isArray(viaProxy.elements)) return viaProxy.elements;
      throw e;
    } finally {
      clearTimeout(killer);
      ctrls.forEach((c) => c.abort());
    }
  }

  function normalize(elements, lat, lon, radius) {
    const raw = [];
    elements.forEach((el) => {
      const t = el.tags || {};
      const name = (t.name || t['name:zh'] || t['name:en'] || '').trim();
      if (!name) return;
      const plat = el.lat != null ? el.lat : (el.center && el.center.lat);
      const plon = el.lon != null ? el.lon : (el.center && el.center.lon);
      if (plat == null || plon == null) return;

      const dist = Math.round(haversine(lat, lon, plat, plon));
      if (dist > radius * 1.15) return;

      raw.push({
        name: name, lat: plat, lon: plon,
        kind: t.tourism || 'hotel',
        kindLabel: TYPE_LABEL[t.tourism] || '住宿',
        stars: t.stars || '',
        brand: t.brand || '',
        street: t['addr:street'] || '',
        dist: dist
      });
    });

    const out = [];
    raw.sort((a, b) => a.dist - b.dist).forEach((h) => {
      const dup = out.some((o) => o.name === h.name && Math.abs(o.dist - h.dist) < 80);
      if (!dup) out.push(h);
    });
    out.forEach((h) => { h.key = 'h:' + h.lat.toFixed(4) + ',' + h.lon.toFixed(4) + ':' + h.name; });
    return out;
  }

  /* Photon 兜底：按名称检索酒店类 POI，客户端按 tourism 标签过滤 + 距离裁剪 */
  async function photonFallback(lat, lon, radius) {
    const queries = ['酒店', 'hotel', '宾馆', '民宿', '青年旅舍'];
    const settled = await Promise.allSettled(queries.map((q) =>
      timedFetch(PHOTON + '?' + new URLSearchParams({
        q: q, lat: String(lat), lon: String(lon), limit: '30'
      }), { headers: { Accept: 'application/json' } }, 9000)
        .then((r) => (r.ok ? r.json() : { features: [] }))
    ));

    const els = [];
    settled.forEach((s) => {
      if (s.status !== 'fulfilled') return;
      (s.value.features || []).forEach((f) => {
        const p = f.properties || {};
        if (p.osm_key !== 'tourism') return;
        if (!TYPES.includes(p.osm_value)) return;
        const coords = (f.geometry && f.geometry.coordinates) || [];
        if (coords.length < 2) return;
        els.push({
          lat: coords[1], lon: coords[0],
          tags: {
            name: p.name, tourism: p.osm_value,
            stars: p.stars, 'addr:street': p.street
          }
        });
      });
    });

    if (!els.length) throw new Error('PHOTON_EMPTY');
    return normalize(els, lat, lon, radius);
  }

  async function nearbyHotels(lat, lon, radius) {
    const key = 'n:' + lat.toFixed(3) + ',' + lon.toFixed(3) + ':' + radius;
    const hit = cacheGet(key);
    if (hit) return hit;

    let hotels = [];
    let source = 'overpass';

    try {
      const els = await overpassRace(buildQuery(lat, lon, radius));
      hotels = normalize(els, lat, lon, radius);
    } catch (e) {
      source = 'photon';
      hotels = await photonFallback(lat, lon, radius);
    }

    if (!hotels.length && source === 'overpass') {
      try {
        hotels = await photonFallback(lat, lon, radius);
        source = 'photon';
      } catch (e) { /* 两个源都空，正常返回空数组 */ }
    }

    const payload = { list: hotels, source: source };
    // 兜底源的结果半小时内可复用，别把降级结果缓存一整天
    cacheSet(key, payload, source === 'overpass' ? 0 : 30 * 60 * 1000);
    return payload;
  }

  /* ---------------- 输出 ---------------- */

  window.HPC_GEO = {
    isSecure: () => !!window.isSecureContext,
    locate: locate,
    searchPlace: searchPlace,
    reverse: reverse,
    nearbyHotels: nearbyHotels,
    haversine: haversine,
    TYPE_LABEL: TYPE_LABEL
  };
})();
