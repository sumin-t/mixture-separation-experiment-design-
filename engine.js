/* 혼합물 분리 설계실 - 시뮬레이터 엔진 (순수 함수, 서버·브라우저 공용)
 * 같은 이벤트 목록을 넣으면 모든 기기에서 같은 결과가 나오도록 결정적으로 동작한다.
 * 과학 규칙은 2022 개정 중2 '물질의 특성' 수준(밀도·용해도·끓는점·녹는점)으로 단순화했다.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.Engine = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  /* ---------- 물질 데이터 (교과서 40쪽 표 + 일반 화학 자료) ---------- */
  const SUBS = {
    water:    { id: 'water',    name: '물',          state: '액체', bp: 100,  mp: 0,   dens: 1.0,  densText: '1.0',  sol: '—(용매)',          mag: false, color: '#8ecae6', layer: 'aq' },
    linoleic: { id: 'linoleic', name: '리놀레산',    state: '액체', bp: 229,  mp: -12, dens: 0.90, densText: '약 0.9', sol: '물과 섞이지 않음', mag: false, color: '#e9c46a', layer: 'oil' },
    nacl:     { id: 'nacl',     name: '염화 나트륨', state: '고체', bp: 1413, mp: 801, dens: 2.2,  densText: '2.2',  sol: '물에 녹음',        mag: false, color: '#e2e8f0', soluble: true },
    iron:     { id: 'iron',     name: '철 가루',     state: '고체', bp: 2862, mp: 1538, dens: 7.87, densText: '7.87', sol: '물에 녹지 않음',   mag: true,  color: '#374151' },
    copper:   { id: 'copper',   name: '구리 가루',   state: '고체', bp: 2562, mp: 1085, dens: 8.96, densText: '8.96', sol: '물에 녹지 않음',   mag: false, color: '#c2410c' },
    stearic:  { id: 'stearic',  name: '스테아르산',  state: '고체', bp: 361,  mp: 69,  dens: 0.94, densText: '0.94', sol: '물에 녹지 않음',   mag: false, color: '#f6e7a1', layer: 'oil' },
    oleic:    { id: 'oleic',    name: '올레산',      state: '액체', bp: 360,  mp: 13,  dens: 0.89, densText: '0.89', sol: '물과 섞이지 않음', mag: false, color: '#e8bf5a', layer: 'oil' },
    linolenic:{ id: 'linolenic',name: '리놀렌산',    state: '액체', bp: 230,  mp: -11, dens: 0.91, densText: '0.91', sol: '물과 섞이지 않음', mag: false, color: '#ecc96a', layer: 'oil' },
    cacl2:    { id: 'cacl2',    name: '염화 칼슘',   state: '고체', bp: 1935, mp: 772, dens: 2.15, densText: '2.15', sol: '물에 녹음',        mag: false, color: '#f1f5f9', soluble: true },
    naph:     { id: 'naph',     name: '나프탈렌',    state: '고체', bp: 218,  mp: 80,  dens: 1.14, densText: '1.14', sol: '물에 녹지 않음',   mag: false, color: '#f3f0e6' },
    kcl:      { id: 'kcl',      name: '염화 칼륨',   state: '고체', bp: 1420, mp: 770, dens: 1.98, densText: '1.98', sol: '물에 녹음',        mag: false, color: '#f8fafc', soluble: true },
    tin:      { id: 'tin',      name: '주석 가루',   state: '고체', bp: 2602, mp: 232, dens: 7.31, densText: '7.31', sol: '물에 녹지 않음',   mag: false, color: '#9ca3af' },
    quartz:   { id: 'quartz',   name: '이산화 규소(석영) 가루', state: '고체', bp: 2230, mp: 1713, dens: 2.65, densText: '2.65', sol: '물에 녹지 않음', mag: false, color: '#d6c7a1' }
  };

  const PROPS = {
    density:    '밀도',
    solubility: '용해도(물에 녹는 정도)',
    boiling:    '끓는점',
    melting:    '녹는점',
    magnetic:   '자성(자석에 붙는 성질)',
    size:       '알갱이 크기'
  };

  const COOL_TEMPS = [60, 50, 40, 30, 5];
  /* 고체 혼합물을 넣어 뜨고 가라앉는 정도를 보는 액체 (밀도 g/mL, 20 ℃ 근처) */
  const LIQUIDS = {
    ethanol: { id: 'ethanol', name: '에탄올',       dens: 0.79, aq: false },
    oil:     { id: 'oil',     name: '식용유',       dens: 0.92, aq: false },
    water:   { id: 'water',   name: '물',           dens: 1.00, aq: true },
    brine:   { id: 'brine',   name: '진한 소금물',  dens: 1.20, aq: true }
  };
  const LIQUID_IDS = Object.keys(LIQUIDS);
  const TOOLS = {
    magnet:   { id: 'magnet',   name: '자석',          ok: ['magnetic'],
                use: '자석을 시료에 가까이 가져가 붙는 물질만 떼어 낸다.', safe: '' },
    water:    { id: 'water',    name: '물 붓기',       ok: ['solubility'],
                use: '시료에 물을 충분히 붓고 저어 준다. 물에 녹는 물질은 녹아 용액이 되고, 녹지 않는 물질은 그대로 남는다.', safe: '' },
    filter:   { id: 'filter',   name: '거름 장치',     ok: ['solubility', 'size'],
                use: '깔때기에 거름종이를 끼우고 유리 막대를 따라 혼합물을 붓는다. 녹지 않은 고체는 거름종이 위에 남고, 액체와 녹아 있는 물질은 아래로 내려간다.', safe: '유리 기구가 깨지지 않게 조심한다.' },
    funnel:   { id: 'funnel',   name: '분별 깔때기',   ok: ['density'],
                use: '섞이지 않는 액체를 넣고 층이 나뉠 때까지 둔다. 마개를 연 다음 꼭지를 열어 아래층 액체부터 따라 낸다.', safe: '꼭지를 열기 전에 마개를 먼저 연다.' },
    evaporate:{ id: 'evaporate',name: '증발 장치',     ok: ['boiling'],
                use: '증발 접시에 용액을 담아 가열한다. 물은 수증기가 되어 날아가고 녹아 있던 고체가 남는다. (날아간 물은 모으지 못한다.)', safe: '내열 장갑·보안경을 착용하고, 증발 접시가 식을 때까지 만지지 않는다.' },
    distill:  { id: 'distill',  name: '증류 장치',     ok: ['boiling'],
                use: '끓임쪽을 넣고 가열한다. 끓어 나온 기체를 찬물로 냉각해 액체로 모은다. 끓는점이 낮은 물질이 먼저 나온다.', safe: '끓임쪽을 꼭 넣고, 내열 장갑·보안경을 착용한다.' },
    cool:     { id: 'cool',     name: '냉각(물에 담그기)',  ok: ['melting'],
                use: '시료를 담은 용기를 원하는 온도의 물(60·50·40·30 ℃) 또는 얼음물(5 ℃)에 담가 식힌다. 녹는점이 그 온도보다 높은 물질이 먼저 굳는다.', safe: '뜨거운 용기는 내열 장갑을 끼고 옮긴다.', temps: COOL_TEMPS }
  };
  TOOLS.float = { id: 'float', name: '밀도 비교 용기', ok: ['density'],
    use: '고체 혼합물을 액체에 넣는다. 고체의 밀도가 액체보다 작으면 뜨고, 크면 가라앉는다. 두 고체의 밀도 사이의 밀도를 가진 액체를 고르면 뜬 것과 가라앉은 것을 나눌 수 있다.', safe: '에탄올은 불이 붙기 쉬우니 불 가까이에서 쓰지 않는다.', liquids: LIQUID_IDS };
  const TOOL_ORDER = ['magnet', 'water', 'filter', 'funnel', 'evaporate', 'distill', 'cool', 'float'];

  /* ---------- 혼합물(연습 단계) ---------- */
  const MIXES = {
    L1: {
      id: 'L1', level: '1단계', title: '금속 가루와 소금',
      desc: '철 가루, 구리 가루, 염화 나트륨이 섞인 고체 혼합물이에요.',
      focus: ['자성', '용해도'], hot: false,
      comps: [{ s: 'iron', f: 'solid' }, { s: 'copper', f: 'solid' }, { s: 'nacl', f: 'solid' }],
      blanks: [
        { s: 'iron', k: 'mag' }, { s: 'copper', k: 'mag' },
        { s: 'nacl', k: 'sol' },
        { s: 'iron', k: 'dens', rel: 0.06 }, { s: 'copper', k: 'dens', rel: 0.06 }
      ]
    },
    L2: {
      id: 'L2', level: '2단계', title: '교과서 혼합물',
      desc: '물, 리놀레산, 염화 나트륨(녹아 있음), 철 가루가 섞여 있어요. (교과서 40쪽)',
      focus: ['밀도', '끓는점', '자성'], hot: false,
      comps: [{ s: 'water', f: 'liquid' }, { s: 'linoleic', f: 'liquid' }, { s: 'nacl', f: 'dissolved' }, { s: 'iron', f: 'solid' }],
      blanks: [
        { s: 'linoleic', k: 'dens', abs: 0.06 },
        { s: 'nacl', k: 'bp', rel: 0.04 }, { s: 'nacl', k: 'sol' },
        { s: 'iron', k: 'mp', rel: 0.04 }, { s: 'iron', k: 'dens', rel: 0.06 },
        { s: 'iron', k: 'mag' }
      ]
    },
    L3: {
      id: 'L3', level: '3단계', title: '뜨거운 물속 스테아르산',
      desc: '약 75 ℃의 뜨거운 물에 스테아르산(녹아서 액체)과 철 가루가 섞여 있어요.',
      focus: ['녹는점', '자성', '밀도'], hot: true,
      comps: [{ s: 'water', f: 'liquid' }, { s: 'stearic', f: 'liquid' }, { s: 'iron', f: 'solid' }],
      blanks: [
        { s: 'stearic', k: 'mp', rel: 0.05 }, { s: 'stearic', k: 'sol' },
        { s: 'stearic', k: 'dens', abs: 0.07 }, { s: 'iron', k: 'mag' }, { s: 'water', k: 'mp', abs: 1 }
      ]
    }
  };

  /* 모둠별 혼합물 8종: 역할 구조가 같아서 이용하는 특성(밀도·용해도·끓는점)과 난이도가 같다.
     역할: 물 / 물에 녹는 고체 A(녹아 있음) / 물에 녹지 않고 자석에 붙지 않는 무거운 고체 C / 물과 섞이지 않고 물보다 가벼운 액체 F
     특성은 밀도·용해도·끓는점 세 가지, 도구는 거름 장치·분별 깔때기·증류 장치 세 가지만 쓴다. */
  const VAR_A = ['nacl', 'kcl'], VAR_C = ['copper', 'tin', 'quartz'], VAR_F = ['linoleic', 'oleic', 'linolenic'];
  const VAR_TOOLS = ['filter', 'funnel', 'distill'];   // 용해도→거름 장치, 밀도→분별 깔때기, 끓는점→증류 장치
  const VARIANT_IDS = [];
  for (let i = 0; i < 8; i++) {
    const A = VAR_A[i % 2], C = VAR_C[i % 3], F = VAR_F[Math.floor(i / 3) % 3], id = 'V' + (i + 1);
    VARIANT_IDS.push(id);
    MIXES[id] = {
      id, level: '모둠용', title: '혼합물 ' + (i + 1), tools: VAR_TOOLS, props: ['density', 'solubility', 'boiling'], fieldKeys: ['state', 'bp', 'dens', 'sol'],
      desc: `물, ${SUBS[F].name}(물과 섞이지 않는 액체), ${SUBS[A].name}(녹아 있음), ${SUBS[C].name}가 섞여 있어요.`,
      focus: ['밀도', '용해도', '끓는점'], variant: true,
      comps: [{ s: 'water', f: 'liquid' }, { s: F, f: 'liquid' }, { s: A, f: 'dissolved' }, { s: C, f: 'solid' }],
      blanks: [
        { s: A, k: 'sol' }, { s: A, k: 'bp', rel: 0.04 },
        { s: C, k: 'sol' }, { s: C, k: 'dens', rel: 0.06 },
        { s: F, k: 'sol' }, { s: F, k: 'dens', abs: 0.06 }
      ]
    };
  }
  /* 심화 혼합물 8종: 녹는점(식히기)과 고체 밀도차 분리(밀도 비교 용기)가 더해진다. 역할 구조가 같아 난이도가 같다.
     물(약 75 ℃) / 녹아 액체가 된 스테아르산(녹는점 69 ℃, 굳으면 밀도 0.94) / 녹아 있는 염 A / 가라앉는 불용성 고체 C */
  const ADV_A = ['nacl', 'kcl', 'cacl2'], ADV_C = ['copper', 'tin', 'quartz'];
  const ADV_IDS = [];
  for (let i = 0; i < 8; i++) {
    const A = ADV_A[i % 3], C = ADV_C[Math.floor(i / 3) % 3], id = 'S' + (i + 1);
    ADV_IDS.push(id);
    MIXES[id] = {
      id, level: '심화', title: '심화 혼합물 ' + (i + 1), tools: ['filter', 'funnel', 'distill', 'cool'],
      props: ['density', 'solubility', 'boiling', 'melting'], fieldKeys: ['state', 'bp', 'mp', 'dens', 'sol'],
      desc: `약 75 ℃의 뜨거운 물에 ${SUBS.stearic.name}(녹아서 액체), ${SUBS[A].name}(녹아 있음), ${SUBS[C].name}가 섞여 있어요.`,
      focus: ['밀도', '용해도', '끓는점', '녹는점'], variant: true, adv: true, hot: true,
      comps: [{ s: 'water', f: 'liquid' }, { s: 'stearic', f: 'liquid' }, { s: A, f: 'dissolved' }, { s: C, f: 'solid' }],
      blanks: [
        { s: A, k: 'sol' }, { s: A, k: 'bp', rel: 0.04 },
        { s: C, k: 'sol' }, { s: C, k: 'dens', rel: 0.06 },
        { s: 'stearic', k: 'mp', rel: 0.05 }, { s: 'stearic', k: 'dens', abs: 0.06 }
      ]
    };
  }
  /* 고체 밀도차 혼합물 6종: 물에 녹는 염 A + 가벼운 고체(나프탈렌 1.14) + 무거운 고체 H.
     물에 녹여 거른 뒤, 두 고체 사이의 밀도(1.14~H)인 진한 소금물(1.20)에 넣어 뜨고 가라앉혀 나눈다. */
  const SOL_A = ['kcl', 'cacl2'], SOL_H = ['copper', 'tin', 'quartz'];
  const SOL_IDS = [];
  for (let i = 0; i < 6; i++) {
    const A = SOL_A[i % 2], H = SOL_H[Math.floor(i / 2) % 3], id = 'D' + (i + 1);
    SOL_IDS.push(id);
    MIXES[id] = {
      id, level: '심화', title: '고체 혼합물 ' + (i + 1), tools: ['water', 'filter', 'float', 'distill'],
      props: ['density', 'solubility', 'boiling'], fieldKeys: ['state', 'bp', 'dens', 'sol'],
      desc: `고체 가루 세 가지가 섞여 있어요: ${SUBS[A].name}, ${SUBS.naph.name}, ${SUBS[H].name}.`,
      focus: ['밀도', '용해도', '끓는점'], variant: true, adv: true,
      comps: [{ s: A, f: 'solid' }, { s: 'naph', f: 'solid' }, { s: H, f: 'solid' }],
      blanks: [
        { s: A, k: 'sol' }, { s: A, k: 'bp', rel: 0.04 },
        { s: 'naph', k: 'dens', rel: 0.04 }, { s: 'naph', k: 'sol' },
        { s: H, k: 'dens', rel: 0.06 }, { s: H, k: 'sol' }
      ]
    };
  }
  const pick = (ids, n) => ids[(((Number(n) || 1) - 1) % ids.length + ids.length) % ids.length];
  const advFor = n => pick(ADV_IDS, n), solFor = n => pick(SOL_IDS, n);
  const variantFor = n => VARIANT_IDS[(((Number(n) || 1) - 1) % VARIANT_IDS.length + VARIANT_IDS.length) % VARIANT_IDS.length];

  const FIELDS = [
    { k: 'state', label: '상온 상태' },
    { k: 'bp', label: '끓는점(℃)' },
    { k: 'mp', label: '녹는점(℃)' },
    { k: 'dens', label: '밀도(g/mL)' },
    { k: 'sol', label: '물에 대한 성질' },
    { k: 'mag', label: '자석에 붙는가?' }
  ];
  const fieldsOf = m => m && m.fieldKeys ? FIELDS.filter(f => m.fieldKeys.includes(f.k)) : FIELDS;
  const propsOf = id => (MIXES[id] && MIXES[id].props) || Object.keys(PROPS);
  const CHOICES = {
    sol: ['물에 녹음', '물에 녹지 않음', '물과 섞이지 않음'],
    mag: ['붙는다', '붙지 않는다']
  };
  function answerOf(sid, k) {
    const s = SUBS[sid];
    if (k === 'mag') return s.mag ? '붙는다' : '붙지 않는다';
    if (k === 'sol') return s.sol;
    return s[k];
  }
  function showValue(sid, k) {
    const s = SUBS[sid];
    if (k === 'mag') return s.mag ? '붙는다' : '붙지 않는다';
    if (k === 'dens') return s.densText;
    return s[k];
  }
  function checkBlank(b, value) {
    if (value === undefined || value === null || String(value).trim() === '') return null;
    const ans = answerOf(b.s, b.k);
    if (typeof ans === 'string') return String(value) === ans;
    const v = Number(String(value).replace(/,/g, ''));
    if (!isFinite(v)) return false;
    if (b.abs !== undefined) return Math.abs(v - ans) <= b.abs;
    if (b.rel !== undefined) return Math.abs(v - ans) <= Math.abs(ans) * b.rel;
    return v === ans;
  }

  /* ---------- 시료 유틸 ---------- */
  const clone = o => JSON.parse(JSON.stringify(o));
  const has = (comps, s, f) => comps.some(c => c.s === s && (!f || c.f === f));
  const isLiquidPhase = c => c.f === 'liquid' || c.f === 'dissolved';
  const subsOf = smp => Array.from(new Set(smp.comps.filter(c => !c.added).map(c => c.s)));
  const LAYER = c => (SUBS[c.s].layer === 'oil' && c.f === 'liquid') ? 'oil' : null;

  function initState(mixId) {
    const m = MIXES[mixId];
    const st = { mix: mixId, samples: [], next: 0, steps: [], lost: [] };
    addSample(st, '처음 혼합물', m.comps, m.hot);
    return st;
  }
  function addSample(st, label, comps, hot) {
    const smp = { id: 's' + st.next++, label, comps: clone(comps), hot: !!hot, used: false };
    st.samples.push(smp);
    return smp;
  }
  const fail = reason => ({ ok: false, reason });
  const done = (outputs, extra) => Object.assign({ ok: true, outputs, warns: [], note: '', lost: [] }, extra || {});

  const WARN_TEXT = {
    clog: '고체 알갱이가 섞여 있으면 꼭지가 막히거나 층의 경계를 구분하기 어려울 수 있어요.',
    hotFunnel: '뜨거운 상태에서는 녹아 있던 지방산이 식으면서 굳어 꼭지를 막을 수 있어요.',
    oilHeated: '기름 성분까지 함께 가열하면 튀거나 연기가 날 수 있어 위험해요.'
  };

  /* ---------- 도구별 규칙 ---------- */
  const OPS = {
    magnet(smp) {
      const iron = smp.comps.filter(c => c.s === 'iron' && c.f === 'solid');
      if (!iron.length) return fail('이 시료에는 자석에 붙는 물질이 없어요.');
      const rest = smp.comps.filter(c => !(c.s === 'iron' && c.f === 'solid'));
      if (!rest.length) return fail('이미 철 가루만 있어요. 더 분리할 물질이 없어요.');
      return done([
        { label: '자석에 붙은 물질', comps: iron },
        { label: '남은 혼합물', comps: rest, hot: smp.hot }
      ], { note: '철 가루만 자석에 붙어서 떨어져 나왔어요.' });
    },

    water(smp) {
      const sol = smp.comps.filter(c => c.f === 'solid' && SUBS[c.s].soluble);
      if (!sol.length) return fail('물에 녹는 고체가 없어요. 물을 부어도 달라지는 것이 없어요.');
      const comps = smp.comps.map(c => (c.f === 'solid' && SUBS[c.s].soluble) ? { s: c.s, f: 'dissolved' } : c);
      if (!has(comps, 'water')) comps.push({ s: 'water', f: 'liquid', added: true });
      return done([{ label: '물을 부어 녹인 혼합물', comps, hot: smp.hot }],
        { note: sol.map(c => SUBS[c.s].name).join(', ') + '은(는) 물에 녹아 용액이 되었고, 녹지 않는 고체는 그대로 남아 있어요.' });
    },

    filter(smp) {
      const liquidPhase = smp.comps.some(isLiquidPhase);
      const solids = smp.comps.filter(c => c.f === 'solid');
      if (!liquidPhase) return fail('거름은 액체에 섞인 고체를 걸러 내는 방법이에요. 지금은 고체뿐이라 거를 수 없어요.');
      if (!solids.length) return fail('걸러질 고체가 없어요. (모두 녹았거나 액체 상태예요.)');
      const filtrate = smp.comps.filter(isLiquidPhase);
      return done([
        { label: '거름종이 위에 남은 고체', comps: solids },
        { label: '거른 액', comps: filtrate, hot: smp.hot }
      ], { note: '녹지 않은 고체는 거름종이 위에 남고, 액체와 녹아 있는 물질은 아래로 내려갔어요.' });
    },

    funnel(smp) {
      const aq = smp.comps.filter(c => c.s === 'water' || c.f === 'dissolved');
      const oil = smp.comps.filter(c => LAYER(c) === 'oil');
      if (!has(smp.comps, 'water') || !oil.length) {
        return fail('분별 깔때기는 서로 섞이지 않는 액체가 층을 이룰 때 쓸 수 있어요. 이 시료에는 층으로 나뉜 액체가 없어요.');
      }
      const solids = smp.comps.filter(c => c.f === 'solid');
      const sinking = solids.filter(c => SUBS[c.s].dens > 1.0);
      const floating = solids.filter(c => SUBS[c.s].dens <= 1.0);
      const upper = oil.concat(floating);
      const lower = aq.concat(sinking);
      const warns = [];
      if (sinking.length) warns.push('clog');
      if (smp.hot && oil.some(c => SUBS[c.s].mp > 25)) warns.push('hotFunnel');
      return done([
        { label: '위층(밀도가 작은 액체)', comps: upper, hot: smp.hot },
        { label: '아래층(밀도가 큰 액체)', comps: lower, hot: smp.hot }
      ], { warns, note: '밀도가 작은 액체는 위층, 밀도가 큰 액체는 아래층에 있어서 아래층부터 따라 내어 나누었어요.' + (sinking.length ? ' (가라앉은 고체는 아래층과 함께 나왔어요.)' : '') });
    },

    evaporate(smp) {
      if (!has(smp.comps, 'water', 'liquid')) return fail('증발시킬 물(용액)이 없어요.');
      const residue = smp.comps.filter(c => c.s !== 'water').map(c => c.f === 'dissolved' ? { s: c.s, f: 'solid' } : c);
      if (!residue.length) return fail('물만 있어서 증발시키면 아무것도 남지 않아요.');
      const warns = residue.some(c => LAYER(c) === 'oil') ? ['oilHeated'] : [];
      const lost = smp.comps.filter(c => c.s === 'water' && !c.added).map(() => 'water');
      return done([{ label: '증발 후 남은 물질', comps: residue }], {
        warns, lost,
        note: '물은 수증기가 되어 날아갔고, 녹아 있던 고체는 남았어요.' + (lost.length ? ' (물은 모으지 못했어요.)' : '')
      });
    },

    distill(smp) {
      if (!has(smp.comps, 'water', 'liquid')) return fail('끓여서 모을 액체(물)가 없어요.');
      const distillate = smp.comps.filter(c => c.s === 'water');
      const residue = smp.comps.filter(c => c.s !== 'water').map(c => c.f === 'dissolved' ? { s: c.s, f: 'solid' } : c);
      const outs = [{ label: '증류액(끓어 나와 냉각된 액체)', comps: distillate }];
      const warns = [];
      if (residue.length) {
        outs.push({ label: '가열 용기에 남은 물질', comps: residue });
        if (residue.some(c => LAYER(c) === 'oil')) warns.push('oilHeated');
      }
      return done(outs, { warns, note: '끓는점이 낮은 물이 먼저 끓어 나와 냉각되어 액체로 모였고, 끓는점이 높은 물질은 남았어요.' });
    },

    float(smp, run) {
      const liq = LIQUIDS[run && run.liquid];
      if (!liq) return fail('먼저 고체를 넣을 액체를 골라요.');
      if (smp.comps.some(c => c.f !== 'solid')) return fail('액체가 섞여 있어요. 고체끼리만 섞인 시료에 쓸 수 있어요. 먼저 거름 장치 등으로 고체만 얻어 보세요.');
      const subs = Array.from(new Set(smp.comps.map(c => c.s)));
      if (subs.length < 2) return fail('이미 한 가지 물질이에요. 나눌 필요가 없어요.');
      if (liq.aq && smp.comps.some(c => SUBS[c.s].soluble)) return fail('물에 녹는 고체가 있어서 이 액체에 넣으면 녹아 버려요.');
      const up = smp.comps.filter(c => SUBS[c.s].dens < liq.dens), down = smp.comps.filter(c => SUBS[c.s].dens > liq.dens);
      if (!up.length) return fail(`${liq.name}(밀도 ${liq.dens.toFixed(2)})에 넣으면 고체가 모두 가라앉아요. 두 고체의 밀도 사이인 액체가 필요해요.`);
      if (!down.length) return fail(`${liq.name}(밀도 ${liq.dens.toFixed(2)})에 넣으면 고체가 모두 떠올라요. 두 고체의 밀도 사이인 액체가 필요해요.`);
      return done([{ label: '떠오른 고체', comps: up.map(c => ({ s: c.s, f: 'solid' })), hot: false }, { label: '가라앉은 고체', comps: down.map(c => ({ s: c.s, f: 'solid' })), hot: false }],
        { liquid: liq.id, note: `${liq.name}(밀도 ${liq.dens.toFixed(2)})에 넣자 밀도가 더 작은 ` + up.map(c => SUBS[c.s].name).join(', ') + '은(는) 뜨고, 더 큰 ' + down.map(c => SUBS[c.s].name).join(', ') + '은(는) 가라앉았어요.' });
    },
    cool(smp, run) {
      const target = COOL_TEMPS.includes(Number(run && run.temp)) ? Number(run.temp) : 5;
      const freezing = smp.comps.filter(c => c.f === 'liquid' && SUBS[c.s].mp > target);
      if (!freezing.length) return fail(`이 시료를 ${target} ℃까지 식혀도 새로 굳는 물질이 없어요. 물질의 녹는점과 식히는 온도를 비교해 봐요.`);
      const comps = smp.comps.map(c => (c.f === 'liquid' && SUBS[c.s].mp > target) ? { s: c.s, f: 'solid' } : c);
      return done([{ label: `${target} ℃로 식힌 혼합물`, comps, hot: target > 30 }],
        { temp: target, note: `${target} ℃까지 식히자 녹는점이 그보다 높은 ` + freezing.map(c => SUBS[c.s].name).join(', ') + '이(가) 굳었어요. (나머지 물질은 아직 액체예요.)' });
    }
  };

  /* ---------- 실행(상태 → 새 상태) ---------- */
  function apply(state, run) {
    const st = clone(state);
    const smp = st.samples.find(s => s.id === run.input);
    const tool = TOOLS[run.tool];
    if (!tool) return { ok: false, reason: '알 수 없는 도구예요.' };
    if (!smp || smp.used) return { ok: false, reason: '선택한 시료가 없어요. (이미 사용한 시료는 다시 쓸 수 없어요.)' };
    const res = OPS[run.tool](smp, run);
    if (!res.ok) return { ok: false, reason: res.reason };
    smp.used = true;
    const outIds = res.outputs.map(o => addSample(st, o.label, o.comps, o.hot !== undefined ? o.hot : smp.hot).id);
    (res.lost || []).forEach(l => st.lost.push(l));
    const propOk = tool.ok.includes(run.prop);
    const step = {
      n: st.steps.length + 1, tool: run.tool, input: smp.id, inputLabel: smp.label, prop: run.prop, propOk,
      outIds, warns: res.warns, note: res.note, lost: res.lost || [], who: run.who || ''
    };
    if (res.temp !== undefined) step.temp = res.temp;
    if (res.liquid !== undefined) step.liquid = res.liquid;
    st.steps.push(step);
    return { ok: true, state: st, step };
  }

  /* ---------- 평가 ---------- */
  function evaluate(state) {
    const m = MIXES[state.mix];
    const leaves = state.samples.filter(s => !s.used);
    const recovered = [], mixed = [];
    leaves.forEach(l => {
      const subs = subsOf(l);
      const inSolution = l.comps.some(c => c.f === 'dissolved');   // 녹아 있으면 아직 '얻은' 것이 아니다
      if (subs.length === 1 && !inSolution) recovered.push(subs[0]);
      else if (subs.length >= 1) mixed.push(l.id);
    });
    const need = Array.from(new Set(m.comps.map(c => c.s)));
    const rec = need.filter(s => recovered.includes(s));
    const missing = need.filter(s => !recovered.includes(s));
    const lost = need.filter(s => state.lost.includes(s) && !recovered.includes(s));
    const warnCount = state.steps.reduce((a, s) => a + s.warns.length, 0);
    const badProp = state.steps.filter(s => !s.propOk).length;
    return { need, recovered: rec, missing, lost, mixed, done: missing.length === 0, steps: state.steps.length, warnCount, badProp };
  }

  /* ---------- 최단 경로 탐색(검증·평가용) ---------- */
  const optionsOf = t => t === 'cool' ? COOL_TEMPS.map(x => ({ temp: x })) : t === 'float' ? LIQUID_IDS.map(x => ({ liquid: x })) : [{}];
  function solve(mixId) {
    const start = initState(mixId);
    const sig = st => st.samples.filter(s => !s.used)
      .map(s => s.hot + '|' + s.comps.map(c => c.s + ':' + c.f + (c.added ? '+' : '')).sort().join(',')).sort().join(';') + '#' + st.lost.slice().sort().join(',');
    let best = { any: null, clean: null };
    let frontier = [start];
    const seen = new Set([sig(start)]);
    for (let depth = 1; depth <= 7; depth++) {
      const next = [];
      for (const st of frontier) {
        const leaves = st.samples.filter(s => !s.used);
        for (const l of leaves) for (const t of (MIXES[mixId].tools || TOOL_ORDER)) for (const o of optionsOf(t)) {
          const r = apply(st, Object.assign({ tool: t, input: l.id, prop: TOOLS[t].ok[0] }, o));
          if (!r.ok) continue;
          const ev = evaluate(r.state);
          const clean = r.state.steps.every(s => s.warns.length === 0);
          if (ev.done) {
            if (best.any === null) best.any = depth;
            if (clean && best.clean === null) best.clean = depth;
          }
          const sg = sig(r.state) + (clean ? 'C' : 'D');
          if (!seen.has(sg)) { seen.add(sg); next.push(r.state); }
        }
      }
      if (best.any !== null && best.clean !== null) break;
      frontier = next;
    }
    return { minSteps: best.any, minCleanSteps: best.clean };
  }

  /* ---------- 정답 경로(교사용): 주의 없는 최단 경로 우선 ---------- */
  function solution(mixId) {
    const start = initState(mixId);
    const sig = st => st.samples.filter(s => !s.used)
      .map(s => s.hot + '|' + s.comps.map(c => c.s + ':' + c.f + (c.added ? '+' : '')).sort().join(',')).sort().join(';') + '#' + st.lost.slice().sort().join(',');
    let any = null, clean = null;
    let frontier = [{ st: start, path: [] }];
    const seen = new Set([sig(start)]);
    for (let depth = 1; depth <= 7 && !clean; depth++) {
      const next = [];
      for (const node of frontier) {
        for (const l of node.st.samples.filter(s => !s.used)) for (const t of (MIXES[mixId].tools || TOOL_ORDER)) for (const o of optionsOf(t)) {
          const run = Object.assign({ tool: t, input: l.id, prop: TOOLS[t].ok[0] }, o);
          const r = apply(node.st, run);
          if (!r.ok) continue;
          const path = node.path.concat([run]);
          const isClean = r.state.steps.every(x => x.warns.length === 0);
          if (evaluate(r.state).done) { if (!any) any = path; if (isClean && !clean) clean = path; }
          const sg = sig(r.state) + (isClean ? 'C' : 'D');
          if (!seen.has(sg)) { seen.add(sg); next.push({ st: r.state, path }); }
        }
      }
      frontier = next;
    }
    const path = clean || any; if (!path) return null;
    let st = initState(mixId); const steps = [];
    path.forEach((run, i) => {
      const input = st.samples.find(x => x.id === run.input);
      const alts = (run.tool === 'cool' || run.tool === 'float') ? optionsOf(run.tool).filter(o => { const q = apply(st, Object.assign({}, run, o)); return q.ok && q.state.steps.every(x => x.warns.length === 0); })
        .map(o => o.temp !== undefined ? o.temp + '℃' : LIQUIDS[o.liquid].name) : [];
      const r = apply(st, run); st = r.state;
      const stp = st.steps[st.steps.length - 1];
      steps.push({ n: i + 1, tool: toolLabel(stp), prop: PROPS[run.prop] || '', input: input.label + ' (' + describe(input.comps) + ')',
        outs: stp.outIds.map(id => { const o = st.samples.find(x => x.id === id); return o.label + ': ' + describe(o.comps); }), note: stp.note || '', alts });
    });
    return { steps, clean: !!clean };
  }

  /* ---------- 코치(규칙 기반 질문형 힌트) ---------- */
  const HINTS = {
    iron: ['철 가루에만 있는 독특한 성질은 무엇일까? 다른 물질과 달리 철 가루만 보이는 반응을 떠올려 봐.',
           '물질의 특성 표에는 없지만, 철 가루를 골라낼 수 있는 성질이 있어. 자석에 붙는 성질(자성)을 이용하는 도구를 써 볼까?'],
    layers: ['섞이지 않는 두 액체가 위아래로 나뉘어 있어. 무엇이 다르기에 위·아래가 정해질까?',
             '밀도가 다르면 층이 나뉘어. 밀도 차를 이용해 층을 나눌 수 있는 유리 기구는 무엇일까?'],
    saltSolids: ['소금과 금속 가루에 물을 부으면 각각 어떻게 될까? 반응이 다른 물질이 있지 않을까?',
                 '물에 녹는 성질(용해도)이 다른 점을 이용해 보자. 먼저 물을 부어 볼까?'],
    solidLiquid: ['물에 녹지 않는 고체가 액체 속에 섞여 있어. 물에 녹는 정도(용해도)가 다른 점으로 나눌 수 있을까?',
                  '거름종이를 끼운 거름 장치로 녹지 않은 고체를 걸러 낼 수 있어.'],
    dissolved: ['소금물에서 소금만 얻을 때와 물까지 얻을 때, 방법이 같을까? 끓는점을 비교해 봐.',
                '물까지 모으고 싶다면 날아가는 수증기를 어떻게 하면 될까? 끓어 나온 기체를 식히는 장치를 생각해 봐.'],
    hotStearic: ['뜨거운 물속에서 녹아 액체가 된 물질이 있어. 이 물질은 식히면 어떻게 될까? 표의 녹는점을 어떻게 이용할 수 있을까?',
                 '녹는점이 높은 물질이 먼저 굳어. 표의 녹는점보다 낮은 온도까지 식혀서 굳힌 다음 어떻게 꺼낼 수 있을까?'],
    solids: ['고체끼리 섞여 있어. 두 고체를 이루는 물질은 무엇이 서로 다를까? 표에서 찾아봐.',
             '두 고체의 밀도 사이의 밀도를 가진 액체에 넣으면 한쪽은 뜨고 한쪽은 가라앉아. 표의 밀도 값을 비교해서 액체를 골라 봐.'],
    generic: ['아직 섞여 있는 시료에서, 서로 다르게 가진 특성이 무엇인지 특성 표에서 찾아봐.',
              '물질마다 다른 특성(밀도·용해도·끓는점)을 하나 골라서 그 차이를 이용하는 도구를 찾아봐.']
  };
  function hintKey(state) {
    const leaves = state.samples.filter(s => !s.used);
    const mixedLeaves = leaves.filter(l => subsOf(l).length > 1);
    if (!mixedLeaves.length) return 'generic';
    const l = mixedLeaves[0];
    if (l.comps.every(c => c.f === 'solid') && subsOf(l).length >= 2 && !has(l.comps, 'iron')) return 'solids';
    if (has(l.comps, 'iron', 'solid')) return 'iron';
    if (has(l.comps, 'water', 'liquid') && l.comps.some(c => LAYER(c) === 'oil')) return 'layers';
    if (l.hot && l.comps.some(c => c.f === 'liquid' && SUBS[c.s].layer === 'oil' && SUBS[c.s].mp > 25)) return 'hotStearic';
    if (l.comps.some(c => c.f === 'solid' && SUBS[c.s].soluble) && !has(l.comps, 'water')) return 'saltSolids';
    if (l.comps.some(c => c.f === 'solid') && l.comps.some(isLiquidPhase)) return 'solidLiquid';
    if (l.comps.some(c => c.f === 'dissolved') || has(l.comps, 'water', 'liquid')) return 'dissolved';
    return 'generic';
  }
  function hintText(key, level) {
    const arr = HINTS[key] || HINTS.generic;
    return arr[Math.min(level, arr.length - 1)];
  }

  /* ---------- 이벤트 재생(모든 기기 공통) ---------- */
  function replay(events, opts) {
    opts = opts || {};
    const hintLimit = opts.hintLimit === undefined ? 3 : opts.hintLimit;
    let mixId = 'L2';
    let stack = [initState(mixId)];
    const log = [];            // {kind:'step'|'fail', ...}
    const fields = {};
    const hintEvents = [];
    const stats = { fails: 0, undos: 0, resets: 0, runs: 0 };
    let hintLevels = {};
    (events || []).forEach(e => {
      switch (e.type) {
        case 'mixture':
          mixId = MIXES[e.id] ? e.id : mixId;
          stack = [initState(mixId)]; log.length = 0; hintLevels = {};
          Object.keys(fields).forEach(k => { if (k.indexOf('frame.') === 0 || k.indexOf('ai.') === 0 || k.indexOf('pres.') === 0) delete fields[k]; });
          break;
        case 'reset':
          stack = [initState(mixId)]; log.length = 0; stats.resets++; break;
        case 'undo':
          if (stack.length > 1) {
            stack.pop(); stats.undos++;
            for (let i = log.length - 1; i >= 0; i--) { if (log[i].kind === 'step') { log.splice(i, 1); break; } }
          }
          break;
        case 'run': {
          const cur = stack[stack.length - 1];
          const r = apply(cur, { tool: e.tool, input: e.input, prop: e.prop, temp: e.temp, liquid: e.liquid, who: e.who });
          if (r.ok) { stack.push(r.state); stats.runs++; log.push({ kind: 'step', seq: e.seq, step: r.step }); }
          else { stats.fails++; log.push({ kind: 'fail', seq: e.seq, tool: e.tool, input: e.input, reason: r.reason, who: e.who || '' }); }
          break;
        }
        case 'set': fields[e.key] = e.value; break;
        case 'hint':
          if (hintEvents.length < hintLimit) {
            const key = e.key || 'generic';
            const lvl = hintLevels[key] || 0;
            hintLevels[key] = lvl + 1;
            hintEvents.push({ key, level: lvl, text: hintText(key, lvl), who: e.who || '', seq: e.seq });
          }
          break;
      }
    });
    const state = stack[stack.length - 1];
    return {
      mixId, mix: MIXES[mixId], state, log, fields, stats,
      eval: evaluate(state),
      hints: { used: hintEvents.length, limit: hintLimit, last: hintEvents[hintEvents.length - 1] || null, all: hintEvents },
      key: hintKey(state)
    };
  }

  /* ---------- 서술 틀 초안 ---------- */
  const CIRCLED = ['①', '②', '③', '④', '⑤', '⑥', '⑦', '⑧'];
  const toolLabel = st => TOOLS[st.tool].name + (st.temp !== undefined ? `(${st.temp}℃)` : '') + (st.liquid ? `(${LIQUIDS[st.liquid].name})` : '');
  function describe(comps) {
    return Array.from(new Set(comps.filter(c => !c.added).map(c => SUBS[c.s].name))).join(', ') || '(없음)';
  }
  function draftFrame(view) {
    const st = view.state;
    const byId = id => st.samples.find(s => s.id === id);
    const L = view.state.steps.map((s, i) => {
      const outs = s.outIds.map(byId);
      return { c: CIRCLED[i] || (i + 1) + '.', tool: toolLabel(s), prop: PROPS[s.prop] || '', outs, input: byId(s.input) };
    });
    return {
      order: L.map(x => x.c + ' ' + x.tool).join(' → '),
      prop:  L.map(x => x.c + ' ' + x.prop + ' 차이').join('\n'),
      tool:  L.map(x => x.c + ' ' + x.tool + '(' + describe(x.input.comps) + '이(가) 섞인 시료에 사용)').join('\n'),
      result: L.map(x => x.c + ' ' + x.outs.map(o => o.label + ': ' + describe(o.comps)).join(' / ')).join('\n')
    };
  }

  return { SUBS, PROPS, TOOLS, TOOL_ORDER, MIXES, FIELDS, CHOICES, WARN_TEXT, answerOf, showValue, checkBlank,
    initState, apply, evaluate, solve, solution, replay, hintKey, hintText, draftFrame, describe, subsOf,
    COOL_TEMPS, VARIANT_IDS, variantFor, fieldsOf, propsOf, LIQUIDS, LIQUID_IDS, ADV_IDS, SOL_IDS, advFor, solFor, toolLabel, toolsOf: id => MIXES[id].tools || TOOL_ORDER };
});
