/* AI 凭据设置面板。改这里。 */
/* ==========================================================================
 * 设置 · AI 凭据面板
 *
 * 形态照伊雍：
 *   接口地址 / API 密钥 / 可调用模型（拉取列表 + 下拉选择） / 已选择模型
 *   + 测试连接
 *
 * 每个模块单独配置，也可以一键应用到全部模块。
 * 目前只有「外交」用得上，其余留空待接。
 * ========================================================================== */
(() => {
  'use strict';

  /** 模块清单：以后接历史页、情报页就在这里加一行 */
  const MODULES = [
    { k: '外交', desc: '打探他国领地、生成对外情报' },
    // { k: '历史', desc: '……' },
  ];

  let escFn = (s) => String(s == null ? '' : s);
  let toastFn = () => {};
  let cur = '外交';        // 当前正在编辑的模块
  let models = [];        // 当前模块拉到的模型列表
  let busy = '';
  let err = '';

  function ai() { return window.__fiefAI; }

  function conf() { return ai() ? ai().getConf(cur) : { base: '', key: '', model: '' }; }

  /* -------------------------------------------------------------- 渲染 */
  function html() {
    if (!ai()) return '<div class="fl-empty"><b>◇</b>AI 通道未加载</div>';
    const c = conf();
    const list = MODULES.length > 1
      ? `<div class="fl-aic-tabs">${MODULES.map((m) => `<span class="fl-aic-tab${cur === m.k ? ' on' : ''}" data-m="${escFn(m.k)}">${escFn(m.k)}</span>`).join('')}</div>`
      : '';

    const modelOpts = models.length
      ? ['<option value="">— 请选择 —</option>'].concat(
        models.map((m) => {
          const parts = [m.id];
          if (m.price !== null && m.price !== undefined) parts.push('×' + m.price);
          if (m.busyLabel) parts.push(m.busyLabel);
          const label = parts.join('  ·  ');
          return `<option value="${escFn(m.id)}"${c.model === m.id ? ' selected' : ''}>${escFn(label)}</option>`;
        })
      ).join('')
      : `<option value="">${c.model ? escFn(c.model) + '（未拉取列表）' : '— 先点「拉取列表」 —'}</option>`;

    // 拉取后的分布摘要：一眼看出有几个能立刻用
    let distHtml = '';
    if (models.length) {
      const cnt = { idle: 0, normal: 0, congested: 0, other: 0 };
      models.forEach((m) => {
        if (m.busy === 'idle') cnt.idle += 1;
        else if (m.busy === 'normal') cnt.normal += 1;
        else if (m.busy === 'congested') cnt.congested += 1;
        else cnt.other += 1;
      });
      const chips = [];
      if (cnt.idle) chips.push(`<i class="fl-aic-tag idle">空闲 ${cnt.idle}</i>`);
      if (cnt.normal) chips.push(`<i class="fl-aic-tag normal">繁忙 ${cnt.normal}</i>`);
      if (cnt.other) chips.push(`<i class="fl-aic-tag other">未知 ${cnt.other}</i>`);
      if (cnt.congested) chips.push(`<i class="fl-aic-tag bad">拥堵 ${cnt.congested}</i>`);
      distHtml = `<div class="fl-aic-dist">共 ${models.length} 个　${chips.join('')}</div>`;
    }

    return `<div class="fl-aic">
      <div class="fl-aic-head">
        <div class="fl-aic-title">独立 API 凭据</div>
        <div class="fl-aic-sub">每个模块可单独配置，也可一键应用到全部模块</div>
      </div>
      ${list}

      <div class="fl-aic-f">
        <label class="fl-aic-l">接口地址</label>
        <div class="fl-aic-h">支持 OpenAI 兼容的聊天补全接口。</div>
        <input class="fl-aic-in" id="fl-aic-base" type="text" spellcheck="false" autocomplete="off"
          placeholder="https://example.com" value="${escFn(c.base)}">
      </div>

      <div class="fl-aic-f">
        <label class="fl-aic-l">API 密钥</label>
        <div class="fl-aic-h">不会写入世界书、聊天或导出资料；重新导入为新脚本时需要重新填写。</div>
        <input class="fl-aic-in" id="fl-aic-key" type="password" spellcheck="false" autocomplete="off"
          placeholder="sk-..." value="${escFn(c.key)}">
      </div>

      <div class="fl-aic-f">
        <label class="fl-aic-l">可调用模型</label>
        <div class="fl-aic-h">填写地址和密钥后拉取列表，再从中选择。</div>
        <div class="fl-aic-row">
          <div class="fl-aic-selwrap">
            <select class="fl-aic-sel" id="fl-aic-model"${models.length ? '' : ' disabled'}>${modelOpts}</select>
            <i class="fl-aic-caret">▾</i>
          </div>
        </div>
        <button class="fl-aic-btn ghost" id="fl-aic-pull"${busy ? ' disabled' : ''}>
          <span class="fl-aic-spin${busy === 'pull' ? ' on' : ''}">↻</span> ${busy === 'pull' ? '正在拉取…' : '拉取列表'}
        </button>
        ${distHtml}
      </div>

      <div class="fl-aic-f">
        <label class="fl-aic-l">已选择模型</label>
        <div class="fl-aic-cur">${c.model ? escFn(c.model) : '未选择'}</div>
        ${(() => {
    const hit = models.find((m) => m.id === c.model);
    if (!hit) return '';
    const bits = [];
    if (hit.price !== null && hit.price !== undefined) bits.push('单价 ×' + hit.price);
    if (hit.busyLabel) bits.push('当前 ' + hit.busyLabel);
    if (hit.busy === 'congested') bits.push('建议换一个');
    return bits.length ? `<div class="fl-aic-dist">${escFn(bits.join('　·　'))}</div>` : '';
  })()}
      </div>

      ${(() => {
    // 存储状态：只说存没存、本机能不能写。
    // 不显示地址，也不显示密钥的任何片段——截图会外流。
    const has = !!(c.base && c.key);
    const okStore = ai().storeOk ? ai().storeOk() : true;
    const bits = [];
    bits.push(has ? '<b style="color:#8fbf7f">已保存</b>' : '<b style="color:#c98a6a">未保存</b>');
    bits.push(okStore ? '本机可写' : '<b style="color:#c98a6a">本机存储不可写</b>');
    return bits.length ? '<div class="fl-aic-dist">' + bits.join('　·　') + '</div>' : '';
  })()}

      ${err ? `<div class="fl-aic-err">${escFn(err)}</div>` : ''}
      ${busy === 'test' ? '<div class="fl-aic-ok">正在测试连接…</div>' : ''}

      <div class="fl-aic-foot">
        <button class="fl-aic-btn primary" id="fl-aic-save">保存凭据</button>
        <button class="fl-aic-btn ghost" id="fl-aic-test"${busy ? ' disabled' : ''}>测试连接</button>
        <button class="fl-aic-btn ghost" id="fl-aic-apply"${MODULES.length > 1 ? '' : ' style="display:none"'}>应用到全部</button>
      </div>

      <div class="fl-aic-note">
        <b>说明</b>
        <div>地址可填 <code>https://host</code> 或 <code>https://host/v1</code>，脚本自动补 <code>/v1/chat/completions</code> 与 <code>/v1/models</code>。</div>
        <div>密钥只存在本机 localStorage，换设备或重新导入脚本要重填。</div>
        <div>如果提示「连不上 · 可能不允许跨域」，是本机浏览器被对方的 CORS 策略拦住了，脚本绕不过去。</div>
      </div>
    </div>`;
  }

  /* -------------------------------------------------------------- 绑定 */
  function bind(root) {
    if (!root) return;
    const q = (s) => root.querySelector(s);

    const baseI = q('#fl-aic-base');
    const keyI = q('#fl-aic-key');

    /**
     * 落盘。
     *
     * 以前只监听 change，手机上 change 要等失焦才触发——
     * 输完直接点「拉取列表」或切页，值就丢了。现在 input 也存，逐字落盘。
     */
    const commit = (silent) => {
      const c = conf();
      const next = {
        base: baseI ? baseI.value : c.base,
        key: keyI ? keyI.value : c.key,
        model: c.model,
      };
      const saved = ai().setConf(cur, next);
      // 回读一次，确认真写进去了
      const back = ai().getConf(cur);
      const okSave = back.base === saved.base && back.key === saved.key;
      if (!okSave && !silent) {
        err = '凭据没能存进本机存储。可能是浏览器的无痕模式或存储被禁用。';
        repaint(root);
      } else if (!silent) {
        err = '';
        toastFn('凭据已保存');
        repaint(root);
      }
      return okSave;
    };

    if (baseI) {
      baseI.addEventListener('input', () => commit(true));
      baseI.addEventListener('change', () => commit(true));
      baseI.addEventListener('blur', () => commit(true));
    }
    if (keyI) {
      keyI.addEventListener('input', () => commit(true));
      keyI.addEventListener('change', () => commit(true));
      keyI.addEventListener('blur', () => commit(true));
    }

    // 显式的保存按钮：手机上点一下最稳
    const save = q('#fl-aic-save');
    if (save) save.addEventListener('click', () => commit(false));

    root.querySelectorAll('.fl-aic-tab').forEach((n) => {
      n.addEventListener('click', () => {
        cur = n.dataset.m; models = []; err = ''; repaint(root);
      });
    });

    const sel = q('#fl-aic-model');
    if (sel) sel.addEventListener('change', () => {
      const c = conf();
      ai().setConf(cur, { base: c.base, key: c.key, model: sel.value });
      repaint(root);
    });

    const pull = q('#fl-aic-pull');
    if (pull) pull.addEventListener('click', async () => {
      // 先落盘输入框里的值
      const c = conf();
      ai().setConf(cur, {
        base: baseI ? baseI.value : c.base,
        key: keyI ? keyI.value : c.key,
        model: c.model,
      });
      const back = ai().getConf(cur);
      if (!back.base || !back.key) {
        err = '地址或密钥没存进去，先点一次「保存凭据」。';
        repaint(root);
        return;
      }
      busy = 'pull'; err = ''; repaint(root);
      try {
        const ids = await ai().listModels();
        models = ids;
        err = '';
        toastFn('拉到 ' + ids.length + ' 个模型');
      } catch (e) {
        models = [];
        err = '拉取失败：' + (e && e.message ? e.message : String(e));
      }
      busy = '';
      repaint(root);
    });

    const test = q('#fl-aic-test');
    if (test) test.addEventListener('click', async () => {
      const c = conf();
      ai().setConf(cur, {
        base: baseI ? baseI.value : c.base,
        key: keyI ? keyI.value : c.key,
        model: sel && sel.value ? sel.value : c.model,
      });
      busy = 'test'; err = ''; repaint(root);
      try {
        const r = await ai().testWith({});
        err = '';
        toastFn('连接正常 · ' + r.ms + 'ms · 回显「' + r.echo + '」');
      } catch (e) {
        err = '测试失败：' + (e && e.message ? e.message : String(e));
      }
      busy = '';
      repaint(root);
    });

    const apply = q('#fl-aic-apply');
    if (apply) apply.addEventListener('click', () => {
      const c = conf();
      MODULES.forEach((m) => ai().setConf(m.k, c));
      toastFn('已应用到全部模块');
      repaint(root);
    });
  }

  function repaint(root) {
    if (!root) return;
    const y = root.scrollTop;
    root.innerHTML = html();
    bind(root);
    root.scrollTop = y;
  }

  window.__fiefAISettings = {
    MODULES,
    mount(opts) {
      if (opts && opts.esc) escFn = opts.esc;
      if (opts && opts.toast) toastFn = opts.toast;
      return this;
    },
    render(container) {
      if (!container) return;
      container.innerHTML = html();
      bind(container);
    },
    _test: { html, MODULES },
  };
})();
