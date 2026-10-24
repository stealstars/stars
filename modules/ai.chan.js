/* AI 通道。改这里。 */
/* ==========================================================================
 * AI 通道 —— 通用的「额外 API」凭据与调用
 *
 * 照伊雍的做法：
 *   - 端点只填 host（如 https://gcli.ggchan.dev），路径由本模块拼
 *   - 密钥只存 localStorage，绝不写入世界书/聊天/导出
 *   - 填完地址与密钥后「拉取列表」从 /v1/models 取模型，下拉选择
 *   - 每个模块可单独配置（目前只有外交用得上，其余留空）
 *
 * 不依赖 TavernHelper 的 generateCustomRaw：直接 fetch，自己管超时与错误。
 * ========================================================================== */
(() => {
  'use strict';

  const STORE_KEY = 'fiefLedger.aichan.v1';
  const TIMEOUT = { models: 20000, chat: 120000 };

  /* ------------------------------------------------------------ 存储 */
  /** 结构：{ modules: { 外交: { base, key, model } }, active: '外交' } */
  function loadAll() {
    try {
      const raw = window.localStorage.getItem(STORE_KEY);
      if (!raw) return { modules: {}, active: '外交' };
      const obj = JSON.parse(raw);
      if (!obj || typeof obj !== 'object') return { modules: {}, active: '外交' };
      return { modules: obj.modules || {}, active: obj.active || '外交' };
    } catch (e) {
      return { modules: {}, active: '外交' };
    }
  }

  function saveAll(all) {
    try { window.localStorage.setItem(STORE_KEY, JSON.stringify(all)); return true; }
    catch (e) { return false; }
  }

  function getConf(module) {
    const all = loadAll();
    return all.modules[module || all.active] || { base: '', key: '', model: '' };
  }

  function setConf(module, conf) {
    const all = loadAll();
    const m = module || all.active;
    all.modules[m] = {
      base: String(conf.base || '').trim(),
      key: String(conf.key || '').trim(),
      model: String(conf.model || '').trim(),
    };
    saveAll(all);
    return all.modules[m];
  }

  /* ------------------------------------------------------------ 路径 */
  /**
   * 把用户填的地址补成完整 URL。
   * 允许三种写法：
   *   https://host              → https://host/v1/xxx
   *   https://host/v1           → https://host/v1/xxx
   *   https://host/v1/chat/...  → 原样（已带路径）
   */
  function endpoint(base, tail) {
    let b = String(base || '').trim().replace(/\/+$/, '');
    if (!b) return '';
    if (!/^https?:\/\//i.test(b)) b = 'https://' + b;
    // 已经写全了就直接用
    if (/\/chat\/completions$/i.test(b) || /\/models$/i.test(b)) {
      return b.replace(/\/(chat\/completions|models)$/i, tail);
    }
    if (/\/v\d+$/i.test(b)) return b + tail;
    return b + '/v1' + tail;
  }

  /* ------------------------------------------------------------ 请求 */
  function maskKey(k) {
    const s = String(k || '');
    if (s.length <= 8) return s ? '•'.repeat(s.length) : '';
    return s.slice(0, 3) + '•'.repeat(Math.min(24, s.length - 6)) + s.slice(-3);
  }

  async function req(url, opts, timeoutMs) {
    const ctl = typeof AbortController === 'function' ? new AbortController() : null;
    const timer = ctl ? setTimeout(() => ctl.abort(), timeoutMs) : null;
    try {
      const res = await fetch(url, Object.assign({}, opts, ctl ? { signal: ctl.signal } : {}));
      const text = await res.text();
      if (!res.ok) {
        let msg = 'HTTP ' + res.status;
        try {
          const j = JSON.parse(text);
          if (j && j.error && (j.error.message || j.error.type)) msg += '：' + (j.error.message || j.error.type);
          else if (j && j.message) msg += '：' + j.message;
        } catch (e) {
          if (text) msg += '：' + text.slice(0, 160).replace(/\s+/g, ' ');
        }
        if (res.status === 401 || res.status === 403) msg += '（密钥无效或无权限）';
        if (res.status === 404) msg += '（地址或路径不对）';
        if (res.status === 429) msg += '（请求太频繁）';
        const err = new Error(msg);
        err.status = res.status;
        throw err;
      }
      return text;
    } catch (e) {
      if (e && e.name === 'AbortError') throw new Error('请求超时（' + Math.round(timeoutMs / 1000) + ' 秒）');
      if (e && e.message === 'Failed to fetch') {
        throw new Error('连不上：可能是地址写错、服务没开，或对方不允许跨域');
      }
      throw e;
    } finally {
      if (timer) clearTimeout(timer);
    }
  }

  /* ------------------------------------------------------- 拉取模型 */
  /**
   * 返回完整模型对象数组，按「能用的排前面」排序：
   *   idle / normal → 前，unknown → 中，congested → 后
   * 兼容三种返回：
   *   { data: [{ id, name, busy_level, credit_multiplier, ... }] }   带元信息
   *   { data: [{ id }] }                                             最简
   *   ['a','b']                                                      裸数组
   */
  async function listModels(conf) {
    const c = conf || getConf();
    if (!c.base) throw new Error('先填接口地址');
    if (!c.key) throw new Error('先填 API 密钥');
    const url = endpoint(c.base, '/models');
    const text = await req(url, {
      method: 'GET',
      headers: { Authorization: 'Bearer ' + c.key, Accept: 'application/json' },
    }, TIMEOUT.models);
    let data;
    try { data = JSON.parse(text); } catch (e) { throw new Error('返回的不是 JSON：' + text.slice(0, 80)); }
    const arr = Array.isArray(data) ? data : (data.data || data.models || []);
    const list = arr.map((x) => {
      if (typeof x === 'string') return { id: x, label: x };
      if (!x || !(x.id || x.name)) return null;
      const id = String(x.id || x.name);
      const busy = String(x.busy_level || '').toLowerCase();
      const price = (typeof x.credit_multiplier === 'number') ? x.credit_multiplier : null;
      const busyLabel = x.busy_label ? String(x.busy_label) : '';
      return {
        id,
        label: id,
        name: x.name ? String(x.name) : id,
        busy,
        busyLabel,
        price,
      };
    }).filter(Boolean);
    if (!list.length) throw new Error('列表是空的，或格式不认识');

    // 排序：能用的在前，拥堵的垫底，同级按名字
    const rank = (m) => {
      if (m.busy === 'idle') return 0;
      if (m.busy === 'normal') return 1;
      if (m.busy === 'congested') return 3;
      return 2;
    };
    list.sort((a, b) => {
      const d = rank(a) - rank(b);
      if (d) return d;
      return a.id.localeCompare(b.id);
    });
    return list;
  }

  /* ---------------------------------------------------------- 对话 */
  /**
   * @param {string} prompt 用户消息
   * @param {object} opts { system, temperature, maxTokens, module }
   * @returns {Promise<string>} 模型返回的文本
   */
  async function chat(prompt, opts) {
    const o = opts || {};
    const c = getConf(o.module);
    if (!c.base) throw new Error('还没配置接口地址');
    if (!c.key) throw new Error('还没配置 API 密钥');
    if (!c.model) throw new Error('还没选择模型');
    const url = endpoint(c.base, '/chat/completions');
    const messages = [];
    if (o.system) messages.push({ role: 'system', content: String(o.system) });
    messages.push({ role: 'user', content: String(prompt) });
    const body = {
      model: c.model,
      messages,
      temperature: typeof o.temperature === 'number' ? o.temperature : 0.7,
      stream: false,
    };
    if (o.maxTokens) body.max_tokens = o.maxTokens;
    const text = await req(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: 'Bearer ' + c.key,
        Accept: 'application/json',
      },
      body: JSON.stringify(body),
    }, TIMEOUT.chat);
    let data;
    try { data = JSON.parse(text); } catch (e) { throw new Error('返回的不是 JSON：' + text.slice(0, 80)); }
    const ch = data && data.choices && data.choices[0];
    const msg = ch && (ch.message || ch.delta);
    let out = msg && (typeof msg.content === 'string' ? msg.content : '');
    if (!out) {
      // 有些中转把结果放在别处
      if (data && typeof data.content === 'string') out = data.content;
      else if (data && typeof data.output === 'string') out = data.output;
      else if (data && data.choices && data.choices[0] && typeof data.choices[0].text === 'string') out = data.choices[0].text;
    }
    if (!out || !String(out).trim()) {
      const raw = JSON.stringify(data).slice(0, 200);
      throw new Error('模型返回空内容：' + raw);
    }
    return String(out);
  }

  /** 从模型返回里抠出 JSON（容忍 ```json 包裹与前后废话） */
  function extractJson(text) {
    let s = String(text || '').trim();
    if (!s) return null;
    s = s.replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, '').trim();
    try { return JSON.parse(s); } catch (e) { /* 继续 */ }
    const a = s.indexOf('{');
    const b = s.lastIndexOf('}');
    if (a >= 0 && b > a) {
      try { return JSON.parse(s.slice(a, b + 1)); } catch (e) { /* 继续 */ }
    }
    const c = s.indexOf('[');
    const d = s.lastIndexOf(']');
    if (c >= 0 && d > c) {
      try { return JSON.parse(s.slice(c, d + 1)); } catch (e) { /* 继续 */ }
    }
    return null;
  }

  /* ---------------------------------------------------------- 测试 */
  async function test(conf) {
    const c = conf || getConf();
    const t0 = Date.now();
    const r = await chat('只回复两个字：可用', { module: undefined, temperature: 0, maxTokens: 16, system: '' , ...{} });
    return { ok: true, ms: Date.now() - t0, echo: String(r).slice(0, 40) };
  }

  window.__fiefAI = {
    loadAll, getConf, setConf, endpoint, maskKey,
    listModels, chat, extractJson,
    async testWith(conf) {
      const t0 = Date.now();
      const r = await chat('只回复两个字：可用', Object.assign({}, conf, { temperature: 0, maxTokens: 16 }));
      return { ms: Date.now() - t0, echo: String(r).slice(0, 40) };
    },
    _test: { endpoint, extractJson, STORE_KEY },
  };
})();
