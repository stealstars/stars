/**
 * 世界书读取模块
 *
 * 目标：运行时从酒馆里读世界书条目，不硬编码任何名单。
 *
 * 酒馆助手的接口（见 JS-Slash-Runner 文档）：
 *   getWorldbookNames()           → string[]
 *   getWorldbook(name)            → Promise<WorldbookEntry[]>   ← 异步！
 *   getCharWorldbookNames('current') → { primary, additional[] }
 *   getGlobalWorldbookNames()     → string[]
 *
 * 条目的字段是 name / content / strategy.keys，不是 comment / key。
 *
 * 命定更新后重新扫一遍即可，不需要改脚本。
 *
 * 产物：window.__fiefBook
 *   scan()          → Promise<{ entries, factions, names, count, err }>
 *   scanSync()      → 已扫过就直接给缓存，没扫过返回 null
 *   factions[势力]  → { name, places[], overview[] }
 *   places[i]       → { faction, name, scale, where, people, len, content, tags }
 */
(function () {
  'use strict';

  var host = (typeof window !== 'undefined' && window.__fiefHost) || (typeof window !== 'undefined' ? window : globalThis);

  function TH() {
    return host.TavernHelper || host.tavernHelper
      || (typeof window !== 'undefined' && (window.TavernHelper || window.tavernHelper))
      || null;
  }

  /* ---------------------------------------------------------- 取条目 */

  /** 把各种形状的条目统一成 [{comment, content, keys, constant}] */
  function normalize(raw) {
    var out = [];
    if (!raw) return out;

    var src = null;
    if (Array.isArray(raw)) src = raw;
    else if (raw.entries && Array.isArray(raw.entries)) src = raw.entries;
    else if (raw.entries && typeof raw.entries === 'object') {
      src = Object.keys(raw.entries).map(function (k) {
        var e = raw.entries[k];
        if (e && typeof e === 'object' && e.uid == null) e = Object.assign({ uid: k }, e);
        return e;
      });
    } else return out;

    for (var i = 0; i < src.length; i += 1) {
      var e = src[i];
      if (!e || typeof e !== 'object') continue;
      var content = String(e.content != null ? e.content : '');
      if (!content.trim()) continue;

      // 酒馆助手的正式字段是 name；卡片导出格式用 comment。
      // 不能写成「comment != null 就用它」——酒馆助手常给出 comment:''，
      // 那样真名字就丢了，条目会变成「(总述)」并被归错类。
      var title = '';
      var cands = [e.name, e.comment, e.title];
      for (var ci = 0; ci < cands.length; ci += 1) {
        var v = cands[ci];
        if (v != null && String(v).trim()) { title = String(v); break; }
      }

      // 酒馆助手把关键字放在 strategy.keys
      var keys = [];
      if (Array.isArray(e.keys)) keys = e.keys.slice();
      else if (Array.isArray(e.key)) keys = e.key.slice();
      else if (e.strategy && Array.isArray(e.strategy.keys)) keys = e.strategy.keys.slice();

      var constant = !!e.constant
        || (e.strategy && e.strategy.type === 'constant');

      out.push({
        comment: String(title),
        content: content,
        keys: keys,
        constant: constant,
        order: e.insertion_order != null ? e.insertion_order
          : (e.order != null ? e.order : (e.position && e.position.order != null ? e.position.order : 0)),
        uid: e.uid,
      });
    }
    return out;
  }

  function isPromise(x) {
    return !!x && (typeof x === 'object' || typeof x === 'function') && typeof x.then === 'function';
  }

  /** 列出所有世界书名（同步） */
  function listNames() {
    var th = TH();
    var names = [];
    var push = function (v) {
      if (typeof v === 'string' && v && names.indexOf(v) < 0) names.push(v);
      else if (Array.isArray(v)) {
        for (var i = 0; i < v.length; i += 1) push(v[i]);
      }
    };
    if (th) {
      var fns = ['getWorldbookNames', 'getGlobalWorldbookNames'];
      for (var i = 0; i < fns.length; i += 1) {
        try { if (typeof th[fns[i]] === 'function') push(th[fns[i]]()); } catch (e) { /* 忽略 */ }
      }
      // 角色卡绑定的世界书
      try {
        if (typeof th.getCharWorldbookNames === 'function') {
          var cw = th.getCharWorldbookNames('current');
          if (cw && typeof cw === 'object') { push(cw.primary); push(cw.additional); }
        }
      } catch (e) { /* 忽略 */ }
      // 聊天绑定
      try {
        if (typeof th.getChatWorldbookName === 'function') push(th.getChatWorldbookName('current'));
      } catch (e) { /* 忽略 */ }
    }
    try {
      if (host.world_names && typeof host.world_names === 'object') push(Object.keys(host.world_names));
    } catch (e) { /* 忽略 */ }
    return names;
  }

  /**
   * 读一本书。酒馆助手的 getWorldbook 是异步的，这里统一成 Promise。
   * 也兼容同步返回的旧实现。
   */
  function readOne(name) {
    var th = TH();
    if (!th) return Promise.resolve(null);
    var fns = ['getWorldbook', 'getLorebook', 'getWorldbookEntries'];
    for (var i = 0; i < fns.length; i += 1) {
      var fn = th[fns[i]];
      if (typeof fn !== 'function') continue;
      try {
        var r = fn.call(th, name);
        if (isPromise(r)) {
          return r.then(function (v) {
            var list = normalize(v);
            return list.length ? list : null;
          }).catch(function () { return null; });
        }
        var list = normalize(r);
        if (list.length) return Promise.resolve(list);
      } catch (e) { /* 换下一个函数 */ }
    }
    return Promise.resolve(null);
  }

  /** 原生全局（同步） */
  function readNative() {
    var out = null;
    try {
      if (host.world_info && host.world_info.entries) out = normalize(host.world_info);
    } catch (e) { /* 忽略 */ }
    if (out && out.length) return out;
    try {
      if (host.worldBooks) {
        var n = normalize(host.worldBooks);
        if (n && n.length) return n;
      }
    } catch (e) { /* 忽略 */ }
    return null;
  }

  /**
   * 读全部已挂载世界书的条目（合并去重）。
   * 名字一个也没拿到时，再退回原生全局。
   */
  function readAll() {
    var names = listNames();
    var seen = {};
    var all = [];

    var absorb = function (list) {
      if (!list) return;
      for (var i = 0; i < list.length; i += 1) {
        var e = list[i];
        var key = e.comment + '|' + e.content.length + '|' + e.content.slice(0, 40);
        if (seen[key]) continue;
        seen[key] = 1;
        all.push(e);
      }
    };

    var tasks = names.map(function (n) {
      return readOne(n).then(function (list) {
        if (list) absorb(list);
      });
    });

    return Promise.all(tasks).then(function () {
      if (!all.length) {
        var nat = readNative();
        if (nat) absorb(nat);
      }
      return all;
    });
  }

  /* ---------------------------------------------------------- 解析势力树 */

  /**
   * 把 [本体][势力][势力名][子标签…]名字 拆开。
   * 不假设子标签叫什么——命定以后加新标签也能接住。
   */
  function splitFactionTag(comment) {
    var m = String(comment || '').match(/^\[本体\]\[势力\]\[([^\]]+)\]([\s\S]*)$/);
    if (!m) return null;
    var faction = m[1];
    var rest = m[2] || '';
    var tags = [];
    var tm;
    var re = /^\[([^\]]+)\]/;
    while ((tm = rest.match(re)) !== null) {
      tags.push(tm[1]);
      rest = rest.slice(tm[0].length);
    }
    // 剥掉作者签名 "(快乐柠萌茶)" "(△一串)" 之类
    var name = rest.replace(/\s*[（(][^）)]*[）)]\s*$/, '').trim();
    return { faction: faction, tags: tags, name: name, rawName: rest };
  }

  /**
   * 只靠名字就能排除的条目——这些不是地点。
   * 注意要在任意位置命中（「永夜盟约-政治与社会」这种前缀也得拦住）。
   */
  var NOT_PLACE = /(政治与社会|地理与文化|地理与治理|地理概览|地理|文化|贵族|军事|经济|历史|总览|派系|分割线|势力概况|简介|概述|社会结构|制度|宗教|信仰|习俗|节庆|语言|货币|贸易|产业|活动|派阀)/;

  /** 明显不是地点的子标签 */
  var NOT_PLACE_TAG = /^(派系|节庆|分割线|组织|制度|人物|角色|传说)$/;

  /**
   * 认地点：正文里的**字段名**才是最有辨识度的证据。
   *
   * 拿真实命定世界书统计过：
   *   地点条目必有 位置(132) / 环境(122) / 地理(39) / 气候(33) / 生态(24) / 地标(27)
   *   势力条目写    首府 / 领土 / 主要城市 / 统治者 / 主要贵族
   *   事件条目写    引子 / 各方态度 / 当前知情范围
   *   概念条目写    来源 / 核心特征 / 分类与特质
   * 所以「有没有地理字段」比「名字像不像地名」准得多。
   */
  var GEO_FIELD = /(?:^|[\n|｜])\s*(位置|环境|地理|气候|生态|地标|地形|水文|植被|人口构成|城区|行政区划|主要地形)\s*[:：]/g;

  /** 势力条目才有的字段——出现这些多半不是地点，但要看数量对比 */
  var FACTION_FIELD = /(?:^|[\n|｜])\s*(首府|领土|核心领土|统治者|主要贵族|主要城市|部落规模|宗旨|行事风格)\s*[:：]/g;

  function countHits(re, s) {
    var m = String(s || '').match(re);
    return m ? m.length : 0;
  }

  /** 兜底：名字像不像地名 */
  var GEO_NAME = /(城|镇|村|堡|要塞|港|湾|岛|群岛|山脉|山|岭|峰|林|谷|平原|荒原|沙漠|沼|湖|河|海|洋|洲|地标|街区|城区|区|街|巷|道|坊|广场|营地|聚落|关隘|塔|院|寺|殿|宫|馆|铺|市|集|桥|门|壁|营|厂|矿|田|园|庄|领|郡|省|州|甸|崖|坡|源|口|渡|驿|栈|屋|厅|堂|台|庭|域|壤|地|脊|礁|屿|港|池|泉|井|坑|穴|洞|林|苑|圃|坛|场|基|址)/;

  /**
   * 认地点的核心判据：条目正文里有「规模:」或「地点类别:」。
   *
   * 命定的地点条目写法不统一，同一件事有三种叫法：
   *   [诺斯加德联盟]  地点类别: 大型城市(庄园)
   *   [奥古斯提姆帝国] 规模: 大型城市
   *   [瓦伦蒂亚]      规模: 超级城市
   * 而势力总述写的是「定位:」「疆域:」，两者都没有。
   */
  var SCALE_RE = /(^|[\s|｜,，])(?:规模|地点类别|城市规模|等级规模)\s*[:：]\s*([^\n|｜]{1,24})/m;

  /**
   * 原文的规模写法五花八门，真正能对上七档的只有一部分。
   * 拿命定卡统计过：
   *   对得上     大型城市 / 中型城镇 / 小型村镇 / 村庄 / 超级城市
   *   归并不了   庞大城邦 / 远古生态区级 / 巨型城市 / 首都级 / 大型港市 / 中型圣所城镇
   *   根本不是规模  「30人以内」「50人以内」（那是人口）
   *               「高度: 平均高度240米…」（建筑高度，被 SCALE_RE 误抓）
   * 外交页以前直接把原文塞进档位标签，所以显示的是一堆非七档的词。
   */
  var TIER7 = ['村庄', '小型村镇', '中型城镇', '大型城市', '超级城市', '小国或帝国行省', '大国'];

  /** 原文规模 → 七档。比不中返回空串，绝不原样留着 */
  var TIER_RULES = [
    [/^村庄$/, '村庄'],
    [/^小型村镇$/, '小型村镇'],
    [/^中型城镇$/, '中型城镇'],
    [/^大型城市$/, '大型城市'],
    [/^超级城市$/, '超级城市'],
    [/^小国或帝国行省$/, '小国或帝国行省'],
    [/^大国$/, '大国'],

    [/^(村落|小村|村|屯|营地|聚落)$/, '村庄'],
    [/^(小镇|集镇|乡镇|镇)$/, '小型村镇'],

    // 城邦、首都这类一般顶一个城市甚至更高
    [/^(庞大城邦|巨型城邦|大城邦|城邦|自由邦)$/, '超级城市'],
    [/^(巨型城市|超大城市|大都会|都会|巨型港市|大型港市|自由港)$/, '超级城市'],
    [/^(首都级|王都|帝都|都城|首府)$/, '超级城市'],
    [/^(远古生态区级|生态区级|巨型生态区)$/, '超级城市'],

    [/^(中型圣所城镇|圣所城镇)$/, '中型城镇'],
    [/^(大型城市|大城市|城市|大城)$/, '大型城市'],
    [/^(要塞|军港|关隘|港口|港市)$/, '中型城镇'],

    [/^(行省|帝国行省|小国|公国|伯国|侯国)$/, '小国或帝国行省'],
    [/^(王国|帝国|联邦|联盟|汗国|大公国)$/, '大国'],
  ];

  /**
   * 原文规模 → 七档。
   * 会剥掉括号补充（「大型城市(港口)」）、取区间里大的那个（「村庄-小型村镇」）。
   */
  function cleanTier7(raw) {
    var t = String(raw || '').trim();
    if (!t) return '';
    // 明显不是规模的：人口、高度、距离
    if (/^\d+\s*(人|口|米|里|丈)/.test(t)) return '';
    if (/^(高度|面积|长度|宽度|人口|驻军)\s*[:：]/.test(t)) return '';
    if (/^\d/.test(t) && !/级|档|等/.test(t)) return '';

    var stem = t.replace(/[（(][^）)]*[）)]/g, '').trim();
    var cands = [t, stem];
    var inParen = (t.match(/[（(]([^）)]*)[）)]/g) || []).join(' ')
      .replace(/[（()）]/g, ' ').trim();

    for (var i = 0; i < cands.length; i += 1) {
      var c = String(cands[i] || '').trim();
      if (!c) continue;
      // 区间「村庄-小型村镇」取大的
      var segs = c.split(/[-—~～至]/).map(function (x) { return x.trim(); }).filter(Boolean);
      if (segs.length > 1) {
        var best = '';
        for (var s = 0; s < segs.length; s += 1) {
          var one = cleanTier7(segs[s]);
          if (one && TIER7.indexOf(one) > TIER7.indexOf(best || '村庄')) best = one;
        }
        if (best) return best;
      }
      for (var r = 0; r < TIER_RULES.length; r += 1) {
        if (TIER_RULES[r][0].test(c)) return TIER_RULES[r][1];
      }
    }
    if (inParen) {
      for (var r2 = 0; r2 < TIER_RULES.length; r2 += 1) {
        if (TIER_RULES[r2][0].test(inParen)) return TIER_RULES[r2][1];
      }
    }
    return '';
  }

  function placeScale(content) {
    var m = String(content || '').match(SCALE_RE);
    if (!m) return '';
    // 归并进七档；归并不了就留空，宁可没有也别显示「远古生态区级」
    return cleanTier7(m[2]);
  }

  /** 原文那句规模写了什么（想知道为什么归并不了就看这个） */
  function placeScaleRaw(content) {
    var m = String(content || '').match(SCALE_RE);
    return m ? m[2].trim() : '';
  }

  /** 从正文里捞出位置、人口这些现成字段，省得再让 AI 猜 */
  function pickField(content, keys) {
    for (var i = 0; i < keys.length; i += 1) {
      var re = new RegExp('(?:^|[\\s|｜])' + keys[i] + '\\s*[:：]\\s*([^\\n]{1,80})', 'm');
      var m = String(content || '').match(re);
      if (m && m[1].trim()) return m[1].trim();
    }
    return '';
  }

  /**
   * 从势力的「地理」条目里拆行省。
   *
   * 原文长这样（缩进是有意义的）：
   *
   *   地理:
   *     区域分布:
   *       艾瑟尼亚省:
   *         介绍: 位于中部核心…
   *         艾瑟嘉德(首都): “永恒的辉光之城”…
   *         特色城镇: 白石镇
   *       维里迪斯省:
   *         金谷城(省会): 最大粮食集散地…
   *
   * 判据：
   *   省   缩进 N 层、以「省/州/郡/大区/领地」结尾、后面跟冒号
   *   城市 缩进 N+1 层、冒号前的名字带 (首都)/(省会)/(省府) 之类的身份
   *        「特色城镇: 白石镇」这种是字段不是城市，要单独取冒号后的名字
   *
   * 只认世界书里真写了的，一个省都没写就返回空数组。
   */
  function parseProvinces(fac) {
    var out = [];
    var src = '';

    // 「地理」类条目里才有区域分布
    var pool = (fac.overview || []).concat(fac.places || []);
    for (var i = 0; i < pool.length; i += 1) {
      var c = String(pool[i].content || '');
      if (c.indexOf('区域分布') < 0) continue;
      src = c;
      break;
    }
    if (!src) return out;

    var lines = src.split(/\r?\n/);
    var inBlock = false;
    var baseIndent = -1;
    var cur = null;

    var indentOf = function (s) {
      var m = String(s).match(/^(\s*)/);
      return m ? m[1].replace(/\t/g, '  ').length : 0;
    };
    var PROV = /^(.{1,12}?)(省|州|郡|大区|行省|领地|辖区)\s*[:：]\s*$/;
    for (var li = 0; li < lines.length; li += 1) {
      var raw = lines[li];
      if (!raw || !raw.trim()) continue;
      var ind = indentOf(raw);
      var txt = raw.trim();

      if (txt.indexOf('区域分布') === 0) { inBlock = true; baseIndent = ind; continue; }
      if (!inBlock) continue;
      // 退回到跟「区域分布」同级或更浅，说明这一段结束了
      if (ind <= baseIndent) { inBlock = false; cur = null; continue; }

      // 省名行
      var pm = txt.match(PROV);
      if (pm) {
        // 保留后缀：「艾瑟尼亚省」而不是「艾瑟尼亚」
        cur = { name: pm[1].trim() + pm[2], capital: '', cities: [], desc: '' };
        out.push(cur);
        continue;
      }
      if (!cur) continue;

      // 介绍：后面不跟城市
      var im = txt.match(/^(介绍|说明|概述)\s*[:：]\s*(.*)$/);
      if (im) { cur.desc = im[2].trim(); continue; }

      /**
       * 城市行。三种写法：
       *   艾瑟嘉德(首都): …        ← 名字带身份
       *   金谷城(省会): …          ← 名字带身份
       *   特色城镇: 白石镇          ← 字段，名字在后面
       *   霜临城(省会)             ← 没冒号
       */
      var fm = txt.match(/^(特色城镇|主要城市|城镇|城市|下辖)\s*[:：]\s*(.+)$/);
      if (fm) {
        var list = fm[2].split(/[，,、;；]/);
        for (var q = 0; q < list.length; q += 1) {
          var nm = stripParen(list[q]);
          if (nm && cur.cities.indexOf(nm) < 0) cur.cities.push(nm);
        }
        continue;
      }

      var cm = txt.match(/^([^:：]{1,20}?)\s*[（(](首都|省会|省府|首府|主城)[）)]\s*(?:[:：].*)?$/);
      if (cm) {
        var cn = cm[1].trim();
        if (cn && cur.cities.indexOf(cn) < 0) cur.cities.push(cn);
        if (cm[2] === '省会' || cm[2] === '省府' || cm[2] === '首府') cur.capital = cn;
        if (cm[2] === '首都') cur.capital = cn;
        continue;
      }

      var names = txt.match(/^([^:：]{1,20}?)\s*[:：]\s*\S/);
      if (names) {
        var n2 = stripParen(names[1]);
        if (n2 && /[城镇村堡垒港]$/.test(n2) && cur.cities.indexOf(n2) < 0) cur.cities.push(n2);
      }
    }
    // 一个城市都没列出来的省不算
    return out.filter(function (p) { return p.cities.length > 0; });
  }

  function stripParen(s) {
    return String(s || '').replace(/[（(][^）)]*[）)]/g, '').replace(/[，,、;；。\s]+$/g, '').trim();
  }

  function buildFactionTree(entries) {
    var factions = {};

    // 先摸一遍：哪些 tag 其实是「子势力」名。
    // 判据：这个 tag 自己就是一个条目的名字，而且那条目不是地点。
    //   [兽族联盟][鼠族王国]鼠族王国      ← 鼠族王国 是子势力，条目本身是势力总述
    //   [兽族联盟][风信子城]风信子城      ← 风信子城 是地点，条目写「规模:」
    // 不做这一步的话，「鼠族王国」会被当成枢机厅的上级地点。
    var subFactions = {};
    var i0;
    for (i0 = 0; i0 < entries.length; i0 += 1) {
      var s0 = splitFactionTag(entries[i0].comment);
      if (!s0 || !s0.name) continue;
      if (placeScale(entries[i0].content)) continue;          // 有规模 = 地点，不是势力
      var b0 = String(entries[i0].content || '');
      if (countHits(FACTION_FIELD, b0) > 0) subFactions[s0.name] = true;
    }
    var SUB_FACTION = function (t) { return !!subFactions[t]; };

    /**
     * 这些 tag 是**类型标签**，不是上级地点名。
     *   [精灵王庭][地块]中央平原区          ← 「地块」是类型
     *   [诺斯加德联盟][城镇]林歌城          ← 「城镇」是类型
     * 当成父级会造出一堆指向不存在条目的孤儿。
     */
    var TYPE_TAG = /^(地块|城镇|城市|村落|村庄|乡镇|要塞|港口|军港|圣所|大型城市|中型城镇|小型村镇|超级城市|小国|行省|帝国行省|势力|本体|地点|地标|城区|区域|聚落|营地|关隘|遗迹|胜景|建筑|设施|分割线|节庆|事件|人物|角色|组织|制度|传说|派系|经济|军事|文化|地理|历史)$/;

    for (var i = 0; i < entries.length; i += 1) {
      var e = entries[i];
      var sp = splitFactionTag(e.comment);
      if (!sp) continue;
      if (!factions[sp.faction]) {
        factions[sp.faction] = { name: sp.faction, places: [], overview: [] };
      }
      var scale = placeScale(e.content);
      var node = {
        faction: sp.faction,
        tags: sp.tags,
        name: sp.name || '(总述)',
        len: e.content.length,
        scale: scale,
        where: pickField(e.content, ['位置', '地点']),
        people: pickField(e.content, ['人口构成', '人口']),
        content: e.content,
        comment: e.comment,
        isPlace: false,
      };

      /**
       * 地点要同时满足：
       *   ① 名字和子标签都不像「政治与社会」「人物」这类非地点条目
       *   ② 名字不等于势力名（那条是势力总述）
       *   ③ 正文给了规模，或子标签本身就是地理类（城镇/城区/地标…）
       *
       * 以前写成 (!!scale || !!sp.name)，而 sp.name 几乎永远为真，
       * 等于只看了 ①② —— 任何有名字的条目都会被当成地点。
       */
      var byName = NOT_PLACE.test(sp.name);
      var byTag = sp.tags.some(function (t) { return NOT_PLACE_TAG.test(t); });
      var bySelf = sp.name === sp.faction || !sp.name;
      var body = String(e.content || '');
      var geoN = countHits(GEO_FIELD, body);
      var facN = countHits(FACTION_FIELD, body);
      // 证据从强到弱：
      //   ① 正文写了「规模:」              → 一定是地点
      //   ② 地理字段多于势力字段           → 地点
      //      （「联盟直辖区」同时有 首府/领土 和 位置/环境，按数量判它还是地点）
      //   ③ 名字像地名且没有势力字段       → 兜底
      var geoName = GEO_NAME.test(sp.name);
      var byField = geoN > 0 && geoN >= facN;
      // 名字明确是地理单元（「联盟直辖区」「XX区」「XX公国领地」）——
      // 这类条目常借用势力的字段格式（首府/领土/统治者），但读的人要把它当地点看
      var strongName = /(直辖区|辖区|辖区|区|省|郡|州|领|地块|半岛|群岛|盆地|高原|平原|山脉)$/.test(sp.name);
      node.isPlace = !byName && !byTag && !bySelf
        && (!!scale || byField || strongName || (geoName && facN === 0));
      node.why = scale ? 'scale' : (byField ? 'field' : (strongName ? 'strongname' : (geoName && facN === 0 ? 'name' : '')));

      /**
       * 层级：条目名里的方括号是有顺序的。
       *   [本体][势力][兽族联盟][鼠族王国][风信子城][皇城区]枢机厅
       *                    faction        tags[0]   tags[1]  tags[2]  name
       * 从右往左看 tags，第一个不是子势力的，就是直接上级地点。
       * 「鼠族王国」这类是子势力（下面还会再出现地点），跳过。
       */
      var parent = '';
      for (var ti = sp.tags.length - 1; ti >= 0; ti -= 1) {
        var tk = String(sp.tags[ti] || '');
        if (!tk) continue;
        if (NOT_PLACE_TAG.test(tk)) break;
        // 类型标签不是上级地名：[精灵王庭][城镇]林歌城
        if (TYPE_TAG.test(tk)) continue;
        // 自指：条目名和 tag 一样（[风信子城]风信子城），那是重复标注，跳过
        if (tk === sp.name) continue;
        // 子势力名：本势力下所有条目都带这个 tag，且它本身也是势力条目
        if (SUB_FACTION && SUB_FACTION(tk)) continue;
        parent = tk;
        break;
      }
      node.parent = parent;
      node.depth = parent ? 2 : 1;

      if (node.isPlace) factions[sp.faction].places.push(node);
      else factions[sp.faction].overview.push(node);
    }

    /**
     * 补一层「大城市/大区」分组。
     *
     * 玩家："十个国家点进去直接就是城市了，没有大国啊"
     *
     * 世界书的结构是 [势力][大城市][城区]具体地点：
     *   [索伦蒂斯王国][潮汐王座]天穹之冠
     *   [兽族联盟][风信子城][皇城区]枢机厅
     * 「潮汐王座」自己**没有条目**，只是个前缀——所以它不是 places 里的节点，
     * 子项全变成了孤儿、看起来直接挂在国家下面。
     *
     * 这里用两级原文信息把这一层补出来：
     *   ① 「主要城市: 潮汐王座(首都)，珍珠湾，风暴堡…」  ← 势力总述里的字段
     *   ② 条目名里的方括号前缀                          ← 子项自己带的信息
     * 两条对得上的，建一个 group 节点。不编名字，只用原文出现过的。
     */
    var FAC_KEYS = Object.keys(factions);
    for (var fi = 0; fi < FAC_KEYS.length; fi += 1) {
      var fname = FAC_KEYS[fi];
      var fac = factions[fname];

      // ① 从势力总述里抽「主要城市 / 核心领土」
      var declared = [];
      var ovs = fac.overview;
      for (var oi = 0; oi < ovs.length; oi += 1) {
        var oc = String(ovs[oi].content || '');
        var mcRe = /(?:^|[\s|｜])(?:主要城市|核心城市|下辖城市|城市列表)\s*[:：]\s*([^\n]{1,300})/m;
        var mm = oc.match(mcRe);
        if (mm) {
          // 「潮汐王座(首都)，珍珠湾(博彩与红灯区之都)」→ 取括号前的名字
          var parts = mm[1].split(/[，,、;；]/);
          for (var pi = 0; pi < parts.length; pi += 1) {
            var nm0 = parts[pi].replace(/[（(][^）)]*[）)]/g, '').trim();
            if (nm0 && declared.indexOf(nm0) < 0) declared.push(nm0);
          }
        }
        var ctRe = /(?:^|[\s|｜])核心领土\s*[:：]\s*([^\n]{1,120})/m;
        var cm = oc.match(ctRe);
        if (cm) {
          var rg0 = cm[1].replace(/全境|范围|区域|地区|不含.*$/g, '')
            .replace(/[，,、;；。.\s]+$/g, '').trim();
          if (rg0 && declared.indexOf(rg0) < 0) declared.push(rg0);
        }
      }

      // ② 数每个名字下面挂了多少条
      //    两种都要算：
      //      a) 父级是 places 里的节点（「风信子城」自己有条目）→ 那条就是子项
      //      b) 父级不在 places 里（「潮汐王座」没条目）→ 需要建虚拟层
      var used = {};
      var pls = fac.places;
      var nameSet = {};
      for (var pk = 0; pk < pls.length; pk += 1) nameSet[pls[pk].name] = pls[pk];

      // a) 自己就是节点的：它下面挂的也算它的
      for (var pa = 0; pa < pls.length; pa += 1) {
        var paNode = pls[pa];
        if (!paNode.parent) continue;
        used[paNode.parent] = (used[paNode.parent] || 0) + 1;
      }
      // b) 已经在上面的循环里统一算了（父级不存在的也在 used 里）
      //    区分「要不要建虚拟层」看父级在不在 nameSet

      // ③ 只收「原文声明过」或「至少 2 个子项」的，避免一个子项就立个组
      var groups = [];
      var usedKeys = Object.keys(used);
      for (var ui = 0; ui < usedKeys.length; ui += 1) {
        var un = usedKeys[ui];
        var isDeclared = declared.indexOf(un) >= 0;
        if (!isDeclared && used[un] < 2) continue;
        if (TYPE_TAG.test(un)) continue;
        groups.push({
          name: un,
          // 有实体条目 → 正常节点；没有 → 虚拟层
          kind: nameSet[un] ? 'node' : (isDeclared ? 'declared' : 'inferred'),
          count: used[un],
        });
      }
      // 声明了、但「一条子项都没有」的，标出来
      // 注意：有自己条目但没子项的（石蒜城），那是正常叶子节点，不是空声明
      for (var di = 0; di < declared.length; di += 1) {
        var dn = declared[di];
        if (used[dn]) continue;
        if (TYPE_TAG.test(dn) || dn === fname) continue;
        if (nameSet[dn]) {
          // 有条目、只是没有下级 → 正常叶子，不列进 groups（它已经在 places 里）
          continue;
        }
        groups.push({ name: dn, kind: 'declared-empty', count: 0 });
      }
      fac.groups = groups;
      fac.declared = declared;

      /**
       * 公国层：有些势力的中层是「政治实体」而不是城市。
       *
       *   [诺斯加德联盟]埃吉尔海德公国
       *     首府: 凛风渡
       *     领土: 核心领土: 雾凇海岸全境
       *           飞地辖区: 风切半岛西部沿海，含霜镜港与白港
       *
       * 这一层原文写得很清楚（首府 + 核心领土 + 飞地），照抄就行：
       *   公国 → 首府（城市）+ 核心领土（大区）+ 飞地（含哪些城）
       * 关系：
       *   埃吉尔海德公国  首府 凛风渡   核心领土 雾凇海岸   飞地含 霜镜港、白港
       */
      var duchies = [];
      var ovAll = fac.overview.concat(fac.places);
      for (var qi = 0; qi < ovAll.length; qi += 1) {
        var q = ovAll[qi];
        var qc = String(q.content || '');
        var capM = qc.match(/(?:^|[\s|｜])首府\s*[:：]\s*([^\n|｜，,]{1,30})/m);
        if (!capM) continue;
        var coreM = qc.match(/(?:^|[\s|｜])核心领土\s*[:：]\s*([^\n|｜]{1,60})/m);
        var enclM = qc.match(/(?:^|[\s|｜])(?:飞地辖区|飞地|控制区|边境防区)\s*[:：]\s*([^\n|｜]{1,80})/m);

        var cap = capM[1].trim();
        // 「雾凇海岸全境」「风切半岛全境，不含霜镜港与白港」→ 只取地名
        var core = coreM ? coreM[1]
          .replace(/全境|范围$/g, '')
          .replace(/[，,]\s*不含.*$/g, '')
          .replace(/[，,、;；。.\s]+$/g, '').trim() : '';
        // 飞地里提到的已有地名（「含霜镜港与白港」）
        var encl = [];
        if (enclM) {
          for (var ei = 0; ei < fac.places.length; ei += 1) {
            var pn = fac.places[ei].name;
            if (pn && enclM[1].indexOf(pn) >= 0 && encl.indexOf(pn) < 0) encl.push(pn);
          }
        }
        duchies.push({
          name: q.name,
          capital: cap,
          core: core,
          enclaves: encl,
          overview: q.content,
        });
      }
      fac.duchies = duchies;

      /**
       * 把「大区」型地点（有独立条目、名字出现在某公国的核心领土里）标成 region，
       * 让界面能把它跟普通城镇区分开。
       *   雾凇海岸  有条目（1290 字），是埃吉尔海德公国的核心领土 → region
       */
      for (var ri = 0; ri < fac.places.length; ri += 1) {
        var rp = fac.places[ri];
        for (var dj = 0; dj < duchies.length; dj += 1) {
          if (duchies[dj].core && rp.name === duchies[dj].core) {
            rp.region = true;
            rp.duchy = duchies[dj].name;
          }
          if (duchies[dj].capital && rp.name === duchies[dj].capital) {
            rp.capital = true;
            rp.duchy = duchies[dj].name;
          }
        }
      }

      /**
       * 行省层。
       *
       * 帝国总述里明写着「行政体系: 中央＞行省(王国级)＞郡/市/公国领＞镇＞村」，
       * 「地理」条目里也按省列了城市：
       *
       *   区域分布:
       *     艾瑟尼亚省:
       *       介绍: 位于中部核心…
       *       艾瑟嘉德(首都): "永恒的辉光之城"…
       *       特色城镇: 白石镇
       *     维里迪斯省:
       *       金谷城(省会): 最大粮食集散地…
       *
       * 结构是「省名:」后面缩进一串城市行。这里按缩进层级把省和城市拆出来，
       * 城市用括号里的（首都）（省会）标身份，用同省条目对名字。
       */
      var provinces = parseProvinces(fac);
      for (var pi = 0; pi < provinces.length; pi += 1) {
        var pv = provinces[pi];
        for (var pj = 0; pj < pv.cities.length; pj += 1) {
          for (var pk = 0; pk < fac.places.length; pk += 1) {
            var pp = fac.places[pk];
            if (pp.name !== pv.cities[pj]) continue;
            pp.province = pv.name;
            if (pv.name === (pv.capital || '')) pp.capital = true;
          }
        }
        // 省会那个城
        if (pv.capital) {
          for (var pl = 0; pl < fac.places.length; pl += 1) {
            if (fac.places[pl].name === pv.capital) fac.places[pl].provinceCapital = pv.name;
          }
        }
      }
      fac.provinces = provinces;

      /**
       * 势力体量概览。
       *
       * 外交页的卡片原来只有「名字 + 地点数」，看不出这是个帝国还是城邦。
       * 这里按世界书里**真实存在**的东西数一遍，不猜。
       * 必须放在 duchies / region / capital 都算完之后，否则公国数永远是 0。
       */
      var nRegion = 0;
      var nCapital = 0;
      var nChild = 0;
      var nCity = 0;
      for (var vi = 0; vi < fac.places.length; vi += 1) {
        var vp = fac.places[vi];
        if (vp.region) nRegion += 1;
        else if (vp.capital) nCapital += 1;
        else if (vp.parent) nChild += 1;
        else nCity += 1;
      }
      var nDuchy = duchies.length;
      fac.size = {
        duchies: nDuchy,
        regions: nRegion,
        capitals: nCapital,
        cities: nCity,
        districts: nChild,
        places: fac.places.length,
        overviews: fac.overview.length,
      };
      // 有公国就先说公国 —— 这才是「国家大块」
      var bits = [];
      if (nDuchy) {
        bits.push(nDuchy + ' 公国');
        if (nCity) bits.push(nCity + ' 城');
      } else if (nCity) {
        bits.push(nCity + ' 城');
      }
      if (nRegion) bits.push(nRegion + ' 疆域');
      if (nChild) bits.push(nChild + ' 城区');
      fac.kind = bits.length ? bits.join(' · ')
        : (fac.places.length ? '只有地点条目' : '只有总述');
    }

    return factions;
  }

  /* ---------------------------------------------------------- 对外 */

  var cache = null;

  /** 扫一遍（异步）。force=false 且已扫过就直接返回缓存 */
  function scan(force) {
    if (cache && !force) return Promise.resolve(cache);
    return readAll().then(function (entries) {
      cache = {
        entries: entries,
        factions: buildFactionTree(entries),
        names: listNames(),
        count: entries.length,
        err: entries.length ? '' : '世界书里一条条目也没读到',
        at: Date.now(),
      };
      return cache;
    });
  }

  function scanSync() { return cache; }

  host.__fiefBook = {
    scan: scan,
    scanSync: scanSync,
    readAll: readAll,
    readOne: readOne,
    buildFactionTree: buildFactionTree,
    splitFactionTag: splitFactionTag,
    listNames: listNames,
    normalize: normalize,
    placeScale: placeScale,
    placeScaleRaw: placeScaleRaw,
    cleanTier7: cleanTier7,
    TIER7: TIER7,
    pickField: pickField,
    /** 诊断：把能查到的东西全列出来，扫不到时照着这个看断在哪 */
    debug: function () {
      var th = TH();
      var d = {
        TavernHelper: !!th,
        世界书名: listNames(),
        有getWorldbook: !!(th && typeof th.getWorldbook === 'function'),
        缓存条目: cache ? cache.count : null,
      };
      try {
        if (th && typeof th.getCharWorldbookNames === 'function') {
          d.角色卡世界书 = th.getCharWorldbookNames('current');
        }
      } catch (e) { d.角色卡世界书 = 'ERR ' + e.message; }
      return d;
    },
    /** 异步诊断：实际去读一遍，报告每本书读到几条 */
    probe: function () {
      var names = listNames();
      return Promise.all(names.map(function (n) {
        return readOne(n).then(function (l) { return { 书: n, 条目: l ? l.length : 0 }; });
      })).then(function (rows) {
        return { 书数: names.length, 明细: rows };
      });
    },
  };
})();
