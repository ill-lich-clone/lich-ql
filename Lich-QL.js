(() => {
  'use strict';

  // ───────────────────────────────────────────────────────────────────────────
  // КОНСТАНТЫ / СТИЛИ
  // ───────────────────────────────────────────────────────────────────────────
  const STYLE_BTN    = "background:#404040;color:#eee;padding:2px 5px;border-radius:5px;text-decoration:none;margin:0 3px;";
  const STYLE_BOX    = "border:1px solid #000;padding:4px;font-size:0.9rem;max-width:360px;";
  const STYLE_REPORT = "border:1px solid #000;background:#ccc;padding:4px 6px;font-size:90%;line-height:1.12;";
  const STYLE_HDR = "font-weight:bold;background:#404040;color:#fff;padding:2px 4px;margin:0;line-height:1.12;";
  const CSS_BUMP     = "display:block; position:relative; left:-5px; top:-30px; margin-bottom:-34px;";
  const CSS_BUMP_SMALL = "display:block; position:relative; left:-4px; top:-16px; margin-bottom:-16px;";

  const box         = (html) => `<div style="${STYLE_BOX}">${html}</div>`;
  const openReport  = `<div style="${STYLE_REPORT} ${CSS_BUMP_SMALL}">`;
  const closeReport = `</div>`;
  const openHdr     = `<div style="${STYLE_HDR}">`;
  const closeHdr    = `</div>`;

  // Нажимабельная ссылка-кнопка
  function btn(label, cmd, title){
    const tt = title ? ` title="${title}"` : '';
    const safe = String(cmd).replace(/:(\d+)$/, '&#58;$1').replace(/"/g,'&quot;').replace(/&/g,'&amp;');
    return `<a href="${safe}"${tt} style="${STYLE_BTN}">${label}</a>`;
  }
  // Строитель команд единого диспетчера
  const cmd = (action, payload='') => `!dmscan --${action}|${payload}`;
  // Универсальная отправка отчёта игроку и ГМу.
  // playerBtns / gmBtns — массивы {label, cmd, title?}
  // opts: { toGM?:boolean=true, toPlayer?:boolean=true }
  function sendDualReport(msg, summaryHtml, playerBtns=[], gmBtns=[], from='', opts){
      opts = Object.assign({ toGM:true, toPlayer:true }, opts||{});
      const renderBtns = (btns)=> btns.map(b=>btn(b.label, b.cmd, b.title||'')).join('');
      const row = (btns)=> btns.length
        ? `<div style="margin-top:5px;display:flex;gap:6px;flex-wrap:wrap;align-items:center;">${renderBtns(btns)}</div>`
        : '';
    
      // игрок видит только "игровые" кнопки
      const playerBlock = openReport + summaryHtml + row(playerBtns) + closeReport;
      // ГМ видит те же + админские (Отменить и т.п.) — всё в ОДНУ строку
      const gmBlock     = openReport + summaryHtml + row(playerBtns.concat(gmBtns)) + closeReport;
    
      if (opts.toGM){
        sendChat('', `/w gm ${gmBlock}`, {noarchive:true});      // пустой спикер → без "From DM-Scan"
      }
      if (opts.toPlayer){
        const p = getObj('player', msg.playerid);
        if (p && !playerIsGM(msg.playerid)){
          const pname = p.get('displayname');
          sendChat('', `/w "${pname}" ${playerBlock}`, {noarchive:true});
        }
      }
    }

  // ───────────────────────────────────────────────────────────────────────────
  // СОСТОЯНИЕ
  // ───────────────────────────────────────────────────────────────────────────
  state.DMS = state.DMS || {};
  state.DMS.DamageDetails    = state.DMS.DamageDetails    || {};
  state.DMS.IgnoreBar3Update = state.DMS.IgnoreBar3Update || {};
  state.DMS.JustSpawned      = state.DMS.JustSpawned      || {};
  state.DMS.HPLock           = state.DMS.HPLock           || {};
  state.DMS.LootLog          = state.DMS.LootLog          || [];
  state.DMS.LootPending      = state.DMS.LootPending      || {};   // ожидания «Забрать деньги»
  state.DMS.LootOps          = state.DMS.LootOps          || {};   // совершённые операции (для отката)
  state.DMS.LootHistory      = state.DMS.LootHistory      || {}; // id → {charId,name,ts}
  state.DMS.LastLootGC       = state.DMS.LastLootGC       || 0;   // время последней уборки
  state.DMS = state.DMS                                   || {};
  state.DMS.PageSwitchTs     = state.DMS.PageSwitchTs     || 0;

  on('add:token', (tok) => { state.DMS.JustSpawned[tok.id] = Date.now(); });

  // ───────────────────────────────────────────────────────────────────────────
  // ПАТТЕРНЫ СТАТУСОВ
  // ───────────────────────────────────────────────────────────────────────────
  const STATUS_PATTERNS = [
    { name:"окружённый",      cmd:"окружённый",      re:/окруж[её]н[а-яё]*/i },
    { name:"сбитый с ног",    cmd:"сбитый с ног",    re:/сбит[а-яё ]*с ног|падает ничком/i },
    { name:"схваченный",      cmd:"схваченный",      re:/схваченн[а-яё]*|схвачен[а-яё]*/i },
    { name:"отравленный",     cmd:"отравленный",     re:/отравленн[а-яё]*|отравлен[а-яё]*/i },
    { name:"испуганный",      cmd:"испуганный",      re:/испуганн[а-яё]*|испуган[а-яё]*/i },
    { name:"невидимый",       cmd:"невидимый",       re:/невидим[а-яё]*/i },
    { name:"ослеплённый",     cmd:"ослеплённый",     re:/ослепл[её]нн[а-яё]*|ослепл[её]н[а-яё]*|ослепленн[а-яё]*|ослеплен[а-яё]*/i },
    { name:"недееспособный",  cmd:"недееспособный",  re:/недееспособн[а-яё]*/i },
    { name:"запутанный",      cmd:"запутанный",      re:/запутанн[а-яё]*|запутан[а-яё]*/i },
    { name:"опутанный",       cmd:"опутанный",       re:/опутанн[а-яё]*|опутан[а-яё]*/i },
    { name:"бессознательный", cmd:"бессознательный", re:/бессознательн[а-яё]*/i },
    { name:"ошеломлённый",    cmd:"ошеломлённый",    re:/ошеломл[её]нн[а-яё]*|ошеломл[её]н[а-яё]*|ошеломленн[а-яё]*|ошеломлен[а-яё]*/i },
    { name:"парализованный",  cmd:"парализованный",  re:/парализованн[а-яё]*|парализован[а-яё]*/i },
    { name:"истощённый",      cmd:"истощённый",      re:/истощ[её]нн[а-яё]*|истощ[её]н[а-яё]*/i },
    { name:"очарованный",     cmd:"очарованный",     re:/очарованн[а-яё]*|очарован[а-яё]*/i },
    { name:"оглохший",        cmd:"оглохший",        re:/оглохш[а-яё]*|оглушен[а-яё]*/i },
    { name:"газообразный",    cmd:"газообразный",    re:/газообразн[а-яё]*/i },
    { name:"окаменевший",     cmd:"окаменевший",     re:/окаменевш[а-яё]*/i },
    { name:"тошнота",         cmd:"тошнота",         re:/тошнот[а-яё]*/i },
    { name:"ускорен",         cmd:"ускорен",         re:/ускорен[а-яё]*/i },
    { name:"мёртв",           cmd:"мёртв",           re:/м[её]ртв[а-яё]*/i },
    { name:"замедлен",        cmd:"замедлен",        re:/замедлен[а-яё]*/i },
    { name:"спровоцированный",cmd:"спровоцированный",re:/спровоцированн[а-яё]*|спровоцирован[а-яё]*/i }
  ];

  // ───────────────────────────────────────────────────────────────────────────
  // ТИПЫ УРОНА / ХИЛ / ВХ
  // ───────────────────────────────────────────────────────────────────────────
  const DAMAGE_TYPE_MAP = {
    'физический': {
      _re: /физическ|physical/,
      _children: {
        'колющий' : /колющ|piercing/,
        'рубящий' : /рубящ|slashing/,
        'дробящий': /дробящ|bludgeoning/
      }
    },
    'кислота'              : /кислот|acid/,
    'холод'                : /холод|лед|cold/,
    'огонь'                : /огн|fire/,
    'чистая сила'          : /чист.*сил|force/,
    'электричество'        : /электр|молни|lightning/,
    'некротическая энергия': /некрот|necrotic/,
    'яд-эриданы'           : /яд-эриданы/,
    'яд'                   : /ядом|poison/,
    'психическая энергия'  : /психич|ментал|psychic/,
    'излучение'            : /излуч|radiant/,
    'звук'                 : /звук|звуков|thunder/,
    'временные хиты'       : /(времен.*хит|temp.*hp)/i,
    'лечение'              : /(леч(ени|ит)|healing|heal)/i,
    'весь'                 : /все|весь|любой/
  };

  function flattenTypeMap(tree, parent=null, out={}){
    Object.entries(tree).forEach(([name, spec])=>{
      if (spec instanceof RegExp){
        out[name] = { re: spec, parent, children: [] };
        return;
      }
      const re = spec && spec._re instanceof RegExp ? spec._re : null;
      out[name] = { re, parent, children: [] };
      const kids = spec && spec._children ? spec._children : {};
      flattenTypeMap(kids, name, out);
    });
    return out;
  }

  const TYPE_META = flattenTypeMap(DAMAGE_TYPE_MAP);
  Object.entries(TYPE_META).forEach(([name, meta])=>{
    if (meta.parent && TYPE_META[meta.parent]) TYPE_META[meta.parent].children.push(name);
  });
  const TYPE_MAP = Object.fromEntries(Object.entries(TYPE_META)
    .filter(([,meta])=>meta.re instanceof RegExp)
    .map(([name,meta])=>[name, meta.re]));

  // ───────────────────────────────────────────────────────────────────────────
  // УТИЛИТЫ
  // ───────────────────────────────────────────────────────────────────────────
  function isWhisperToGM(msg){
    if (msg.type === 'whisper') return true;
    if (String(msg.target_name||'').toLowerCase() === 'gm') return true;
    if (String(msg.target||'').toLowerCase() === 'gm') return true;
    if (/^\/w\s+gm\b/i.test(msg.content)) return true;
    if (/\{\{\s*wtype\s*=\s*\/w\s+gm\s*\}\}/i.test(msg.content)) return true;
    if (/\{\{\s*whisper\s*=\s*gm\s*\}\}/i.test(msg.content)) return true;
    return false;
  }
  
  const numOrNull = (v) => {
      if (v === null || typeof v === 'undefined') return null;
      // пропускаем только цифры и минус (на случай «—», пробелов, html и т.п.)
      const s = String(v).replace(/[^0-9\-]/g, '').trim();
      if (s === '' || s === '-' || s === '--') return null;
      const n = Number(s);
      return Number.isFinite(n) ? n : null;
    };

  function guessCharacter(msg){
    const as = msg.speakingas || '';
    if (as.startsWith('character|')){
      const ch = getObj('character', as.split('|')[1]);
      if (ch) return ch;
    }
    const who = (msg.who || '').split(':')[0].trim();
    if (who){
      const list = findObjs({ type:'character', name: who });
      if (list.length) return list[0];
    }
    return null;
  }
  function guessToken(char){
    const pageId = Campaign().get('playerpageid');
    return findObjs({ _pageid:pageId, type:'graphic', subtype:'token', represents:char.id })[0] || null;
  }

  function normalizeFlagToken(token){
    const t = String(token||'').toLowerCase().replace(/<[^>]*>/g,' ').replace(/\s+/g,' ').trim();
    if (!t) return null;
    if (/[={}]/.test(t) || /\[\[|]]/.test(t)) return null;   // шаблонные хвосты Roll20
    if (t.length > 32) return null;
    return t;
  }
  function normalizeDamageFlags(flags, opts){
    const options = Object.assign({ addImplicitNonmagical:false }, opts||{});
    const out = new Set();
    (flags||[]).forEach(flag=>{
      const n = normalizeFlagToken(flag);
      if (n) out.add(n);
    });
    if (options.addImplicitNonmagical){
      if (out.has('магический')) out.delete('немагический');
      else out.add('немагический');
    }
    return [...out];
  }
  function parseDamageSpec(raw, opts){
    const options = Object.assign({ addImplicitNonmagical:false }, opts||{});
    const src = String(raw||'').trim().toLowerCase();
    if (!src) return { type:'без_типа', flags:normalizeDamageFlags([], options) };

    const flags = new Set();
    let base = src.replace(/\[\[[^\]]*]]/g, ' '); // inline placeholders Roll20

    base = base.replace(/\[([^\]]+)]|\(([^)]+)\)/g, (_, a, b)=>{
      String(a||b||'').split(/[,;|]/).forEach(f=>{
        const n = normalizeFlagToken(f);
        if (n) flags.add(n);
      });
      return ' ';
    });

    base = base.replace(/\bнемагическ[а-яё]*\b/gi, ()=>{ flags.add('немагический'); return ' '; });
    base = base.replace(/\bмагическ[а-яё]*\b/gi, ()=>{ flags.add('магический'); return ' '; });

    const type = normalizeType(base.replace(/\s+/g,' ').trim() || 'без_типа');
    return { type, flags:normalizeDamageFlags([...flags], options) };
  }
  function makeDamageKey(type, flags){
    const arr = [...new Set((flags||[]).map(f=>String(f).trim().toLowerCase()).filter(Boolean))].sort();
    return arr.length ? `${type} [${arr.join('|')}]` : type;
  }
  function parseDamageKey(key){
    const m = String(key||'').match(/^(.*?)(?:\s*\[([^\]]+)\])?$/);
    const type = normalizeType((m && m[1]) ? m[1] : key);
    const flags = (m && m[2]) ? m[2].split('|').map(x=>x.trim()).filter(Boolean) : [];
    return { type, flags };
  }
  function formatDamageSpec(spec){
    const flags = (spec.flags||[]).filter(Boolean);
    return flags.length ? `${spec.type} [${flags.join(', ')}]` : spec.type;
  }
  function parseDamageString(str){
    const out = [];
    const re = /(\d+)\s+([^\+]+)/g; let m;
    while((m = re.exec(str)) !== null){
      const amount = Number(m[1]) || 0;
      if (!amount) continue;
      const spec = parseDamageSpec(m[2], { addImplicitNonmagical:true });
      out.push({ amount, type: spec.type, flags: spec.flags, raw: m[2].trim() });
    }
    return out;
  }

  const totalsToString = (totals)=>
    Object.entries(totals).filter(([,n])=>n)
      .map(([key,n])=>{
        const spec = parseDamageKey(key);
        const label = formatDamageSpec(spec);
        return label==='без_типа'?`${n}`:`${n} ${label}`;
      })
      .join(' + ') || '0';

  function normalizeType(raw){
    const s = String(raw).trim().toLowerCase();
    for (const [type, re] of Object.entries(TYPE_MAP)) if (re.test(s)) return type;
    return s || 'без_типа';
  }
  function getTypeFamily(typeName){
    const out = new Set();
    let cur = typeName;
    while (cur && TYPE_META[cur] && !out.has(cur)){
      out.add(cur);
      cur = TYPE_META[cur].parent;
    }
    if (!out.size) out.add(typeName || 'без_типа');
    return out;
  }
  function matchesDefenseType(damageType, defenseType){
    if (!defenseType) return false;
    if (defenseType === 'весь') return true;
    if (damageType === defenseType) return true;
    return getTypeFamily(damageType).has(defenseType);
  }
  function hasAllFlags(need, has){
    const pool = new Set((has||[]).map(x=>String(x).toLowerCase()));
    return (need||[]).every(f=>pool.has(String(f).toLowerCase()));
  }
  function matchesDefenseSpec(damageSpec, defenseSpec){
    if (!defenseSpec) return false;
    if (!matchesDefenseType(damageSpec.type, defenseSpec.type)) return false;
    if ((defenseSpec.excludeTypes||[]).includes(damageSpec.type)) return false;
    return hasAllFlags(defenseSpec.flags, damageSpec.flags);
  }
  function findTypedValue(entries, damageSpec){
    let best = null;
    (entries||[]).forEach(it=>{
      if (!matchesDefenseSpec(damageSpec, it)) return;
      const score = (it.flags||[]).length * 100 + (it.type === damageSpec.type ? 10 : 0);
      if (!best || score > best.score) best = { ...it, score };
    });
    return best;
  }
  function resolveWeaponTypeAlias(rawType, w1, w2){
    const txt = String(rawType||'').trim().toLowerCase();
    const m = txt.match(/^к\s*урон[ау]\s*оружия(?:\s*(\d+))?$/);
    if (m){
      const idx = Number(m[1]||1);
      const base = idx===2 ? w2 : w1;
      return normalizeType(base||'без_типа');
    }
    return normalizeType(rawType);
  }

  const parseList = (s)=> String(s||'').split(',').map(x=>x.trim()).filter(Boolean);
  function parseMap(s){
    const out={};
    String(s||'').split(',').map(x=>x.trim()).forEach(it=>{
      const r = it.match(/^(.+?)\s+(-?\d+)$/);
      if (r) out[r[1].trim()] = Number(r[2]);
    });
    return out;
  }
  function parseDefenseSpec(raw){
    const txt = String(raw||'').trim();
    const wholeWithExclude = txt.match(/^(?:весь|все|любой)(?:\s*-\s*(.+))?$/i);
    if (wholeWithExclude){
      const excludes = String(wholeWithExclude[1]||'')
        .split(/\s*-\s*/)
        .map(x=>normalizeType(x.trim()))
        .filter(Boolean);
      return { type:'весь', flags:[], excludeTypes:[...new Set(excludes)] };
    }
    const spec = parseDamageSpec(raw, { addImplicitNonmagical:false });
    return { type: spec.type, flags: spec.flags, excludeTypes:[] };
  }
  function parseDefenseList(s){
    return parseList(s).map(parseDefenseSpec);
  }
  function parseDefenseMap(s){
    const out = [];
    Object.entries(parseMap(s)).forEach(([k,v])=> out.push({ ...parseDefenseSpec(k), value:v }));
    return out;
  }
  function getAttr(char,name){
    const a = findObjs({type:'attribute', characterid:char.id, name})[0];
    return a ? String(a.get('current')||'') : '';
  }
  function postConcentrationReminder(tok, ch, total){
      if (!tok || !tok.get('status_stopwatch') || total <= 0) return;
    
      var dc   = Math.max(10, Math.floor(total/2));
      var name = tok.get('name') || (ch ? ch.get('name') : 'Цель');
    
      // База: готовый бонус к спасброску Телосложения
      var base = ch ? (Number(getAttr(ch,'constitution_save_bonus')) || 0) : 0;
    
      // Глобальные модификаторы: учитываем ТОЛЬКО если флаг включён
        var flat = 0, hasDice = false;
        if (ch && String(getAttr(ch,'global_save_mod_flag')) === '1'){
          var gmods = String(getAttr(ch,'global_save_mod') || '').toLowerCase();
        
          // Есть ли хоть одна кость (1d4, 2d6 и т.п.)
          hasDice = /\b\d+d\d+\b/i.test(gmods);
        
          // Полностью вырезаем все дайс-термы, чтобы их цифры не попали в "плоские"
          var gNoDice = gmods.replace(/[+\-]?\s*\d+d\d+(?:\s*\[[^\]]*])?/gi, ' ');
        
          // Складываем только числа, оставшиеся после вырезания костей
          (gNoDice.match(/[+\-]?\s*\d+\b/g) || []).forEach(function(x){
            var n = Number(x.replace(/\s+/g,''));
            if (isFinite(n)) flat += n;
          });
        }
        
        var minRoll = base + flat + (hasDice ? 1 : 0) + 1; // минимум на d20 = 1
        
        var parts = [String(base)];
        if (flat) parts.push(String(flat));
        if (hasDice) parts.push('1');
        var breakdown = parts.join(' + ') + ' + 1';
        
        var body = (minRoll >= dc)
          ? '<b>Автоуспех.</b>'
          : 'Минимум <b>' + minRoll + '</b> (бонус ' + breakdown + ').';
        
        // Карточка с твоими стилями
        var card = openReport
                 + '<div><b>' + _.escape(name) + '</b>. '
                 + 'Концентрация Сл <b>' + dc + '</b>. ' + body + '</div>'
                 + closeReport;
        
        // Публично и строго ПОСЛЕ урона
        sendChat('Концентрация', '/direct ' + card, {noarchive:true});
    }
  
  function getConSaveBonusTotal(ch){
      const mod = Number(getAttr(ch,'constitution_mod')) || 0;
      const pb  = Number(getAttr(ch,'pb')) || 0;
      const prof= Number(getAttr(ch,'constitution_save_prof')) || 0; // 0/1, не строка!
    
      // Доп. поле на листе (если используешь его)
      const misc = Number(getAttr(ch,'constitution_save_bonus')) || 0;
    
      let total = mod + misc + (prof ? pb : 0);
    
      // Активный глобальный мод к спасброскам
      if (String(getAttr(ch,'global_save_mod_flag')) === '1'){
        const g = String(getAttr(ch,'global_save_mod') || '');
    
        // все плоские числа типа +2 -1
        const flats = (g.match(/([+\-]?\s*\d+)(?!\s*d)/gi) || [])
                        .reduce((s,t)=> s + (Number(t.replace(/\s+/g,''))||0), 0);
        total += flats;
      }
      return total;
    }
    
    function getGlobalSaveDiceMin(ch){
      if (String(getAttr(ch,'global_save_mod_flag')) !== '1') return 0;
      const g = String(getAttr(ch,'global_save_mod') || '').toLowerCase();
      // если есть какие-то кости (d4, 1d6 и т.п.) — минимум +1
      return /(\d+)?d\d+/.test(g) ? 1 : 0;
    }
  function getNPCDefense(char){
    const r  = getAttr(char,'npc_resistances'),
          i  = getAttr(char,'npc_immunities'),
          a  = getAttr(char,'npc_damage_absorption'),
          v  = getAttr(char,'npc_vulnerabilities'),
          th = Number(getAttr(char,'damage_threshold'))||0;

    const resistText = String(r||'');
    const firstDotIdx = resistText.indexOf('.');
    const resistPart = firstDotIdx >= 0 ? resistText.slice(0, firstDotIdx) : resistText;
    let absorbFromResist = [];
    if (firstDotIdx >= 0){
      const tail = resistText.slice(firstDotIdx + 1);
      const mAbs = tail.match(/поглощени[ея]\s*:\s*([^\.]+)/i);
      if (mAbs) absorbFromResist = parseDefenseMap(mAbs[1]);
    }

    const res = parseDefenseList(resistPart),
          imm = parseDefenseList(i),
          abs = parseDefenseMap(a).concat(absorbFromResist),
          vm  = parseDefenseMap(v),
          vmKeys = new Set(vm.map(x=>makeDamageKey(x.type, x.flags))),
          vl  = parseDefenseList(v).filter(x=>!vmKeys.has(makeDamageKey(x.type, x.flags)));

    return {res,imm,abs,vulnMap:vm,vulnList:vl,threshold:th};
  }
  function getPCDefense(char){
    const raw = getAttr(char,'personality_traits');
    const lines = String(raw||'').split(/\r?\n/).map(l=>l.trim()).filter(Boolean).slice(0,5);
    const res=[],imm=[],abs=[],vulnMap=[],vulnList=[]; let threshold=0;
    lines.forEach(l=>{
      const m = l.match(/^([^:]+):\s*(.+)$/); if(!m) return;
      const key = m[1].toLowerCase(), val = m[2];
      if (key.includes('сопротивлен'))  parseDefenseList(val).forEach(t=>res.push(t));
      else if (key.includes('иммунитет'))parseDefenseList(val).forEach(t=>imm.push(t));
      else if (key.includes('поглощ'))   parseDefenseMap(val).forEach(t=>abs.push(t));
      else if (key.includes('слабость')) parseDefenseMap(val).forEach(t=>vulnMap.push(t));
      else if (key.includes('уязвим')) { parseDefenseList(val).forEach(t=>vulnList.push(t));
                                         parseDefenseMap(val).forEach(t=>vulnMap.push(t)); }
      else if (key.includes('порог'))    threshold = Number(val)||threshold;
    });
    return {res,imm,abs,vulnMap,vulnList,threshold};
  }


  // ── статусы из текста описания (markdown links)
  function extractStatuses(description){
    if (!description) return [];
    const found=[]; const reAll=/\[([^\]]+?)\]\([^\)]*\)/g; let m;
    while((m=reAll.exec(description))!==null){
      let inner=m[1].trim(); let value;
      const num=inner.match(/\d+/); if (num){ value=Number(num[0]); inner=inner.replace(num[0],'').replace(/\s{2,}/g,' ').trim(); }
      for (const {name,cmd,re} of STATUS_PATTERNS){
        if (re.test(inner)){ found.push({name,cmd,value}); break; }
      }
    }
    return found;
  }
  
    // «к урону оружия» — не тип
    const RE_ADD_TO_WEAPON = /\bк\s+урону\s+оружия\b/i;
    
    // Возвращает 'лечение' | 'временные хиты' | <тип урона> | null
    function normalizeTypeSimple(rawName){
        function resolveRName(s){
          // убираем html, &nbsp; и лишние пробелы
          return String(s||'')
            .replace(/<br\s*\/?>/gi,' ')
            .replace(/<[^>]*>/g,' ')
            .replace(/&nbsp;/gi,' ')
            .replace(/\s+/g,' ')
            .trim();
        }
      const label = (resolveRName(rawName) || String(rawName) || '').trim();
      if (!label) return null;
      if (RE_ADD_TO_WEAPON.test(label)) return null;
    
      // приоритетно ловим хил и ВХ
      if (/(леч(ени|ит)|healing|heal)/i.test(label)) return 'лечение';
      if (/(времен.*хит|temp.*hp)/i.test(label))     return 'временные хиты';
    
      // затем — урон
      const low = label.toLowerCase();
      for (const [name, rx] of Object.entries(TYPE_MAP)) {
        if (name === 'лечение' || name === 'временные хиты') continue;
        if (rx.test(low)) return name;
      }
      return null;
    }
    
    // SIMPLE: реагируем ТОЛЬКО на урон/лечение/ВХ
    on('chat:message', (msg) => {
      if (msg.rolltemplate !== 'simple' || !msg.content) return;
    
      const kv = {};
      (msg.content.match(/{{[^}]+}}/g)||[]).forEach(chunk=>{
        const m = chunk.match(/{{([^=]+)=(.+?)}}/);
        if (m) kv[m[1].toLowerCase()] = m[2];
      });
    
      const rawName = (kv['rname'] || '').trim();
      if (!rawName) return;
    
      // Парсим число из r1
      let amount = 0;
      const r1 = String(kv['r1']||'');
        // 1) сначала пробуем $[[i]]
        let m = r1.match(/\$\[\[(\d+)]]/);
        // 2) затем [[i]] на всякий
        if (!m) m = r1.match(/\[\[(\d+)]]/);
        
        if (m) {
          amount = rollTotal(m[1], msg);
        } else {
          // запасной вариант: если r1 это именно $[[0]], но регэксп по какой-то причине не поймал —
          // берём первый инлайн-ролл целиком
          if (Array.isArray(msg.inlinerolls) && msg.inlinerolls.length) {
            amount = Number(msg.inlinerolls[0].results.total) || 0;
          } else {
            const mNum = r1.match(/-?\d+/);
            if (mNum) amount = Number(mNum[0])||0;
          }
        }
      const im = r1.match(/\[\[(\d+)]]/);
      if (im) amount = rollTotal(im[1], msg);
      else {
        const mNum = r1.match(/-?\d+/);
        if (mNum) amount = Number(mNum[0])||0;
      }
    
      // Определяем тип. Если не распознали — выходим БЕЗ вывода.
      const t = normalizeTypeSimple(rawName);
      if (!t) return;
    
      // Рисуем только кнопки урона/лечения/ВХ
      let bar = '';
      if (t === 'лечение') {
        if (amount) bar += btn('Лечение', cmd('heal', amount), `Исцелить на ${amount}`);
      } else if (t === 'временные хиты') {
        if (amount) bar += btn('Добавить временные хиты', cmd('temphp', amount), `Дать ${amount} ВХ`);
      } else {
        if (amount){
          const s = `${amount} ${t}`;
          bar += btn('Урон', cmd('deal', s), s);
          const half = Math.floor(amount/2);
          if (half) bar += btn('½ Урон', cmd('deal', `${half} ${t}`), 'Половина');
        }
      }
    
      if (!bar.includes('<a ')) return;
      const wrap =
        '<div style="border:1px solid #888;border-radius:6px;padding:4px;text-align:center;display:inline-block;background:#fafafa;'
        + CSS_BUMP + '">' + bar + '</div>';
    
      if (isWhisperToGM(msg)) sendChat('', '/w gm '    + wrap, { noarchive:true });
      else                    sendChat('', '/direct ' + wrap, { noarchive:true });
    });

  // ── npcaction: извлечение «число + тип» рядом с инлайном
  function extractDamageTypes(msg, description){
      if (!description) return [];
      const result = [];
      const reIn = /\$\[\[(\d+)]]/g; let m;
    
      while((m = reIn.exec(description)) !== null){
        const idx  = Number(m[1]);
        const tail = description.slice(m.index + m[0].length);
    
        // Смотрим только до следующего $[[…]]/переноса/знака/«плюс»
        const stop = tail.search(/\$\[\[|[\n\r]|<br\s*\/?>|\*\*|[,;.]|\bплюс\b|\band\b/i);
        const after = (stop >= 0 ? tail.slice(0, stop) : tail).toLowerCase();
    
        // Берём САМЫЙ БЛИЖНИЙ тип по позиции в строке
        const dict = {
          'кислотой'                 : /кислот/,
          'огнём'                    : /огн/,
          'холодом'                  : /(?:холод|лед)/,
          'дробящего'                : /дробящ/,
          'колющего'                 : /колющ/,
          'рубящего'                 : /рубящ/,
          'чистой силой'             : /чист.*сил/,
          'электричеством'           : /(?:электр|молни)/,
          'ядом'                     : /яд/,                    // ← яд не проиграет «некрот»
          'некротической энергией'   : /некрот/,
          'психической энергией'     : /(?:психич|ментал)/,
          'излучением'               : /излуч/,
          'звуком'                   : /звук/
        };
    
        let asType = 'без_типа', best = Infinity;
        for (const [label, re] of Object.entries(dict)){
          const mm = after.match(re);
          if (mm && mm.index < best){ best = mm.index; asType = label; }
        }
    
        const val = (msg.inlinerolls && msg.inlinerolls[idx])
          ? Number(msg.inlinerolls[idx].results.total) || 0 : 0;
        if (val) result.push(`${val} ${asType}`);
      }
      return result;
    }

  // ── вспомогалки инлайнов
  const rollTotal=(idx,msg)=> (idx!=null && msg.inlinerolls?.[idx]) ? (Number(msg.inlinerolls[idx].results.total)||0) : 0;

  function splitInlineRoll(inl){
    const segs=[]; let sum=0; const push=lab=>{ segs.push({label:lab,val:sum}); sum=0; };
    (inl.results.rolls || []).forEach(p=>{
      if (p.type==='R'){ sum += (p.results||[]).reduce((s,r)=>s+(r.v||0),0); }
      else if (p.type==='M'){
        let delta=0;
        if (typeof p.value!=='undefined'){ delta = Number(p.value)||0; if (p.operator==='-') delta=-delta; }
        else if (typeof p.expr!=='undefined'){ const s=String(p.expr); const m=s.match(/-?\d+(\.\d+)?/); if (m) delta=Number(m[0])||0; if (/^\s*-/.test(s)) delta=-Math.abs(delta); }
        sum += delta;
      }
      else if (p.type==='L'){ push((p.text||'').trim()); }
    });
    if (sum) push();
    return segs;
  }

  function extractDamageFlagsFromDescription(content){
    const m = String(content||'').match(/{{desc(?:ription)?=(.+?)}}/is);
    if (!m) return [];
    const plain = m[1]
      .replace(/<br\s*\/?>/gi, ',')
      .replace(/\[\[[^\]]*]]/g, ' ')
      .replace(/<[^>]*>/g, ' ')
      .toLowerCase();
    const flags = new Set();
    plain.split(/[,;\.]/).map(x=>x.trim()).filter(Boolean).forEach(tok=>{
      if (/немагическ/.test(tok)) { flags.add('немагический'); return; }
      if (/магическ/.test(tok)) { flags.add('магический'); return; }
      if (/spelllevel|charname|global/.test(tok)) return;
      const n = normalizeFlagToken(tok);
      if (n) flags.add(n);
    });
    return [...flags];
  }

  // ── вытаскивание из rolltemplate полей (dmg1/dmg2/global*)
  function computeTotals(msg, fields, globals, typeKey){
    const kv={};
    (msg.content.match(/{{[^}]+}}/g)||[]).forEach(chunk=>{
      const m=chunk.match(/{{([^=]+)=(.+?)}}/); if (m) kv[m[1].toLowerCase()] = m[2];
    });
    const isSpellTemplate = Object.prototype.hasOwnProperty.call(kv,'spelllevel');
    const w1=normalizeType((kv['dmg1type']||'без_типа').trim());
    const w2=normalizeType((kv['dmg2type']||'без_типа').trim());
    const commonFlags = extractDamageFlagsFromDescription(msg.content);

    const totals={};
    const add=(rawType,val,extraFlags=[])=>{
      if (!val) return;
      const resolved = resolveWeaponTypeAlias(rawType||'без_типа', w1, w2);
      const spec = parseDamageSpec(resolved, { addImplicitNonmagical:false });
      const spellFlags = isSpellTemplate ? ['магический'] : [];
      const flags = normalizeDamageFlags(spec.flags.concat(commonFlags, extraFlags, spellFlags), { addImplicitNonmagical:true });
      const key = makeDamageKey(spec.type, flags);
      totals[key]=(totals[key]||0)+val;
    };

    fields.forEach(({fld,tFld})=>{
      const idx = kv[fld]?.match(/\[\[(\d+)]]/)?.[1];
      const v   = rollTotal(idx,msg); if (!v) return;
      const raw = (kv[tFld]||'без_типа').trim()||'без_типа';
      add(raw, v);
    });

    globals.forEach(fld=>{
      const idx = kv[fld]?.match(/\[\[(\d+)]]/)?.[1];
      if (!idx) return;
      const inl = msg.inlinerolls?.[idx]; if (!inl) return;

      const parts = splitInlineRoll(inl);
      const types = (kv[typeKey||'globaldamagetype']||'').split('/').map(s=>s.trim());
      parts.forEach((p,i)=>{
        const raw = types[i]||'без_типа';
        add(raw, p.val);
      });
    });

    return totals;
  }
  
    const SIX_HOURS = 6*60*60*1000;

  function lootGC(now){
    const t = now || Date.now();
    // Сносим протухшие pending/ops старше 6 часов
    Object.keys(state.DMS.LootPending||{}).forEach(id=>{
      if (t - (state.DMS.LootPending[id].ts||0) > SIX_HOURS) delete state.DMS.LootPending[id];
    });
    Object.keys(state.DMS.LootOps||{}).forEach(id=>{
      if (t - (state.DMS.LootOps[id].ts||0) > SIX_HOURS) delete state.DMS.LootOps[id];
    });
    // История держим неделю, чтобы красиво пояснять по «протухшим» кнопкам
    const WEEK = 7*24*60*60*1000;
    Object.keys(state.DMS.LootHistory||{}).forEach(id=>{
      if (t - (state.DMS.LootHistory[id].ts||0) > WEEK) delete state.DMS.LootHistory[id];
    });
  }
  function maybeLootGC(){
    const now = Date.now();
    if (now - (state.DMS.LastLootGC||0) >= SIX_HOURS){
      lootGC(now);
      state.DMS.LastLootGC = now;
    }
  }
  on('ready', ()=> maybeLootGC());
  on('chat:message', (m)=>{
    if (m.playerid && playerIsGM(m.playerid)) maybeLootGC(); // «заходит/активен» ГМ → чистим
  });

  // ── деньги из текста (для логов)
  function parseCoinsFromText(msg, description){
    const out = { зм:0, см:0, мм:0, пм:0 };
    if (!description) return out;

    // подменим $[[i]] на их числа, чтобы проще матчить
    let text = description;
    const reIn=/\$\[\[(\d+)]]/g; let m; const repl=[];
    while((m=reIn.exec(description))!==null){
      const idx=Number(m[1]); const v=(msg.inlinerolls && msg.inlinerolls[idx])? (Number(msg.inlinerolls[idx].results.total)||0):0;
      repl.push({from:m[0], to:String(v)});
    }
    repl.forEach(({from,to})=>{ text = text.split(from).join(to); });

    const add=(abbr, n)=>{ out[abbr] += Number(n)||0; };
    const map = [
      { re:/(\d+)\s*(?:зм|золот\w*\s+монет)/ig, add:(n)=>add('зм',n) },
      { re:/(\d+)\s*(?:см|серебр\w*\s+монет)/ig, add:(n)=>add('см',n) },
      { re:/(\d+)\s*(?:мм|медн\w*\s+монет)/ig,  add:(n)=>add('мм',n) },
      { re:/(\d+)\s*(?:пм|платин\w*\s+монет)/ig,add:(n)=>add('пм',n) }
    ];
    map.forEach(({re,add:addF})=>{
      let mm; while((mm=re.exec(text))!==null){ addF(mm[1]); }
    });
    return out;
  }
  function onlyTypeless(arr){
      return Array.isArray(arr) && arr.length > 0 &&
             arr.every(s => String(s).trim().toLowerCase().endsWith('без_типа'));
    }
  // ── helper: парсинг монет из произвольного текста ─────────────────────────
    function parseCoins(text){
      const s = (' ' + String(text).toLowerCase() + ' ').replace(/\s+/g,' ');
      const out = { пм:0, зм:0, см:0, мм:0 };
    
      // «10 зм», «5 золотых монет» и т.п.
      const pats = [
        { u:'пм', re:/(\d+)\s*(?:платин(?:а|овые|овых|ая|ые)?\s*монет|пм)(?=[^0-9a-zа-яё_])/gi },
        { u:'зм', re:/(\d+)\s*(?:золот(?:о|ые|ых|ая|ые)?\s*монет|зм)(?=[^0-9a-zа-яё_])/gi },
        { u:'см', re:/(\d+)\s*(?:серебр(?:о|яные|яных|яная|ые)?\s*монет|см)(?=[^0-9a-zа-яё_])/gi },
        { u:'мм', re:/(\d+)\s*(?:медн(?:ь|ые|ых|ая|ые)?\s*монет|мм)(?=[^0-9a-zа-яё_])/gi }
      ];
      pats.forEach(({u,re})=>{
        let m; while((m=re.exec(s))!==null){ out[u]+=Number(m[1])||0; }
      });
      return out;
    }
  
  const looksLikeMoney = (txt)=>{
        const s=' '+String(txt||'').toLowerCase()+' ';
        const B='[^0-9a-zа-яё_]';
        const re = new RegExp(
          '(золот\\w*\\s+монет|серебр\\w*\\s+монет|медн\\w*\\s+монет|платин\\w*\\s+монет)'
          + '|' + `(${B}зм(?=${B}))`
          + '|' + `(${B}см(?=${B}))`
          + '|' + `(${B}мм(?=${B}))`
          + '|' + `(${B}пм(?=${B}))`, 'i');
        return re.test(s);
      };
    function coinsToString(c){
      return ['пм','зм','см','мм'].filter(u=>c[u]>0).map(u=>`${c[u]} ${u}`).join(', ');
    }
    
      // ── монеты: поиск атрибутов на разных листах
  const COIN_ATTRS = {
    'мм': ['cp','coins_cp','currency_cp','copper','медь','медные'],
    'см': ['sp','coins_sp','currency_sp','silver','серебро','серебряные'],
    'зм': ['gp','coins_gp','currency_gp','gold','золото','золотые'],
    'пм': ['pp','coins_pp','currency_pp','platinum','платина','платиновые']
  };

  function getOrCreateAttrAny(char, names){
    // ищем по списку алиасов; если ничего нет — создаём первый
    let a=null;
    for (const n of names){
      a = findObjs({type:'attribute', characterid:char.id, name:n})[0];
      if (a) return a;
    }
    return createObj('attribute', { characterid:char.id, name:names[0], current:0 });
  }
  function readNumber(a){ const v=Number(a?.get('current')||0); return isFinite(v)?v:0; }

  // регистр ожидаемого лута → id
  function registerLootPending(coins){
    const id = 'L' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2,8);
    state.DMS.LootPending[id] = { coins, ts:Date.now() };
    return id;
  }

  // попытка распарсить payload вида "зм=2,см=1"
  function parseCoinsKV(payload){
    const out = { пм:0, зм:0, см:0, мм:0 };
    String(payload||'').split(/[;,]/).forEach(p=>{
      const m = p.match(/(пм|зм|см|мм)\s*=\s*(-?\d+)/i);
      if (m) { const k=m[1].toLowerCase(); out[k]+=Number(m[2])||0; }
    });
    return out;
  }

  function coinsIsZero(c){ return !c || (c.пм|0)===0 && (c.зм|0)===0 && (c.см|0)===0 && (c.мм|0)===0; }

  function addCoinsToCharacter(ch, coins){
    const prev={}, after={}, names={};
    for (const [abbr,delta] of Object.entries(coins)){
      if (!delta) continue;
      const attr = getOrCreateAttrAny(ch, COIN_ATTRS[abbr]||[abbr]);
      const cur  = readNumber(attr);
      prev[abbr]=cur;
      const nv  = cur + delta;
      attr.set('current', nv);
      after[abbr]=nv;
      names[abbr]=attr.get('name');
    }
    return { prev, after, names };
  }

  // формат «2 зм, 5 см» (порядок пм→зм→см→мм)
  function prettyCoins(c){
    const ord=['пм','зм','см','мм'];
    return ord.filter(k=> (c[k]|0)!==0).map(k=>`${c[k]} ${k}`).join(', ');
  }

  // ───────────────────────────────────────────────────────────────────────────
  // ЕДИНЫЙ ДИСПЕТЧЕР КОМАНД КНОПОК  (!dmscan --action|payload)
  // ───────────────────────────────────────────────────────────────────────────
  on('chat:message', function(msg){
    if (msg.type!=='api' || !msg.content.startsWith('!dmscan')) return;

    const m = /^!dmscan\s+--([\w-]+)(?:\|(.*))?$/s.exec(msg.content);
    if (!m){ sendChat('DM-Scan', box('Ошибка формата. Пример: !dmscan --deal|10 огнём + 4 дробящего')); return; }

    const action  = m[1].toLowerCase();
    const payload = (m[2]||'').trim();

    // ——— HELPERS ВНУТРИ ДИСПЕТЧЕРА ———
    function applyDealDamage(str){
      // автоцель
      if (!msg.selected?.length){
        const ch = guessCharacter(msg);
        if (!ch){ sendChat('DM-Scan', `/w "${msg.who}" ${box('Выделите токен или говорите «от лица» персонажа')}`); return; }
        const tok = guessToken(ch);
        msg.selected = tok ? [{ _id:tok.id }] : [];
        msg._forcedChar = ch;
      }
      if (!msg.selected?.length){ sendChat('DM-Scan', `/w "${msg.who}" ${box('Не удалось определить цель')}`); return; }

      const baseEntries = parseDamageString(str);
      msg.selected.forEach(sel=>{
        const tok  = getObj('graphic', sel._id);
        const ch   = msg._forcedChar || (tok ? getObj('character', tok.get('represents')) : null);
        if (!tok && !ch) return;

        const whoName = tok ? tok.get('name') : (ch ? ch.get('name') : 'Цель');

        const controllers = (ch?.get('controlledby')||'').split(',').filter(Boolean);
        const isMob = !ch || controllers.length===0;
        
        // Явное определение НПС по флагу листа и по наличию npc-полей
        const sheetNpc = Number(getAttr(ch,'npc')) === 1; // dnd5e by Roll20: 1 для НПС
        const hasNpcFields = ['npc_resistances','npc_immunities','npc_vulnerabilities','npc_damage_absorption']
          .some(n => String(getAttr(ch, n)).trim() !== '');
        
        const useNpc = sheetNpc || hasNpcFields;
        
        const EMPTY = { res:[], imm:[], abs:[], vulnMap:[], vulnList:[], threshold:0 };
        const def = !ch ? EMPTY : (useNpc ? getNPCDefense(ch) : getPCDefense(ch));

        let total=0;
        const details=[openReport, openHdr + whoName + ': ' + _.escape(str) + closeHdr];

        baseEntries.forEach((it)=>{
          let d = it.amount;
          const damageSpec = { type: it.type, flags: it.flags };
          const label = formatDamageSpec(damageSpec);
          details.push(`<b>${_.escape(label)}</b> — базовый ${it.amount}`);

          const isImmune = def.imm.some(spec=>matchesDefenseSpec(damageSpec, spec));
          if (isImmune) { details.push('Иммунитет → 0'); return; }

          const weak = findTypedValue(def.vulnMap, damageSpec);
          if (weak){ d += weak.value; details.push(`Слабость ${formatDamageSpec(weak)} +${weak.value} → ${d}`); }

          const absorb = findTypedValue(def.abs, damageSpec);
          if (absorb){ d -= absorb.value; details.push(`Поглощение ${formatDamageSpec(absorb)} -${absorb.value} → ${d}`); }

          if (d<1){ d=1; details.push('Минимум 1'); }
          if (def.vulnList.some(spec=>matchesDefenseSpec(damageSpec, spec))) { d*=2; details.push('Уязвимость удвоение → ' + d); }
          if (def.res.some(spec=>matchesDefenseSpec(damageSpec, spec))) { d=Math.floor(d/2); details.push('Сопротивление пополам → ' + d); }
          if (def.threshold>0 && d<def.threshold){ d=0; details.push(`Порог ${def.threshold} → 0`); }
          total+=d; details.push(`Итог по ${_.escape(label)}: ${d}`);
        });

        details.push(`Всего урона (до ВХ): ${total}`);

        // сперва сжигаем ВХ (bar2/attr), затем HP (bar3/attr)
        let oldHP, newHP, undoCmd, toApply = total;
        
        // 1) найдём ВХ: приоритет attr hp_temp, иначе bar2_value не линкованного бара
        let oldTemp = 0, tempSrc = 'none', tempAttr = null;
        if (ch) {
          tempAttr = findObjs({type:'attribute', characterid:ch.id, name:'hp_temp'})[0] || null;
          if (tempAttr) { oldTemp = Number(tempAttr.get('current')||0); tempSrc = 'attr'; }
        }
        if (!oldTemp && tok && !tok.get('bar2_link')) {
          oldTemp = Number(tok.get('bar2_value')||0);
          if (oldTemp) tempSrc = 'bar';
        }
        
        if (oldTemp > 0 && toApply > 0) {
          const spent = Math.min(toApply, oldTemp);
          if (tempSrc === 'attr') tempAttr.set('current', oldTemp - spent);
          else if (tempSrc === 'bar') tok.set('bar2_value', oldTemp - spent);
          toApply -= spent;
          details.push(`Поглощено временными хитами: ${spent} → ВХ теперь ${oldTemp - spent}`);
        }
        details.push(closeReport);
        
        // затем обычные хиты (оставь как было)
        if (tok){
          oldHP = Number(tok.get('bar3_value') || tok.get('bar3_max') || 0);
          newHP = isMob ? (oldHP - toApply) : Math.max(oldHP - toApply, 0);
          tok.set('bar3_value', newHP);
          state.DMS.IgnoreBar3Update[tok.id] = true;
          // ⟵ передаём источник ВХ в undo (attr/bar/none)
          undoCmd = ch ? cmd('undo', `${tok.id} ${oldHP} ${oldTemp} ${tempSrc}`) : cmd('undo', `${tok.id} ${oldHP}`);
        } else if (ch) {
          const a = findObjs({type:'attribute', characterid:ch.id, name:'hp'})[0];
          oldHP = Number(a?.get('current')||0);
          newHP = isMob ? (oldHP - toApply) : Math.max(oldHP - toApply, 0);
          a?.set('current', newHP);
          undoCmd = cmd('undochar', `${ch.id} ${oldHP} ${oldTemp}`);
        }

        const key = (tok ? tok.id : (ch ? ch.id : 'nochar')) + '|' + str;
        const html = [ details[0],                    // <div ...>
                       details.slice(1, -1).join('<br>'), // строки внутри
                       details[details.length - 1]    // </div>
                     ].join('');
        state.DMS.DamageDetails[key] = html;

        const summary = `${whoName} получил ${total} урона.`;

        sendDualReport(
          msg,
          summary,
          [ { label:'Детали', cmd: cmd('details', key), title:'Показать расчёт' } ],
          [ { label:'Отменить', cmd: undoCmd,          title:'Вернуть HP'       } ],
        );
        // публичное напоминание о концентрации — строго ПОСЛЕ отчёта урона
        postConcentrationReminder(tok, ch, total);
      });
    }

    function applyHeal(numStr){
      const amount = Number(numStr)||0;
      if (!amount){ sendChat('DM-Scan', box('Укажи число: !dmscan --heal|12')); return; }

      if (!msg.selected?.length){
        const ch = guessCharacter(msg);
        if (!ch){ sendChat('DM-Scan', `/w "${msg.who}" ${box('Выделите токен или говорите «от лица» персонажа')}`); return; }
        const tok = guessToken(ch);
        msg.selected = tok ? [{ _id:tok.id }] : [];
        msg._forcedChar = ch;
      }
      if (!msg.selected?.length){ sendChat('DM-Scan', `/w "${msg.who}" ${box('Не удалось определить цель')}`); return; }

      msg.selected.forEach(sel=>{
        const tok = getObj('graphic', sel._id);
        const ch  = msg._forcedChar || (tok ? getObj('character', tok.get('represents')) : null);
        if (!tok && !ch) return;
        const whoName = tok ? tok.get('name') : (ch ? ch.get('name') : 'Цель');

        let oldHP, newHP, cap=Infinity, undoCmd='';
        if (tok){
          oldHP = Number(tok.get('bar3_value')||0);
          const bmax = Number(tok.get('bar3_max')||0); if (bmax>0) cap=bmax;
          if (!isFinite(cap) && ch){
            const a = findObjs({type:'attribute', characterid:ch.id, name:'hp'})[0];
            const mx = Number(a?.get('max')||0); if (mx>0) cap=mx;
          }
          newHP = Math.min(oldHP + amount, isFinite(cap)?cap:oldHP+amount);
          tok.set('bar3_value', newHP);
          state.DMS.IgnoreBar3Update[tok.id]=true;
          undoCmd = cmd('undo', `${tok.id} ${oldHP}`);
        } else {
          const a = findObjs({type:'attribute', characterid:ch.id, name:'hp'})[0];
          oldHP = Number(a?.get('current')||0);
          const mx = Number(a?.get('max')||0); if (mx>0) cap=mx;
          newHP = Math.min(oldHP + amount, isFinite(cap)?cap:oldHP+amount);
          a?.set('current', newHP);
          undoCmd = cmd('undochar', `${ch.id} ${oldHP}`);
        }
        sendDualReport(
          msg,
          `${whoName} исцелён на ${amount}.`,
          [], // у игрока — без доп.кнопок
          [ { label:'Отменить', cmd: undoCmd, title:'Вернуть HP' } ],
          'DM-Scan'
        );
      });
    }

    function applyTempHP(numStr){
      const want = Number(numStr)||0;
      if (!want){ sendChat('DM-Scan', box('Укажи число: !dmscan --temphp|8')); return; }
    
      // автоцель (как у тебя)
      if (!msg.selected?.length){
        const ch = guessCharacter(msg);
        if (!ch){ sendChat('DM-Scan', `/w "${msg.who}" ${box('Выделите токен или говорите «от лица» персонажа')}`); return; }
        const tok = guessToken(ch);
        msg.selected = tok ? [{ _id:tok.id }] : [];
        msg._forcedChar = ch;
      }
      if (!msg.selected?.length){ sendChat('DM-Scan', `/w "${msg.who}" ${box('Не удалось определить цель')}`); return; }
    
      msg.selected.forEach(sel=>{
        const tok = getObj('graphic', sel._id);
        const ch  = msg._forcedChar || (tok ? getObj('character', tok.get('represents')) : null);
        if (!tok && !ch) return;
    
        const whoName = tok ? (tok.get('name')||'Цель') : (ch ? ch.get('name') : 'Цель');
    
        // Источник ВХ: приоритет bar2 на токене; без токена — только существующий атрибут
        let src = 'bar';           // 'bar' | 'attr'
        let oldT = 0;
        let tAttr = null;
    
        if (tok){
          oldT = Number(tok.get('bar2_value')||0); // всегда работаем с bar2
        } else {
          tAttr = findObjs({type:'attribute', characterid:ch.id, name:'hp_temp'})[0] || null;
          if (!tAttr){
            sendDualReport(
              msg,
              `${whoName}: нет токена (bar2) и нет существующего атрибута hp_temp — временные хиты некуда записать`,
              [], [], 'DM-Scan', { toGM:true, toPlayer:true }
            );
            return;
          }
          src  = 'attr';
          oldT = Number(tAttr.get('current')||0);
        }
    
        if (want > oldT){
          if (src === 'bar'){
            const oldHPtok = Number(tok.get('bar3_value') || tok.get('bar3_max') || 0); // для корректного undo
            tok.set('bar2_value', want);
            sendDualReport(
              msg,
              `${whoName} получает временных хитов: ${want} (было ${oldT}, теперь ${want}).`,
              [],
              [ { label:'Отменить', cmd: cmd('undo', `${tok.id} ${oldHPtok} ${oldT} bar`), title:'Вернуть временные хиты' } ]
            );
          } else {
            // src === 'attr' (чарник без токена, атрибут уже существует)
            tAttr.set('current', want);
            sendDualReport(
              msg,
              `${whoName} получает временных хитов: ${want} (было ${oldT}, теперь ${want}).`,
              [],
              [ { label:'Отменить', cmd: cmd('undochar-temp', `${ch.id} ${oldT}`), title:'Вернуть временные хиты' } ]
            );
          }
        } else {
          // не уменьшаем — стандартное правило ВХ: берём большее значение
          sendDualReport(
            msg,
            `${whoName}: уже есть временные хиты ${oldT} — это не меньше ${want}, значение не изменено`,
            [], [], 'DM-Scan', { toGM:false, toPlayer:true }
          );
        }
      });
    }

    function undoToken(payload){ // tokId hp [temp] [src]
      const parts = payload.split(' ');
      const tokId = parts[0], hp = parts[1];
      const temp  = parts[2];           // старое значение ВХ
      const src   = parts[3] || 'attr'; // 'attr' | 'bar' | 'none'
    
      const tok = getObj('graphic', tokId);
      if (!tok) return;
    
      tok.set('bar3_value', Number(hp));
      state.DMS.IgnoreBar3Update[tok.id] = true;
    
      const charId = tok.get('represents');
      if (typeof temp !== 'undefined'){
        if (src === 'bar'){
          tok.set('bar2_value', Number(temp)||0);
        } else if (charId) {
          const t = findObjs({type:'attribute', characterid:charId, name:'hp_temp'})[0];
          t?.set('current', Number(temp)||0);
        }
      }
    
      const who = _.escape(tok.get('name')||'Цель');
      sendDualReport(msg, `${who} значения восстановлены`, [], [], '', { toPlayer:false });
    }
    
    function undoChar(payload){ // charId hp [temp]
      const [charId,hp,temp] = payload.split(' ');
      const a = findObjs({type:'attribute', characterid:charId, name:'hp'})[0];
      a?.set('current', Number(hp));
    
      if (typeof temp!=='undefined'){
        const t = findObjs({type:'attribute', characterid:charId, name:'hp_temp'})[0];
        t?.set('current', Number(temp));
      }
    
      const ch = getObj('character', charId);
      const who = _.escape(ch ? ch.get('name') : 'Персонаж');
      sendDualReport(msg, `${who} значения восстановлены`, [], [], '', { toPlayer:false });
    }
    
    function undoTemp(payload){ // charId temp
      const [charId,temp] = payload.split(' ');
      const t = findObjs({type:'attribute', characterid:charId, name:'hp_temp'})[0]
            || createObj('attribute', { characterid:charId, name:'hp_temp', current:0 });
      t.set('current', Number(temp)||0);
    
      const ch = getObj('character', charId);
      const who = _.escape(ch ? ch.get('name') : 'Персонаж');
      sendDualReport(msg, `${who} временные хиты восстановлены`, [], [], '', { toPlayer:false });
    }
    
    // Детали — оставляем прямой вывод, но без спикера DM-Scan
    function showDetails(key, playerid){
      const html = state.DMS.DamageDetails[key] || box('Нет сохранённых деталей');
      const p = playerid ? getObj('player', playerid) : null;
      if (p && !playerIsGM(playerid)) {
        const pname = p.get('displayname');
        sendChat('', `/w "${pname}" ${html}`, {noarchive:true});
      } else {
        sendChat('', `/w gm ${html}`, {noarchive:true});
      }
    }
    
    function claimLoot(payload){
      let coins=null, note='', pendingId=null;

      // payload — это наш id?
      if (/^L[0-9a-z_]+$/i.test(payload)){
        const rec = state.DMS.LootPending[payload];
        if (!rec){
          const h = state.DMS.LootHistory[payload];
          if (h){
            const nm = getObj('character', h.charId)?.get('name') || h.name || 'персонаж';
            sendChat('Лут', `/w "${msg.who}" ${box('Эти сокровища уже были начислены (' + _.escape(nm) + ').')}`);
          } else {
            sendChat('Лут', `/w "${msg.who}" ${box('Эта кнопка уже была использована или отменена.')}`);
          }
          return;
        }
        coins = rec.coins;
        note  = prettyCoins(coins);
        pendingId = payload;
        delete state.DMS.LootPending[payload]; // одноразово
      } else {
        // ручной режим "зм=2,см=1"
        coins = parseCoinsKV(payload);
        note  = prettyCoins(coins);
      }

      if (coinsIsZero(coins)){
        sendChat('DM-Scan', `/w "${msg.who}" ${box('Эти сокровища уже были начислены (или суммы не указаны).')}`);
        return;
      }

      const ch = guessCharacter(msg);
      if (!ch){
        sendChat('DM-Scan', `/w "${msg.who}" ${box('Не удалось определить персонажа. Поставьте «Говорить как…» или выделите токен и нажмите ещё раз.')}`);
        return;
      }

      const op = addCoinsToCharacter(ch, coins);
      const opId = 'OP' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2,8);
      state.DMS.LootOps[opId] = {
        ts: Date.now(), by: msg.playerid, charId: ch.id,
        coins, prev: op.prev, pendingId    // <— запомнили откуда
      };
      if (pendingId){
        state.DMS.LootHistory[pendingId] = { charId: ch.id, name: ch.get('name')||'', ts: Date.now() };
      }

      const chName = _.escape(ch.get('name')||'Персонаж');
      const info   = `${chName}: начислено <b>${_.escape(note||coinsToString(coins))}</b>.`;

      const p = getObj('player', msg.playerid);
      if (p && !playerIsGM(msg.playerid)){
        const pname = p.get('displayname');
        sendChat('Лут', `/w "${pname}" ${openReport}${info}${closeReport}`);
      }
      const gmHtml = openReport + info
                   + `<div style="margin-top:5px;">${btn('Отменить', cmd('loot-undo', opId), 'Вернуть монеты')}</div>`
                   + closeReport;
      sendChat('Лут', `/w gm ${gmHtml}`);
    }

    function undoLoot(opId){
      const op = state.DMS.LootOps[opId];
      if (!op){ sendChat('Лут', `/w gm ${box('Операция не найдена или уже отменена.')}`); return; }
      const ch = getObj('character', op.charId);
      if (!ch){ sendChat('Лут', `/w gm ${box('Чарник не найден.')}`); delete state.DMS.LootOps[opId]; return; }

      // вернуть старые значения
      for (const [abbr,oldV] of Object.entries(op.prev||{})){
        const attr = getOrCreateAttrAny(ch, COIN_ATTRS[abbr]||[abbr]);
        attr.set('current', Number(oldV)||0);
      }

      const chName = _.escape(ch.get('name')||'Персонаж');
      const note   = prettyCoins(op.coins)||coinsToString(op.coins);
      sendChat('Лут', `/w gm ${openReport}${chName}: откат начисления (<b>${_.escape(note)}</b>) выполнен.${closeReport}`);

      // снова делаем старую кнопку рабочей (если была от pending)
      if (op.pendingId){
        state.DMS.LootPending[op.pendingId] = { coins: op.coins, ts: Date.now() };
        // и чистим запись «кто забрал», чтобы не пугать сообщениями
        delete state.DMS.LootHistory[op.pendingId];
        // можно ничего не печатать: старая кнопка в чате снова активна
      } else {
        // если начисляли «ручным» способом — кнопки не было, ничего не делаем
      }

      delete state.DMS.LootOps[opId];
    }
    
    function parseModToken(tok){
      // «+3», «-2», «3», «d4», «1d4», «+2d6», «к4/к6» (кириллица)
      let s = String(tok||'').trim().toLowerCase().replace(/^к/,'d'); // к4 → d4
      if (/^[+\-]?\d+$/.test(s)) return { type:'flat', n: Number(s) };
      const m = s.match(/^([+\-])?(\d*)d(\d+)$/);
      if (m){
        const sign = (m[1]==='-') ? -1 : 1;
        const cnt  = Math.max(1, Number(m[2]||1));
        const die  = Math.max(2, Number(m[3]));
        return { type:'dice', sign, cnt, die };
      }
      return { type:'bad' };
    }
    
    function rollDiceSum(cnt, die){ // простенький роллер
      let sum = 0;
      for (let i=0;i<cnt;i++) sum += randomInteger(die);
      return sum;
    }
    
    function applyAddMod(payload, whoPid){
      // payload: "<base>|<label>|<mod>"
      const parts = String(payload||'').split('|');
      if (parts.length < 3){ sendChat('DM-Scan', box('Неверный payload для addmod')); return; }
    
      const base   = Number(parts[0])||0;
      const label  = parts[1];
      const modStr = parts.slice(2).join('|').trim(); // вдруг был | в ?{…}
    
      const spec = parseModToken(modStr);
      if (spec.type === 'bad'){
        sendChat('DM-Scan', box('Модификатор должен быть числом или костью: +3, -2, d4, 2d6 и т.п.'));
        return;
      }
    
      let delta = 0, desc = '';
      if (spec.type==='flat'){
        delta = spec.n;
        desc  = (delta>=0?'+':'') + delta;
      } else {
        const rolled = rollDiceSum(spec.cnt, spec.die);
        delta = spec.sign * rolled;
        desc  = `${spec.sign<0?'-':''}${spec.cnt}d${spec.die} → ${delta}`;
      }
    
      const total = base + delta;
    
      // аккуратный отчёт всем: игроку (кто нажал) и ГМу
      const summary = `Модификатор ${_.escape(desc)} → итог ${total}.`;
      const htmlP   = summary; // или просто: const htmlP = summary;
    
      sendChat('', '/direct ' + htmlP, { noarchive:true });
    }

    const handlers = {
      'deal'          : ()=>applyDealDamage(payload),
      'heal'          : ()=>applyHeal(payload),
      'temphp'        : ()=>applyTempHP(payload),
      'undo'          : ()=>undoToken(payload),
      'undochar'      : ()=>undoChar(payload),
      'undochar-temp' : ()=>undoTemp(payload),
      'loot'         : ()=>claimLoot(payload),
      'loot-undo'    : ()=>undoLoot(payload),
      'addmod' : ()=>applyAddMod(payload, msg.playerid),
      'details'       : ()=>showDetails(payload, msg.playerid)
    };
    if (handlers[action]) handlers[action]();
    else sendChat('DM-Scan', box(`Неизвестная команда "${action}"`));
  });

  // ───────────────────────────────────────────────────────────────────────────
  // ПАРСИНГ РОЛЛТЕМПЛЕЙТОВ → КНОПКИ
  // ───────────────────────────────────────────────────────────────────────────
  on('chat:message', (msg)=>{
    if (!msg.rolltemplate) return;

    // ——— 0) Статусы из description
    let statuses=[]; let description='';
    const descM = msg.content && msg.content.match(/{{description=(.+?)}}/s);
    if (descM){ description = descM[1]; statuses = extractStatuses(description); }

    // PLAYER templates
    if (['atkdmg','dmg','npcfullatk','npcdmg'].includes(msg.rolltemplate)){
      // 1) собираем суммы по полям
      // 1) считаем суммы по полям
        const normals = computeTotals(msg,
          [{ fld:'dmg1', tFld:'dmg1type' },
           { fld:'dmg2', tFld:'dmg2type' },
           { fld:'hldmg', tFld:'hldmgtype' }],
          ['globaldamage'], 'globaldamagetype'
        );
        const extraCrit = computeTotals(msg,
          [{ fld:'crit1', tFld:'dmg1type' },
           { fld:'crit2', tFld:'dmg2type' },
           { fld:'hldmgcrit', tFld:'hldmgtype' }],
          ['globaldamagecrit'], 'globaldamagetype'
        );
        const crits = { ...normals };
        Object.entries(extraCrit).forEach(([t,v]) => { crits[t] = (crits[t]||0) + v; });
        
        // ── ВАЖНО: недамажные типы не должны критовать и не должны попадать в урон
        const tempAmt = normals['временные хиты'] || 0;   // берём ТОЛЬКО из normals
        const healAmt = normals['лечение'] || 0;
        
        delete normals['временные хиты']; delete crits['временные хиты'];
        delete normals['лечение'];        delete crits['лечение'];
        
        // теперь формируем строки урона и половинки
        const normalStr = totalsToString(normals);
        const critStr   = totalsToString(crits);
        
        const halfN = {}, halfC = {};
        Object.entries(normals).forEach(([t,v]) => { const h = Math.floor(v/2); if (h) halfN[t] = h; });
        Object.entries(crits).forEach(([t,v])   => { const h = Math.floor(v/2); if (h) halfC[t] = h; });
        const halfNStr = totalsToString(halfN);
        const halfCStr = totalsToString(halfC);
        
        // описания → статусы
        let statuses = [];
        const descMatch = msg.content.match(/{{description=(.+?)}}/s);
        // ⛔ Если это лут/монеты — логируем и выходим, кнопки урона не рисуем
        if (descMatch && looksLikeMoney(descMatch[1])) {
          const coins   = parseCoins(descMatch[1]);
          const coinStr = coinsToString(coins);
          if (coinStr){
            const lootId = registerLootPending(coins);
            const wrap   = '<div style="border:1px solid #888;border-radius:6px;padding:4px;text-align:center;display:inline-block;background:#fafafa;'
                         + CSS_BUMP + '">'
                         + btn('Забрать деньги', cmd('loot', lootId), coinStr)
                         + '</div>';

            // показываем всем, как обычные кнопки урона
            if (isWhisperToGM(msg)) sendChat('', '/w gm ' + wrap, {noarchive:true});
            else {
              sendChat('', '/direct ' + wrap, {noarchive:true});
              }
          }
          return;
        }
        if (descMatch) statuses = extractStatuses(descMatch[1]);
        
        // что рисуем
        const hasN = Object.values(normals).some(v => v > 0);
        const hasC = Object.values(crits).some(v => v > 0);
        const hasDmg = hasN || hasC;
        const hasStatuses = statuses.length > 0;
        const hasH = healAmt > 0;
        const hasT = tempAmt > 0;
        
        if (!hasDmg && !hasStatuses && !hasH && !hasT) return;
        
        let bar = '';
        if (hasN) {
          bar += btn('Урон', `!dmscan --deal|${normalStr}`, normalStr);
          if (halfNStr !== '0') bar += btn('½ Урон', `!dmscan --deal|${halfNStr}`, halfNStr);
        }
        if (hasC) {
          bar += btn('Крит', `!dmscan --deal|${critStr}`, critStr);
          if (halfCStr !== '0') bar += btn('½ Крит', `!dmscan --deal|${halfCStr}`, halfCStr);
        }
        if (hasH) bar += btn('Лечение', `!dmscan --heal|${healAmt}`, `Исцелить на ${healAmt}`);
        if (hasT) bar += btn('Добавить временные хиты', `!dmscan --temphp|${tempAmt}`, `Дать ${tempAmt} ВХ`);
        
        statuses.forEach(s => {
          let payload = s.cmd + (s.value != null ? `=${s.value}` : '');
          bar += btn(`${s.name}${s.value!=null?` ${s.value}`:''}`,
                     `!token-status --toggle ${payload}`,
                     `Навесить состояние: ${s.name}`);
        });

      if (!bar.includes('<a ')) return;
      const wrap = '<div style="border:1px solid #888;border-radius:6px;padding:4px;text-align:center;display:inline-block;background:#fafafa;'
                 + CSS_BUMP + '">' + bar + '</div>';
      if (isWhisperToGM(msg)) sendChat('', '/w gm '+wrap, {noarchive:true});
      else                    sendChat('', '/direct '+wrap, {noarchive:true});
      return;
    }

    // NPC ACTION: урон/кнопки/логи монет (без ВХ/лечения кнопками)
    if (msg.rolltemplate === 'npcaction' && msg.content) {
      // 0) достаём описание
      const m = msg.content.match(/{{description=(.+?)}}/s);
      if (!m) return;
      const description = m[1];
    
      // 1) монеты: логируем и ВЫХОДИМ (никаких кнопок урона)
      if (looksLikeMoney(description)) {
        const coins   = parseCoins(description);
        const coinStr = coinsToString(coins);
        if (coinStr){
          const lootId = registerLootPending(coins);
          const wrap   = '<div style="border:1px solid #888;border-radius:6px;padding:4px;text-align:center;display:inline-block;background:#fafafa;'
                       + CSS_BUMP + '">'
                       + btn('Забрать деньги', cmd('loot', lootId), coinStr)
                       + '</div>';
          // публикуем (обычно npcaction публичный), плюс Мастеру
          if (isWhisperToGM(msg)) {
              sendChat('', '/w gm ' + wrap, { noarchive:true });
            } else {
              sendChat('', '/direct ' + wrap, { noarchive:true });
            }
          }
        return;
      }
    
      // 2) статусы
      const statuses = extractStatuses(description);
    
      // 3) урон из текста/инлайн-роллов (игнорируем лечение и ВХ для npcaction)
      const rawArr = extractDamageTypes(msg, description); // ["6 огнём", ...]
      const dmgArr = [];
      rawArr.forEach(x=>{
        const mm = String(x).match(/^(\d+)\s+(.+)$/); if (!mm) return;
        const val = Number(mm[1]);
        const typ = mm[2].toLowerCase().trim();
        if (/^лечен|^healing|^heal/.test(typ)) return;       // игнор лечение
        if (/временн.*хит/.test(typ)) return;                // игнор врем.хиты
        dmgArr.push(`${val} ${typ}`);
      });
    
      // 4) если вообще пусто (ни урона, ни статусов) — выходим
      if (!dmgArr.length && !statuses.length) return;
    
      // 5) строим панель
      let bar = '';
    
      // урон: не рисуем, если вышло только "… без_типа"
      const hasDamage = dmgArr.length > 0 && !onlyTypeless(dmgArr);
      if (hasDamage){
        const dmgStr  = dmgArr.join(' + ');
        const halfStr = dmgArr.map(s=>{
          const mm = s.match(/^(\d+)\s+(.+)$/);
          return `${Math.floor(Number(mm[1]) / 2)} ${mm[2]}`;
        }).join(' + ');
    
        bar += btn('Урон',   `!dmscan --deal|${dmgStr}`,  dmgStr);
        if (halfStr !== '0') bar += btn('½ Урон', `!dmscan --deal|${halfStr}`, 'Половина');
      }
    
      // статусы
      statuses.forEach(s=>{
        const payload = s.cmd + (s.value!=null ? `=${s.value}` : '');
        bar += btn(`${s.name}${s.value!=null ? (' ' + s.value) : ''}`,
                   `!token-status --toggle ${payload}`,
                   `Навесить состояние: ${s.name}`);
      });
    
      if (!bar.includes('<a ')) return;
      const wrapper = '<div style="border:1px solid #888;border-radius:6px;padding:4px;text-align:center;display:inline-block;background:#fafafa;'
                    + CSS_BUMP + '">' + bar + '</div>';
      if (isWhisperToGM(msg)) sendChat('', '/w gm ' + wrapper, { noarchive:true });
      else                    sendChat('', '/direct ' + wrapper, { noarchive:true });
      return;
    }
  });

  // ───────────────────────────────────────────────────────────────────────────
  // ЛОГИ И ОПОВЕЩЕНИЯ ОБ ИЗМЕНЕНИЯХ ХП/ВХ
  // ───────────────────────────────────────────────────────────────────────────
  // Возвращает число или null, если не удалось корректно распарсить
  
  function notifyHpChange(charId, token, newHp, oldHp, kind='hp'){
    if (!charId) return;
    
    // если хотя бы одно значение невалидно — не пишем сообщение
    if (!Number.isFinite(newHp) || !Number.isFinite(oldHp)) return;
     
    const key = charId + '|' + kind;
    const last = state.DMS.HPLock[key] || {};
    const now  = Date.now();
    if ( last.newHp===newHp
      && Math.abs(newHp-oldHp)===Math.abs((last.newHp||0)-(last.oldHp||0))
      && (now - (last.ts||0)) < 1000 ) return;
    state.DMS.HPLock[key] = { newHp, oldHp, ts:now };

    const name  = token ? token.get('name') : (getObj('character', charId)?.get('name') || 'Персонаж');
    const diff  = newHp - oldHp; const sign = diff>0?'+':'';
    const label = (kind==='hp_temp') ? 'временные хиты' : 'хиты';

    let undoCmd='';
    if (kind==='hp'){
      undoCmd = token ? cmd('undo', `${token.id} ${oldHp} ?`) : cmd('undochar', `${charId} ${oldHp}`);
    } else {
      undoCmd = cmd('undochar-temp', `${charId} ${oldHp}`);
    }

    const html = openReport + `${name} ${label} были изменены ${sign}${diff}`
                 + (undoCmd?('<div style="margin-top:5px;">'+btn('Отменить', undoCmd, 'Вернуть значение')+'</div>'):'')
                 + closeReport;
      sendChat('', `/w gm ${html}`); // ← пустой спикер вместо 'DM-Scan'
    }
    on('change:campaign:playerpageid', ()=>{ state.DMS.PageSwitchTs = Date.now(); });
    on('change:campaign:playerspecificpages', ()=>{ state.DMS.PageSwitchTs = Date.now(); }); // на всякий
    
    on('change:token:bar3_value', (tok, prev)=>{
      // игнорируем всё, что не на активной странице игроков
      if (tok.get('_pageid') !== Campaign().get('playerpageid')) return;
    
      // 1–2 секунды после переключения страницы — молчим
      if (Date.now() - (state.DMS.PageSwitchTs||0) < 2000) return;
      
      if (!tok.get('represents')) return;
      if (state.DMS.IgnoreBar3Update[tok.id]){ delete state.DMS.IgnoreBar3Update[tok.id]; return; }
      const born = state.DMS.JustSpawned[tok.id];
      if (born && Date.now()-born<1500){ delete state.DMS.JustSpawned[tok.id]; return; }
      if (!prev.bar3_link && tok.get('bar3_link')) return;
      if (prev.represents !== tok.get('represents')) return;
    
      const oldV = numOrNull(prev.bar3_value);
      const newV = numOrNull(tok.get('bar3_value'));
      if (oldV === null || newV === null || newV === oldV) return; // ← не пишем
    
      notifyHpChange(tok.get('represents'), tok, newV, oldV, 'hp');
    });
    
    on('change:attribute', (attr, prev)=>{
      const name = attr.get('name'); if (name!=='hp' && name!=='hp_temp') return;
      const charId = attr.get('characterid');
    
      const oldV = numOrNull(prev.current);
      const newV = numOrNull(attr.get('current'));
      if (oldV === null || newV === null || newV === oldV) return; // ← не пишем
    
      notifyHpChange(charId, null, newV, oldV, name);
    });

})();  // конец IIFE

// ─────────────────────────────────────────────────────────────────────────────
// НИЖЕ — ТВОЙ БЛОК «запросов проверок» БЕЗ ИЗМЕНЕНИЙ
// ─────────────────────────────────────────────────────────────────────────────
const BOX = [
  "<div style='background:#eee;padding:6px 8px;font-size:90%;'>",
  "</div>"
];

const HDRROW = function(title, rightHtml){
  return "<div style='position:relative;display:inline-block;width:100%;max-width:100%;"
       + "box-sizing:border-box;border:1px solid #bbb;border-radius:3px;"
       + "background:#f7f7f7;padding:4px 8px;min-height:24px;'>"
       +   "<span style='display:inline-block;width:70%;box-sizing:border-box;"
       +                "font-weight:bold;color:#111;line-height:18px;vertical-align:middle;'>"
       +     title
       +   "</span>"
       +   (rightHtml || "")
       + "</div>";
};
const btn_plain = function(label, cmd){
  return "<a href='" + cmd + "' style='display:inline-block;background:#ddd;color:#111;"
       + "padding:2px 6px;border:1px solid #bbb;border-radius:4px;text-decoration:none;line-height:1;'>"
       + label + "</a>";
};
const imgBtn = function(cmd, src, size){
  return "<a href='" + cmd + "' style='display:inline-block;vertical-align:middle;"
       + "text-decoration:none;background:transparent;border:none;padding:0;margin:0;'>"
       +   "<img src='" + src + "' "
       +        "style='display:block;width:" + size + "px;height:" + size + "px;"
       +               "border:0;outline:none;background:transparent;box-shadow:none;'/>"
       + "</a>";
};
const diceBtn = function(cmd){
  return "<a href='" + cmd + "' style='position:absolute;top:-4px;right:-4px;"
       + "background:transparent;border:none;padding:0;margin:0;'>"
       +   "<img src='https://files.d20.io/images/452220270/J9Bm1-dwR-s93F3Qe3hY-w/max.png?1754905645' "
       +        "style='display:block;width:40px;height:40px;object-fit:contain;"
       +               "border:0;outline:none;box-shadow:none;'/>"
       + "</a>";
};
const whisperPlayer = (pid, html) => {
  const p = getObj('player', pid); const who = p ? '"' + p.get('displayname') + '"' : 'gm';
  sendChat('Запрос проверки', '/w ' + who + ' ' + html);
};
// ==== навыки ================================================================
const SKILL = {
  acrobatics:'acrobatics',
  animal_handling:'animal_handling',
  arcana:'arcana',
  athletics:'athletics',
  deception:'deception',
  history:'history',
  insight:'insight',
  intimidation:'intimidation',
  investigation:'investigation',
  medicine:'medicine',
  nature:'nature',
  perception:'perception',
  performance:'performance',
  persuasion:'persuasion',
  religion:'religion',
  sleight_of_hand:'sleight_of_hand',
  stealth:'stealth',
  survival:'survival'
};
const RU2KEY = {
  'акробатика':'acrobatics','уход за животными':'animal_handling','магия':'arcana','атлетика':'athletics',
  'обман':'deception','история':'history','проницательность':'insight','запугивание':'intimidation',
  'расследование':'investigation','медицина':'medicine','природа':'nature','внимательность':'perception',
  'выступление':'performance','убеждение':'persuasion','религия':'religion','ловкость рук':'sleight_of_hand',
  'скрытность':'stealth','выживание':'survival'
};
const LABEL = {
  acrobatics:'Ловкость (Акробатика)', animal_handling:'Мудрость (Уход за животными)', arcana:'Интеллект (Магия)',
  athletics:'Сила (Атлетика)', deception:'Харизма (Обман)', history:'Интеллект (История)', insight:'Мудрость (Проницательность)',
  intimidation:'Харизма (Запугивание)', investigation:'Интеллект (Расследование)', medicine:'Мудрость (Медицина)',
  nature:'Интеллект (Природа)', perception:'Мудрость (Восприятие)', performance:'Харизма (Выступление)',
  persuasion:'Харизма (Убеждение)', religion:'Интеллект (Религия)', sleight_of_hand:'Ловкость (Ловкость рук)',
  stealth:'Ловкость (Скрытность)', survival:'Мудрость (Выживание)'
};
function guessCharacter(msg){
  const as = msg.speakingas || '';
  if (as.startsWith('character|')){
    const ch = getObj('character', as.split('|')[1]);
    if (ch) return ch;
  }
  if (Array.isArray(msg.selected) && msg.selected.length){
    for (var i=0;i<msg.selected.length;i++){
      var s = msg.selected[i];
      if (s._type !== 'graphic') continue;
      var tok = getObj('graphic', s._id);
      if (!tok) continue;
      var cid = tok.get('represents');
      if (cid){
        var ch2 = getObj('character', cid);
        if (ch2) return ch2;
      }
    }
  }
  const who = (msg.who || '').split(':')[0].trim();
  if (who){
    const list = findObjs({ type:'character', name: who });
    if (list.length) return list[0];
  }
  return null;
}
// ==== 1) мастер шлёт кнопку ================================================
on('chat:message', function(msg){
  if (msg.type !== 'api' || !/^!askcheck(\b|$)/i.test(msg.content)) return;

  const m = /--skill\s+(.+?)(?=\s--|$)/i.exec(msg.content);
  const raw = m ? m[1] : '';
  const key = (function(s){
    if(!s) return null;
    const k = String(s).trim().toLowerCase();
    if (SKILL[k]) return k;
    if (RU2KEY[k]) return RU2KEY[k];
    const slug = k.replace(/\s+/g,'_');
    return SKILL[slug] ? slug : null;
  })(raw);
  if (!key){
    sendChat('Запрос проверки', BOX[0] + HDRROW('Неизвестный навык') +
      '<div>' + (_.escape?_.escape(raw):raw) + '</div>' + BOX[1]);
    return;
  }

  const html = BOX[0] + HDRROW(LABEL[key], diceBtn('!check --skill ' + key)) + BOX[1];
  sendChat('Запрос проверки', html);
});
// ==== 2) игрок жмёт кнопку ==================================================
on('chat:message', function(msg){
  if (msg.type !== 'api' || !/^!check(\b|$)/i.test(msg.content)) return;

  const m = /--skill\s+(.+?)(?=\s--|$)/i.exec(msg.content);
  const key = m ? (function(s){
    if(!s) return null;
    const k = String(s).trim().toLowerCase();
    if (SKILL[k]) return k;
    if (RU2KEY[k]) return RU2KEY[k];
    const slug = k.replace(/\s+/g,'_');
    return SKILL[slug] ? slug : null;
  })(m[1]) : null;

  if (!key){ whisperPlayer(msg.playerid, BOX[0] + 'Неизвестный навык' + BOX[1]); return; }

  const ch = guessCharacter(msg);
  if (!ch){
    whisperPlayer(msg.playerid,
      BOX[0] + HDRROW('Выберите персонажа') +
      '<div>Поставьте «Говорить как» или выделите токен, затем нажмите кнопку ещё раз.</div>' + BOX[1]
    );
    return;
  }

  const charName = ch.get('name');
  const ability  = SKILL[key];
  sendChat('player|' + msg.playerid, '%{' + charName + '|' + ability + '}');
});
