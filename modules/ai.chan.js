/* AI 通道。改这里。 */
/* ==========================================================================
 * AI 通道 —— 通用的「额外 API」凭据与调用
 *
 * 照伊雍的做法：
 *   - 端点只填 host（例如 https://你的中转地址），路径由本模块拼
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

  /**
   * 模块别名。
   * 设置面板里用中文名「外交」，外交页调 chat() 时传的是 'diplomacy'。
   * 不归一化就会出现「填了却提示没配置」。
   */
  const ALIAS = {
    diplomacy: '外交',
    外交档案: '外交',
    外交: '外交',
  };
  function canon(m) {
    const k = String(m == null || m === '' ? '外交' : m);
    return ALIAS[k] || k;
  }

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
    const k = canon(module || all.active);
    return all.modules[k] || { base: '', key: '', model: '' };
  }

  function setConf(module, conf) {
    const all = loadAll();
    const m = canon(module || all.active);
    all.modules[m] = {
      base: String(conf.base || '').trim(),
      key: String(conf.key || '').trim(),
      model: String(conf.model || '').trim(),
    };
    saveAll(all);
    return all.modules[m];
  }

  /** 存不进去时得让用户知道（隐私模式 / 存储满 / 被策略禁掉） */
  function storeOk() {
    try {
      const probe = STORE_KEY + '.probe';
      window.localStorage.setItem(probe, '1');
      window.localStorage.removeItem(probe);
      return true;
    } catch (e) {
      return false;
    }
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
   * @param {object} opts { system, temperature, maxTokens, module, stream }
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
      stream: !!o.stream,
    };
    // 额度给足：推理型模型（-high / -thinking）的思考过程也算 token，
    // 给太少会让它话没想完就撞上限，正文是空的
    body.max_tokens = (typeof o.maxTokens === 'number' && o.maxTokens > 0) ? o.maxTokens : 4000;

    const headers = {
      'Content-Type': 'application/json',
      Authorization: 'Bearer ' + c.key,
      Accept: o.stream ? 'text/event-stream' : 'application/json',
    };

    if (o.stream) return await chatStream(url, headers, body);

    const text = await req(url, {
      method: 'POST', headers, body: JSON.stringify(body),
    }, TIMEOUT.chat);
    let data;
    try { data = JSON.parse(text); } catch (e) { throw new Error('返回的不是 JSON：' + text.slice(0, 80)); }
    return pickText(data);
  }

  /**
   * 从返回体里取正文。推理模型的坑：
   *   content 是空的，真正的话在 reasoning_content 里，且被 max_tokens 截断了。
   * 这种情况要明确告诉用户换额度或换模型，不要拿思考过程冒充回答。
   */
  function pickText(data) {
    const ch = data && data.choices && data.choices[0];
    const msg = ch && (ch.message || ch.delta);
    let out = msg && (typeof msg.content === 'string' ? msg.content : '');
    if (!out) {
      // 有些中转把结果放在别处
      if (data && typeof data.content === 'string') out = data.content;
      else if (data && typeof data.output === 'string') out = data.output;
      else if (ch && typeof ch.text === 'string') out = ch.text;
    }
    if (out && String(out).trim()) return String(out);

    // 到这里说明正文真的是空的。看是不是推理模型吃光了额度
    const reason = (msg && (msg.reasoning_content || msg.reasoning)) || '';
    const fin = ch && ch.finish_reason;
    const used = data && data.usage && data.usage.completion_tokens;
    if (reason) {
      throw new Error('这个模型把额度全花在思考上了，正文没吐出来。\n'
        + '原因：' + (reason.length) + ' 字的推理内容占满了 max_tokens'
        + (used ? '（已用 ' + used + ' tokens）' : '') + (fin ? '，finish_reason=' + fin : '') + '。\n'
        + '换一个不带 -high / -thinking 的模型，或换带「假流式」「抗截断」前缀的版本。');
    }
    if (fin === 'length') {
      throw new Error('输出被 max_tokens 截断了（finish_reason=length），把额度调大，或缩短提示词。');
    }
    throw new Error('模型返回空内容：' + JSON.stringify(data).slice(0, 200));
  }

  /** 流式：有些中转在流式下会把思考过滤掉，只送正文，比非流式稳 */
  async function chatStream(url, headers, body) {
    const ctl = typeof AbortController === 'function' ? new AbortController() : null;
    const timer = ctl ? setTimeout(() => ctl.abort(), TIMEOUT.chat) : null;
    try {
      const res = await fetch(url, Object.assign(
        { method: 'POST', headers, body: JSON.stringify(body) },
        ctl ? { signal: ctl.signal } : {},
      ));
      if (!res.ok) {
        const t = await res.text();
        throw new Error('HTTP ' + res.status + '：' + t.slice(0, 160).replace(/\s+/g, ' '));
      }
      if (!res.body || typeof res.body.getReader !== 'function') {
        // 没有 body 流，退回普通解析
        const t = await res.text();
        try { return pickText(JSON.parse(t)); } catch (e) { throw e; }
      }
      const reader = res.body.getReader();
      const dec = new TextDecoder('utf-8');
      let acc = '';
      let reason = '';
      let fin = null;
      let buf = '';
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += dec.decode(value, { stream: true });
        const lines = buf.split('\n');
        buf = lines.pop();
        for (const line of lines) {
          const s = line.trim();
          if (!s || s[0] === ':') continue;
          if (s.indexOf('data:') !== 0) continue;
          const payload = s.slice(5).trim();
          if (!payload || payload === '[DONE]') continue;
          let o;
          try { o = JSON.parse(payload); } catch (e) { continue; }
          const ch = o.choices && o.choices[0];
          if (!ch) continue;
          const d = ch.delta || ch.message || {};
          if (d.content) acc += d.content;
          if (d.reasoning_content) reason += d.reasoning_content;
          if (ch.finish_reason) fin = ch.finish_reason;
        }
      }
      if (acc.trim()) return acc;
      if (reason) {
        throw new Error('这个模型把额度全花在思考上了，正文没吐出来。\n'
          + '推理内容 ' + reason.length + ' 字' + (fin ? '，finish_reason=' + fin : '') + '。\n'
          + '换一个不带 -high / -thinking 的模型。');
      }
      throw new Error('流式返回里没有正文（可能被中转过滤了）');
    } catch (e) {
      if (e && e.name === 'AbortError') throw new Error('请求超时（' + Math.round(TIMEOUT.chat / 1000) + ' 秒）');
      throw e;
    } finally {
      if (timer) clearTimeout(timer);
    }
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
  // 测试连接的额度：推理模型光思考就要几百 token，给少了正文是空的
  const TEST_MAX_TOKENS = 2000;

  async function test(conf) {
    const c = conf || getConf();
    const t0 = Date.now();
    const r = await chat('只回复两个字：可用', {
      module: undefined, temperature: 0, maxTokens: TEST_MAX_TOKENS,
    });
    return { ok: true, ms: Date.now() - t0, echo: String(r).slice(0, 40) };
  }

  window.__fiefAI = {
    loadAll, getConf, setConf, endpoint, maskKey, canon, storeOk,
    listModels, chat, extractJson,
    async testWith(conf) {
      const t0 = Date.now();
      const r = await chat('只回复两个字：可用', Object.assign(
        { temperature: 0, maxTokens: TEST_MAX_TOKENS }, conf,
      ));
      return { ms: Date.now() - t0, echo: String(r).slice(0, 40) };
    },
    _test: { endpoint, extractJson, STORE_KEY, pickText, TEST_MAX_TOKENS },
  };
})();
