/* 혼합물 분리 설계실 - 화면 로직 */
(function () {
  'use strict';
  const CFG = Object.assign({ BACKEND_URL: '', PADLET_URL: '', PADLET_URLS: {}, HINT_LIMIT: 3, POLL_MS: 3000, POLL_IDLE_MS: 7000, MIX_MODE: 'variant', FIXED_MIXTURE: 'L2' }, window.SSL_CONFIG || {});
  const E = window.Engine;
  const $ = (s, el) => (el || document).querySelector(s);
  const $$ = (s, el) => Array.from((el || document).querySelectorAll(s));
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const norm = s => String(s || '').replace(/\s+/g, '').slice(0, 30);
  // 반·모둠 구분 키: 숫자만 같으면 같은 방 ('3', '3모둠', '3 모둠' → 3 / '2학년 3반', '2-3' → 2-3)
  const keyOf = s => { const d = String(s || '').match(/\d+/g); return d ? d.slice(0, 3).map(x => String(Number(x))).join('-') : norm(s); };
  const labelOf = (s, suffix) => /^\s*\d+\s*$/.test(String(s || '')) ? Number(s) + suffix : String(s || '').trim().slice(0, 12);

  /* ---------- 안전한 저장소 ---------- */
  const mem = {};
  const store = {
    get(k) { try { const v = localStorage.getItem(k); return v === null ? (mem[k] || null) : v; } catch (e) { return mem[k] || null; } },
    set(k, v) { try { localStorage.setItem(k, v); } catch (e) { mem[k] = v; } }
  };
  function sessionId() {
    let id = null;
    try { id = sessionStorage.getItem('ssl:cid'); } catch (e) {}
    if (!id) {
      id = 'c' + Math.random().toString(36).slice(2, 8) + Date.now().toString(36).slice(-4);
      try { sessionStorage.setItem('ssl:cid', id); } catch (e) {}
    }
    return id;
  }

  /* ---------- 네트워크 계층 ---------- */
  class RemoteNet {
    constructor(url) { this.url = url; this.mode = 'remote'; }
    async get(params) {
      const u = new URL(this.url);
      Object.keys(params).forEach(k => u.searchParams.set(k, params[k]));
      const r = await fetch(u.toString());
      return r.json();
    }
    async post(body) {
      const r = await fetch(this.url, { method: 'POST', body: JSON.stringify(body) });
      return r.json();
    }
    join(c) { return this.post({ action: 'join', cls: c.cls, room: c.room, cid: c.cid, name: c.name, role: c.role }); }
    poll(c, since, dv) { return this.get({ action: 'poll', cls: c.cls, room: c.room, cid: c.cid, name: c.name, role: c.role, since, dv }); }
    event(c, ev, since, dv) { return this.post({ action: 'event', cls: c.cls, room: c.room, cid: c.cid, name: c.name, role: c.role, ev, since, dv }); }
    draft(c, d) { return this.post({ action: 'draft', cls: c.cls, room: c.room, draft: d }); }
    publish(c, payload) { return this.post({ action: 'publish', cls: c.cls, room: c.room, groupName: c.roomLabel, mixtureId: payload.mixtureId, payload }); }
    comment(c, target, from, kind, text) { return this.post({ action: 'comment', cls: c.cls, target, from, kind, text }); }
    gallery(cls) { return this.get({ action: 'gallery', cls }); }
    overview(cls) { return this.get({ action: 'overview', cls }); }
  }

  class LocalNet {
    constructor() {
      this.mode = 'local';
      try { this.bc = new BroadcastChannel('ssl-mixlab'); this.bc.onmessage = () => { if (this.onChange) this.onChange(); }; } catch (e) { this.bc = null; }
    }
    _get(k) { const v = store.get(k); try { return v ? JSON.parse(v) : null; } catch (e) { return null; } }
    _set(k, v) { store.set(k, JSON.stringify(v)); if (this.bc) this.bc.postMessage(1); }
    _rk(c) { return 'ssl:room:' + c.cls + ':' + c.room; }
    _room(c) { return this._get(this._rk(c)) || { seq: 0, events: [], clients: [], draft: {}, dv: 0 }; }
    _pres(c, touch) {
      const k = 'ssl:pres:' + c.cls + ':' + c.room;
      const m = this._get(k) || {}, now = Date.now();
      if (touch && c.cid) m[c.cid] = { name: c.name, role: c.role, ts: now };
      Object.keys(m).forEach(id => { if (now - m[id].ts > 20000) delete m[id]; });
      if (touch) store.set(k, JSON.stringify(m));
      return Object.keys(m).map(id => ({ cid: id, name: m[id].name, role: m[id].role }));
    }
    _view(c, r, since, dv) {
      return { ok: true, seq: r.seq, events: r.events.filter(e => e.seq > since), dv: r.dv, draft: r.dv !== dv ? r.draft : undefined, presence: this._pres(c, true), known: true };
    }
    async join(c) { const r = this._room(c); return this._view(c, r, 0, -1); }
    async poll(c, since, dv) { return this._view(c, this._room(c), since, dv); }
    async event(c, ev, since, dv) {
      const r = this._room(c);
      const skip = ev.ifEmpty && r.events.some(e => e.type === 'mixture' || e.type === 'run');
      if (!skip) {
        r.seq += 1; ev.seq = r.seq; ev.ts = Date.now(); delete ev.ifEmpty; r.events.push(ev);
        if (['mixture', 'run', 'undo', 'reset'].includes(ev.type)) { r.draft = {}; r.dv += 1; }
        this._set(this._rk(c), r);
      }
      return this._view(c, r, since, dv);
    }
    async draft(c, d) { const r = this._room(c); r.draft = d; r.dv += 1; this._set(this._rk(c), r); return { ok: true }; }
    async publish(c, payload) {
      const k = 'ssl:gal:' + c.cls; const g = this._get(k) || {};
      g[c.room] = { ts: Date.now(), room: c.room, groupName: c.roomLabel, mixtureId: payload.mixtureId, payload, comments: (g[c.room] && g[c.room].comments) || [] };
      this._set(k, g); return { ok: true };
    }
    async comment(c, target, from, kind, text) {
      const k = 'ssl:gal:' + c.cls; const g = this._get(k) || {};
      if (g[target]) g[target].comments.push({ ts: Date.now(), from, kind, text: String(text).slice(0, 200) });
      this._set(k, g); return { ok: true };
    }
    async gallery(cls) { const g = this._get('ssl:gal:' + cls) || {}; return { ok: true, items: Object.keys(g).map(k => g[k]) }; }
    async overview(cls) {
      const rooms = [];
      let keys = [];
      try { for (let i = 0; i < localStorage.length; i++) keys.push(localStorage.key(i)); } catch (e) {}
      keys.filter(k => k.indexOf('ssl:room:' + cls + ':') === 0).forEach(k => {
        const room = k.slice(('ssl:room:' + cls + ':').length);
        const r = this._get(k); rooms.push({ room, seq: r.seq, events: r.events, presence: this._pres({ cls, room }, false) });
      });
      return { ok: true, rooms };
    }
  }

  /* ---------- 상태 ---------- */
  const S = {
    cls: '', room: '', roomLabel: '', name: '', role: '', cid: sessionId(),
    events: [], seq: 0, dv: -1, draft: {}, presence: [], view: null,
    sel: { sample: '', tool: '', prop: '', temp: 0 }, selAt: 0, draftBy: '',
    tab: 'survey', banner: null, shownLog: 0, lastActive: Date.now(), net: null,
    online: true, polling: false, pollTimer: null, draftTimer: null, gallery: null
  };
  const solveCache = {};
  const solveFor = id => solveCache[id] || (solveCache[id] = E.solve(id));
  const ctx = () => ({ cls: S.cls, room: S.room, roomLabel: S.roomLabel, cid: S.cid, name: S.name, role: S.role });

  const ROLES = [
    { id: '설계자', desc: '분리 방법을 생각해 제안해요', tasks: ['조사 표를 보고 물질마다 다른 특성 찾기', '어떤 특성·도구·순서로 분리할지 모둠에 제안하기', '그렇게 설계한 이유를 설명하기'] },
    { id: '조작자', desc: '실험 도구를 직접 눌러요', tasks: ['모둠이 정한 시료·도구·특성을 고르고 ‘실험 실행’ 누르기', '잘못되면 ‘한 단계 되돌리기’ 누르기', '실행 결과를 모둠에 읽어 주기'] },
    { id: '기록자', desc: '표와 서술 칸을 정리해요', tasks: ['① 특성 조사 표와 AI 검증 표 입력하기', '③ 서술 정리와 ④ 발표 준비 칸 쓰기', '한 칸은 한 명씩 입력하기'] },
    { id: '검토자', desc: '결과가 맞는지 확인해요', tasks: ['실행 결과와 ⚠ 주의 메시지 확인하기', '막히면 힌트 요청하기(모둠 전체 3번)', '서술이 실험 결과와 맞는지 점검하고 갤러리에 댓글 남기기'] }
  ];
  const roleGuide = () => '<div class="roleguide">' + ROLES.map(r => `<div><b>${r.id}</b> <span class="muted">${r.desc}</span><ul>${r.tasks.map(t => `<li>${t}</li>`).join('')}</ul></div>`).join('') + '</div>';
  const TYPE_NOTICE = '<p class="notice typenote">✍ <b>글은 한 칸에 한 명씩 입력해요.</b> 같은 칸을 두 사람이 동시에 쓰면 나중에 저장된 글만 남고 먼저 쓴 글은 사라져요. 입력할 사람을 정하고, 나머지는 화면을 보며 말로 도와주세요. (역할은 안내용이라 누구나 모든 칸을 쓸 수 있어요.)</p>';

  function toast(msg) {
    const old = $('.toast'); if (old) old.remove();
    const t = document.createElement('div'); t.className = 'toast'; t.setAttribute('role', 'status'); t.textContent = msg;
    document.body.appendChild(t); setTimeout(() => t.remove(), 3200);
  }

  /* ---------- 동기화 ---------- */
  function recompute() {
    const hadView = !!S.view;
    const prevLen = hadView ? S.view.log.length : 0;
    S.view = E.replay(S.events, { hintLimit: CFG.HINT_LIMIT });
    const v = S.view;
    if (v.log.length !== prevLen) {
      if (hadView && v.log.length > prevLen) S.banner = v.log[v.log.length - 1];   // 새 실행 결과(내 기기·다른 기기 모두)
      else S.banner = null;                                                        // 되돌리기·처음부터·혼합물 변경
      S.sel = { sample: '', tool: '', prop: '', temp: 0 };
    }
  }
  const startMixture = () => (CFG.MIX_MODE === 'variant' && E.MIXES[E.variantFor(String(S.room).split('-')[0])]) ? E.variantFor(String(S.room).split('-')[0]) : (E.MIXES[CFG.FIXED_MIXTURE] ? CFG.FIXED_MIXTURE : 'L2');

  function applyPayload(resp) {
    if (!resp || !resp.ok) return false;
    let changed = false;
    const have = new Set(S.events.map(e => e.seq));
    (resp.events || []).forEach(ev => { if (!have.has(ev.seq)) { S.events.push(ev); changed = true; } });
    if (changed) {
      S.events.sort((a, b) => a.seq - b.seq);
      S.lastActive = Date.now();
    }
    if (typeof resp.seq === 'number' && resp.seq > S.seq) S.seq = resp.seq;
    S.presence = resp.presence || S.presence;
    let draftChanged = false;
    if (resp.draft !== undefined && Date.now() - S.selAt > 1500) {
      S.dv = resp.dv;
      const d = resp.draft || {};
      const nd = { sample: d.sample || '', tool: d.tool || '', prop: d.prop || '', temp: Number(d.temp) || 0 };
      if (nd.sample !== S.sel.sample || nd.tool !== S.sel.tool || nd.prop !== S.sel.prop || nd.temp !== S.sel.temp) { S.sel = nd; draftChanged = true; S.lastActive = Date.now(); }
      S.draftBy = d.by || '';
    }
    if (changed) recompute();
    if (changed || draftChanged) render();
    else renderHeader();
    return true;
  }

  async function send(ev) {
    ev.who = S.name;
    try {
      const r = await S.net.event(ctx(), ev, S.seq, S.dv);
      if (!r.ok) throw new Error(r.error || 'error');
      setOnline(true); applyPayload(r);
    } catch (e) { setOnline(false); toast('전송에 실패했어요. 네트워크를 확인하고 다시 눌러 주세요.'); }
  }
  function setOnline(v) { if (S.online !== v) { S.online = v; renderHeader(); } }

  async function pollOnce() {
    if (!S.net) return;
    try {
      const r = await S.net.poll(ctx(), S.seq, S.dv);
      if (r && r.ok) {
        setOnline(true);
        if (r.known === false) { const j = await S.net.join(ctx()); applyPayload(j); } else applyPayload(r);
      } else setOnline(false);
    } catch (e) { setOnline(false); }
  }
  function schedulePoll() {
    clearTimeout(S.pollTimer);
    S.pollTimer = setTimeout(async () => {
      if (!S.net) return;
      if (!document.hidden) await pollOnce();
      schedulePoll();
    }, (Date.now() - S.lastActive > 30000) ? CFG.POLL_IDLE_MS : CFG.POLL_MS);
  }
  document.addEventListener('visibilitychange', () => { if (!document.hidden && S.net && S.cls) pollOnce(); });

  function queueDraft() {
    S.selAt = Date.now(); S.lastActive = Date.now();
    clearTimeout(S.draftTimer);
    S.draftTimer = setTimeout(() => {
      S.net.draft(ctx(), { tool: S.sel.tool, sample: S.sel.sample, prop: S.sel.prop, temp: S.sel.temp || 0, by: S.name }).catch(() => {});
    }, 250);
  }

  /* ---------- 입장 ---------- */
  function buildJoin() {
    const prof = JSON.parse(store.get('ssl:profile') || '{}');
    $('#jCls').value = prof.cls || ''; $('#jRoom').value = prof.room || ''; $('#jName').value = prof.name || '';
    let role = prof.role || '조작자';
    const box = $('#roles');
    function paint() {
      box.innerHTML = ROLES.map(r => `<button type="button" class="role" aria-pressed="${r.id === role}" data-role="${r.id}"><b>${r.id}</b><small>${r.desc}</small><ul>${r.tasks.map(t => `<li>${t}</li>`).join('')}</ul></button>`).join('');
    }
    paint();
    box.onclick = e => { const b = e.target.closest('[data-role]'); if (b) { role = b.dataset.role; paint(); } };
    $('#joinForm').onsubmit = ev => {
      ev.preventDefault();
      const cls = keyOf($('#jCls').value), room = keyOf($('#jRoom').value), name = $('#jName').value.trim().slice(0, 8);
      if (!cls || !room || !name) return;
      store.set('ssl:profile', JSON.stringify({ cls: $('#jCls').value.trim(), room: $('#jRoom').value.trim(), name, role }));
      enter(cls, room, labelOf($('#jRoom').value, '모둠'), name, role);
    };
  }

  async function enter(cls, room, roomLabel, name, role) {
    Object.assign(S, { cls, room, roomLabel, name, role, events: [], seq: 0, dv: -1, view: null, banner: null, sel: { sample: '', tool: '', prop: '', temp: 0 }, tab: 'survey', gallery: null });
    S.net = CFG.BACKEND_URL ? new RemoteNet(CFG.BACKEND_URL) : new LocalNet();
    if (S.net.mode === 'local') S.net.onChange = () => pollOnce();
    try {
      const r = await S.net.join(ctx());
      if (!r || !r.ok) throw new Error((r && r.error) || 'join failed');
      setOnline(true);
      showScreen('app');
      applyPayload(r);
      if (!S.events.some(e => e.type === 'mixture' || e.type === 'run')) await send({ type: 'mixture', id: startMixture(), ifEmpty: true });
      if (!S.view) recompute();
      renderHeader(); setTab('survey'); schedulePoll();
    } catch (e) {
      toast('입장에 실패했어요. 주소(BACKEND_URL)나 네트워크를 확인해 주세요.');
    }
  }
  function leave() {
    clearTimeout(S.pollTimer); S.net = null; S.cls = '';
    showScreen('join'); renderHeader();
  }

  function showScreen(name) {
    ['Join', 'App', 'Teacher'].forEach(n => $('#screen' + n).classList.toggle('hidden', n.toLowerCase() !== name));
  }

  /* ---------- 머리말 ---------- */
  function renderHeader() {
    const box = $('#topRight');
    if (!S.cls) { box.innerHTML = ''; return; }
    const mode = S.net && S.net.mode === 'local' ? ['local', '이 기기 모드'] : S.online ? ['on', '연결됨'] : ['off', '연결 끊김'];
    const who = (S.presence || []).map(p => `<span class="pill">${esc(p.name)}${p.role ? ' · ' + esc(p.role) : ''}</span>`).join('');
    box.innerHTML = `<span class="pill ${mode[0]}"><span class="dot"></span>${mode[1]}</span>
      <span class="pill">${esc(S.cls)} · ${esc(S.roomLabel)}</span>
      <span class="who" aria-label="접속 중인 기기">${who}</span>
      <button class="btn small" id="btnLeave" type="button">나가기</button>`;
    $('#btnLeave').onclick = leave;
  }

  /* ---------- 탭 ---------- */
  function setTab(t) {
    S.tab = t;
    $$('#tabs .tab').forEach(b => b.setAttribute('aria-selected', b.dataset.tab === t));
    ['Survey', 'Lab', 'Frame', 'Share'].forEach(n => $('#panel' + n).classList.toggle('hidden', n.toLowerCase() !== t));
    surveyBuiltFor = ''; frameBuilt = false;
    render();
    if (t === 'share') refreshShare();
  }
  $('#tabs').addEventListener('click', e => { const b = e.target.closest('.tab'); if (b) setTab(b.dataset.tab); });

  function render() {
    if (!S.view) return;
    renderHeader();
    if (S.tab === 'survey') renderSurvey();
    else if (S.tab === 'lab') renderLab();
    else if (S.tab === 'frame') renderFrame();
    else if (S.tab === 'share') renderShareCard();
  }

  /* ---------- AI 답변 검증 기록 ---------- */
  const AI_ROWS = 3;
  const AI_FIELDS = ['끓는점', '녹는점', '밀도', '물에 대한 성질', '자석에 붙는가'];
  const AI_VERDICTS = ['같다', '다르다', '확인 못함'];
  function aiRecords(fields) {
    const out = [];
    for (let i = 0; i < AI_ROWS; i++) {
      const g = k => (fields['ai.' + i + '.' + k] || '').trim();
      const r = { sub: g('sub'), field: g('field'), ai: g('ai'), ref: g('ref'), verdict: g('verdict'), src: g('src') };
      if (r.ai || r.ref) out.push(r);
    }
    return out;
  }
  function aiSummary(fields) {
    const rec = aiRecords(fields).filter(r => r.ai && r.verdict);
    return { n: rec.length, diff: rec.filter(r => r.verdict === '다르다').length, items: rec.filter(r => r.verdict === '다르다') };
  }

  /* ---------- ① 특성 조사 ---------- */
  let surveyBuiltFor = '';
  function renderSurvey() {
    const v = S.view, m = v.mix, root = $('#panelSurvey');
    if (surveyBuiltFor !== m.id) {
      surveyBuiltFor = m.id;
      const subs = Array.from(new Set(m.comps.map(c => c.s)));
      const head = '<tr><th>물질</th>' + E.FIELDS.map(f => `<th>${f.label}</th>`).join('') + '</tr>';
      const rows = subs.map(s => '<tr><td class="name">' + esc(E.SUBS[s].name) + '</td>' + E.FIELDS.map(f => {
        const b = m.blanks.find(x => x.s === s && x.k === f.k);
        if (!b) return '<td>' + esc(E.showValue(s, f.k)) + '</td>';
        const key = `survey.${s}.${f.k}`;
        if (E.CHOICES[f.k]) {
          return `<td data-cell="${key}"><select data-key="${key}" aria-label="${esc(E.SUBS[s].name)} ${f.label}"><option value="">선택</option>` +
            E.CHOICES[f.k].map(o => `<option>${o}</option>`).join('') + `</select><span class="mark"></span></td>`;
        }
        return `<td data-cell="${key}"><input type="text" inputmode="decimal" data-key="${key}" placeholder="조사해서 입력" aria-label="${esc(E.SUBS[s].name)} ${f.label}"><span class="mark"></span></td>`;
      }).join('') + '</tr>').join('');
      const names = subs.map(x => E.SUBS[x].name);
      const promptExample = `${names.join(', ')}의 끓는점, 녹는점, 밀도, 물에 대한 용해성을 알려 줘. 중학생이 이해할 수 있게 표로 정리하고, 값의 출처도 함께 알려 줘.`;
      const optList = arr => '<option value="">선택</option>' + arr.map(o => `<option>${esc(o)}</option>`).join('');
      let aiRows = '';
      for (let i = 0; i < AI_ROWS; i++) {
        aiRows += `<tr><td>${i + 1}</td>
          <td><select data-key="ai.${i}.sub" aria-label="물질">${optList(names)}</select></td>
          <td><select data-key="ai.${i}.field" aria-label="항목">${optList(AI_FIELDS)}</select></td>
          <td><input type="text" maxlength="40" data-key="ai.${i}.ai" aria-label="AI가 알려준 값"></td>
          <td><input type="text" maxlength="40" data-key="ai.${i}.ref" aria-label="교과서·자료의 값"></td>
          <td data-vcell="${i}"><select data-key="ai.${i}.verdict" aria-label="비교 결과">${optList(AI_VERDICTS)}</select></td>
          <td><input type="text" maxlength="40" data-key="ai.${i}.src" placeholder="예: 교과서 40쪽" aria-label="확인한 곳"></td></tr>`;
      }
      root.innerHTML = `<details class="card roles-card"><summary><b>👥 우리 모둠 역할 안내</b> <span class="muted">(눌러서 보기)</span></summary>${roleGuide()}${TYPE_NOTICE}</details>
      <div class="card">
        <h2><span class="num">1</span>물질의 특성을 조사해 표를 완성해요</h2>
        <p class="muted">파란 점선 칸이 우리 모둠이 조사할 칸이에요. 교과서 표, 과학 자료, 검색으로 찾아보세요.
        <b>AI에게 물어봤다면 꼭 교과서나 과학 자료와 다시 맞춰 보세요.</b> (AI도 틀릴 수 있어요)</p>
        <div class="table-wrap"><table class="props"><thead>${head}</thead><tbody>${rows}</tbody></table></div>
        <p class="muted" id="svProg" style="margin-top:8px"></p>
        ${TYPE_NOTICE}
        <label class="field frame" style="margin-top:12px"><span>이 물질들은 어떤 점이 서로 다를까요? (분리에 쓸 수 있는 차이를 찾아 적어 보세요)</span>
          <textarea data-key="survey.diff" rows="3" style="width:100%;border:2px solid var(--ink);border-radius:10px;padding:10px 12px;background:#fff"></textarea></label>
      </div>
      <div class="card" id="aiCard">
        <h2>🤖 AI에게 물어보고 검증해요</h2>
        <p class="muted">선생님이 허용한 AI 챗봇에게 위 표의 물질 특성을 물어보세요. AI의 답을 그대로 믿지 말고, <b>교과서나 과학 자료의 값과 비교</b>해서 같은지 다른지 기록해요.
        다른 값을 찾았다면 AI의 오류를 찾아낸 거예요!</p>
        <div class="row" style="margin:8px 0"><button class="btn small" type="button" data-copy="${esc(promptExample)}">📋 AI에게 물어볼 질문 예시 복사</button>
          <span class="muted">예시를 그대로 써도 좋고, 우리 모둠 질문으로 바꿔도 좋아요.</span></div>
        <div class="table-wrap"><table class="props aitab"><thead><tr><th>#</th><th>물질</th><th>항목</th><th>AI가 알려준 값</th><th>교과서·자료의 값</th><th>비교 결과</th><th>확인한 곳</th></tr></thead><tbody>${aiRows}</tbody></table></div>
        <p class="muted" id="aiSum" style="margin-top:8px"></p>
        <label class="field frame" style="margin-top:12px"><span>AI를 써 보고 알게 된 점은? (AI의 장점, 조심할 점)</span>
          <textarea maxlength="800" data-key="ai.reflect" rows="3" style="width:100%;border:2px solid var(--ink);border-radius:10px;padding:10px 12px;background:#fff"></textarea></label>
        <div class="row"><button class="btn primary" id="toLab" type="button">② 설계·실험으로 이동 →</button></div>
      </div>`;
      root.onchange = e => { const el = e.target.closest('[data-key]'); if (el) send({ type: 'set', key: el.dataset.key, value: el.value }); };
      root.onclick = async e => {
        if (e.target.id === 'toLab') setTab('lab');
        const cp = e.target.closest('[data-copy]');
        if (cp) { try { await navigator.clipboard.writeText(cp.dataset.copy); toast('질문을 복사했어요. AI 챗봇에 붙여넣어 보세요.'); } catch (er) { toast('복사하지 못했어요. 직접 입력해 주세요.'); } }
      };
    }
    let ok = 0;
    m.blanks.forEach(b => {
      const key = `survey.${b.s}.${b.k}`, cell = $(`[data-cell="${key}"]`, root); if (!cell) return;
      const el = $('[data-key]', cell), val = v.fields[key] || '';
      if (document.activeElement !== el && el.value !== val) el.value = val;
      const res = E.checkBlank(b, val);
      cell.classList.toggle('ok', res === true); cell.classList.toggle('bad', res === false);
      $('.mark', cell).textContent = res === true ? '✓ 맞아요' : res === false ? '다시 확인해 봐요' : '';
      if (res === true) ok++;
    });
    $('#svProg').textContent = `완성한 칸 ${ok} / ${m.blanks.length}`;
    const ta = $('textarea[data-key="survey.diff"]', root), dv = v.fields['survey.diff'] || '';
    if (document.activeElement !== ta && ta.value !== dv) ta.value = dv;
    $$('#aiCard [data-key]', root).forEach(el => {
      const val = v.fields[el.dataset.key] || '';
      if (document.activeElement !== el && el.value !== val) el.value = val;
    });
    for (let i = 0; i < AI_ROWS; i++) {
      const cell = $(`[data-vcell="${i}"]`, root); if (!cell) continue;
      const vd = v.fields['ai.' + i + '.verdict'] || '';
      cell.classList.toggle('ok', vd === '같다'); cell.classList.toggle('bad', vd === '다르다');
    }
    const sm = aiSummary(v.fields);
    $('#aiSum').textContent = sm.n ? `AI 답변 검증 ${sm.n}건 · 다른 값을 찾은 것 ${sm.diff}건` : '아직 기록한 검증이 없어요.';
  }

  /* ---------- ② 설계·실험 ---------- */
  const ICON = {
    magnet: '<path d="M7 6v11a9 9 0 0 0 18 0V6h-6v11a3 3 0 0 1-6 0V6z" fill="#e5e7eb"/><path d="M7 6h6v5H7z" fill="#ef4444"/><path d="M19 6h6v5h-6z" fill="#3b82f6"/>',
    water: '<path d="M16 4C16 4 7 14 7 20a9 9 0 0 0 18 0C25 14 16 4 16 4z" fill="#bfe3f5"/>',
    filter: '<path d="M5 6h22l-8 10v9l-6 3V16z" fill="#f3efe0"/><path d="M13 29v1M19 26v2" />',
    funnel: '<path d="M10 4h12M16 4v3M9 8c0 11 3 15 7 16 4-1 7-5 7-16z" fill="#e8f1f6"/><path d="M16 24v4M13 28h6"/>',
    evaporate: '<path d="M5 22c3 7 19 7 22 0z" fill="#e5e7eb"/><path d="M11 17c2-2 0-4 2-6M17 17c2-2 0-4 2-6M23 17c2-2 0-4 2-6" />',
    distill: '<path d="M7 15 4 27h14l-3-12V8h-5v7z" fill="#e8f1f6"/><path d="M15 8h10v10M23 26h8v-6h-8z" fill="none"/>',
    cool: '<path d="M16 4v24M5 10l22 12M27 10 5 22" /><rect x="11" y="11" width="10" height="10" rx="2" fill="#dbeafe"/>'
  };
  const iconSvg = id => `<svg width="34" height="34" viewBox="0 0 34 34" fill="none" stroke="#1d2b2f" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICON[id]}</svg>`;

  function beakerSVG(smp) {
    const comps = smp.comps, SUBS = E.SUBS;
    const hasAq = comps.some(c => c.s === 'water' && c.f === 'liquid');
    const oil = comps.filter(c => c.f === 'liquid' && SUBS[c.s].layer === 'oil');
    const dissolved = comps.some(c => c.f === 'dissolved');
    const yBot = 100, H = 66;
    let aqH = 0, oilH = 0;
    if (hasAq && oil.length) { aqH = H * 0.55; oilH = H * 0.3; } else if (hasAq) aqH = H * 0.75; else if (oil.length) oilH = H * 0.6;
    let s = '<svg viewBox="0 0 100 114" role="img" aria-label="시료 그림">';
    if (aqH) s += `<rect x="18" y="${yBot - aqH}" width="64" height="${aqH}" fill="${dissolved ? '#b9dcea' : '#cfe8f3'}"/>`;
    if (oilH) s += `<rect x="18" y="${yBot - aqH - oilH}" width="64" height="${oilH}" fill="#f0d36f"/>`;
    const seed = id => id.split('').reduce((a, ch) => a + ch.charCodeAt(0), 0);
    comps.filter(c => c.f === 'solid').forEach((c, idx) => {
      const sd = seed(c.s) + idx * 7, col = SUBS[c.s].color;
      const floating = SUBS[c.s].dens <= 1.0 && hasAq;
      const n = 9;
      for (let i = 0; i < n; i++) {
        const x = 24 + ((i * 6.1 + sd * 3) % 50), y = floating ? (yBot - aqH + 3 + ((i * 3 + sd) % 5)) : (yBot - 3 - ((i * 4 + sd) % 7));
        if (c.s === 'nacl' || SUBS[c.s].soluble) s += `<rect x="${x.toFixed(1)}" y="${(y - 2).toFixed(1)}" width="4" height="4" fill="#fff" stroke="#94a3b8" stroke-width=".8"/>`;
        else if (SUBS[c.s].layer === 'oil') s += `<ellipse cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" rx="3.4" ry="1.7" fill="${col}" stroke="#b59b3b" stroke-width=".7"/>`;
        else s += `<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="2.1" fill="${col}"/>`;
      }
    });
    s += '<path d="M16 16v84q0 6 6 6h56q6 0 6-6V16" fill="none" stroke="#1d2b2f" stroke-width="2.5" stroke-linecap="round"/><path d="M12 16h76" stroke="#1d2b2f" stroke-width="2.5" stroke-linecap="round"/>';
    if (smp.hot) s += '<path d="M34 12q-4-5 0-9M50 12q-4-5 0-9M66 12q-4-5 0-9" fill="none" stroke="#ef4444" stroke-width="2" stroke-linecap="round"/><text x="50" y="112" font-size="9" text-anchor="middle" fill="#b3261e" font-weight="700">약 75 ℃</text>';
    return s + '</svg>';
  }
  const FORM = { solid: '알갱이', liquid: '액체', dissolved: '녹아 있음' };
  const chipsOf = smp => smp.comps.map(c => {
    const nm = c.added ? '물(부은 것)' : E.SUBS[c.s].name;
    return `<span class="chip"><i style="background:${E.SUBS[c.s].color}"></i>${esc(nm)}<small>${FORM[c.f]}</small></span>`;
  }).join('');

  function renderLab() {
    const v = S.view, st = v.state, ev = v.eval, root = $('#panelLab');
    const leaves = st.samples.filter(s => !s.used), usedN = st.samples.length - leaves.length;
    if (S.sel.sample && !leaves.find(l => l.id === S.sel.sample)) S.sel.sample = '';
    const mixCard = id => {
      const m = E.MIXES[id];
      return `<button class="mix" data-act="mix" data-id="${id}" aria-pressed="${v.mixId === id}"><span class="lv">${m.level}</span><div class="ttl">${esc(m.title)}</div><div class="muted">${esc(m.desc)}</div><div class="tags">${m.focus.map(f => `<span class="tag">${f}</span>`).join('')}</div></button>`;
    };
    let mixes;
    if (CFG.MIX_MODE === 'variant') {
      const m = v.mix, own = startMixture();
      mixes = `<div class="assigned"><span class="lv">${m.variant ? '우리 모둠 혼합물' : '연습용 혼합물'}</span><div class="ttl">${esc(m.title)}</div><div>${esc(m.desc)}</div>
        <div class="tags">${m.focus.map(f => `<span class="tag">${f}</span>`).join('')}</div>
        <p class="muted" style="margin:6px 0 0">${m.variant ? '모둠마다 섞여 있는 물질은 달라요. 하지만 이용하는 특성(밀도·용해도·끓는점·녹는점)은 같아요. 발표 때 비교해 봐요!' : ''}</p></div>
        <details class="othermix"><summary>다른 혼합물로 바꾸기 (선생님이 안내할 때만)</summary>
        <div class="mixes">${Object.keys(E.MIXES).filter(id => E.MIXES[id].variant ? id === own : true).map(mixCard).join('')}</div></details>`;
    } else mixes = '<div class="mixes">' + Object.keys(E.MIXES).filter(id => !E.MIXES[id].variant).map(mixCard).join('') + '</div>';
    const tray = leaves.map(l => {
      const subs = E.subsOf(l), soln = l.comps.some(c => c.f === 'dissolved');
      const badge = subs.length === 1 && !soln ? '<span class="badge-pure">순물질</span>' : soln && subs.length === 1 ? '<span class="badge-soln">용액</span>' : '';
      return `<button class="smp ${S.sel.sample === l.id ? 'sel' : ''}" data-act="sample" data-id="${l.id}" aria-pressed="${S.sel.sample === l.id}">${badge}${beakerSVG(l)}<div class="lbl">${esc(l.label)}</div><div class="chips">${chipsOf(l)}</div></button>`;
    }).join('');
    const tempChips = S.sel.tool === 'cool' ? `<p style="margin:12px 0 6px;font-weight:800">몇 ℃의 물에서 식힐까요? <span class="muted" style="font-weight:400">(표의 녹는점과 비교해 봐요)</span></p><div class="props-pick">${E.COOL_TEMPS.map(t => `<button class="pp" data-act="temp" data-id="${t}" aria-pressed="${S.sel.temp === t}">${t} ℃</button>`).join('')}</div>` : '';
    const tools = E.toolsOf(v.mixId).map(id => `<button class="tool" data-act="tool" data-id="${id}" aria-pressed="${S.sel.tool === id}">${iconSvg(id)}${E.TOOLS[id].name}</button>`).join('');
    const tdef = E.TOOLS[S.sel.tool];
    const help = tdef ? `<div class="tool-help"><b>${tdef.name} 사용법</b><br>${esc(tdef.use)}${tdef.safe ? `<div class="safe">⚠ 안전: ${esc(tdef.safe)}</div>` : ''}</div>` : '<div class="tool-help muted">도구를 고르면 사용법과 안전 수칙이 나와요.</div>';
    const props = Object.keys(E.PROPS).map(k => `<button class="pp" data-act="prop" data-id="${k}" aria-pressed="${S.sel.prop === k}">${E.PROPS[k]}</button>`).join('');
    const smpSel = leaves.find(l => l.id === S.sel.sample);
    const ready = smpSel && S.sel.tool && S.sel.prop && (S.sel.tool !== 'cool' || S.sel.temp);
    const summary = `시료 <b>${smpSel ? esc(smpSel.label) : '?'}</b> + 도구 <b>${tdef ? tdef.name + (S.sel.tool === 'cool' ? (S.sel.temp ? ' (' + S.sel.temp + '℃)' : ' (온도 ?)') : '') : '?'}</b> + 이용할 특성 <b>${S.sel.prop ? E.PROPS[S.sel.prop] : '?'}</b>` +
      (S.draftBy && S.draftBy !== S.name && (S.sel.sample || S.sel.tool || S.sel.prop) ? ` <span class="by">· ${esc(S.draftBy)}님이 고르는 중</span>` : '');

    // 결과 배너
    let banner = '';
    if (S.banner) {
      const b = S.banner;
      if (b.kind === 'fail') {
        banner = `<div class="result fail" role="status"><b>✗ 실행할 수 없었어요${b.who ? ' (' + esc(b.who) + ')' : ''}</b>${esc(b.reason)}<ul><li>도구의 사용 조건을 다시 읽고, 시료의 상태(고체·액체·녹아 있음)를 살펴봐요.</li></ul></div>`;
      } else {
        const s = b.step, outs = s.outIds.map(id => st.samples.find(x => x.id === id)).filter(Boolean);
        const lis = [];
        if (s.propOk) lis.push('이용한 특성 선택이 알맞아요: ' + E.PROPS[s.prop]);
        else lis.push(`특성 선택을 다시 생각해 봐요. <b>${E.TOOLS[s.tool].name}</b>은(는) <b>${E.TOOLS[s.tool].ok.map(k => E.PROPS[k]).join(' 또는 ')}</b> 차이를 이용해요.`);
        s.warns.forEach(w => lis.push('⚠ ' + E.WARN_TEXT[w]));
        banner = `<div class="result ${s.warns.length || !s.propOk ? 'warn' : 'ok'}" role="status"><b>✓ ${s.n}단계 실행: ${E.toolLabel(s)}${s.who ? ' (' + esc(s.who) + ')' : ''}</b>${esc(s.note)}<ul>${lis.map(x => `<li>${x}</li>`).join('')}</ul>
        <div style="margin-top:6px" class="muted">새 시료: ${outs.map(o => esc(o.label) + ' [' + esc(E.describe(o.comps)) + ']').join(' / ')}</div></div>`;
      }
    }

    // 진행 상황
    const names = E.SUBS;
    const prog = ev.need.map(s => {
      const cls = ev.recovered.includes(s) ? 'ok' : ev.lost.includes(s) ? 'lost' : '';
      const mark = cls === 'ok' ? '✓ ' : cls === 'lost' ? '✗ ' : '… ';
      return `<span class="prog ${cls}">${mark}${names[s].name}${cls === 'lost' ? ' (사라짐)' : ''}</span>`;
    }).join('');
    let verdict = '';
    const sol = solveFor(v.mixId);
    if (ev.done) {
      const short = ev.steps <= sol.minSteps;
      const safeBest = ev.warnCount === 0 && sol.minCleanSteps && ev.steps <= sol.minCleanSteps;
      const lines = [];
      if (short) lines.push(`🎉 모든 물질을 분리했어요! ${ev.steps}단계로, 가장 짧은 경로예요.`);
      else if (safeBest) lines.push(`🎉 모든 물질을 분리했어요! ${ev.steps}단계는 주의할 점이 없는 경로 중 가장 짧아요. (주의가 필요한 ${sol.minSteps}단계 경로도 있어요. 어떤 점이 문제일까요?)`);
      else lines.push(`✅ 모든 물질을 분리했어요. ${ev.steps}단계예요. 더 짧은 경로(${sol.minSteps}단계)도 있으니 순서를 바꿔 볼까요?`);
      if (ev.warnCount) lines.push(`⚠ 안전·안정성 주의가 ${ev.warnCount}번 있었어요.` + (sol.minCleanSteps ? ` 주의 없이 하는 경로는 최소 ${sol.minCleanSteps}단계예요.` : ''));
      if (ev.badProp) lines.push(`이용한 특성을 잘못 고른 단계가 ${ev.badProp}개 있어요. 서술형에서는 '어떤 특성의 차이'인지가 중요해요.`);
      verdict = `<div class="verdict good">${lines.join('<br>')}<div class="row" style="margin-top:8px"><button class="btn small" data-act="goframe" type="button">③ 서술 정리로 이동</button></div></div>`;
    } else if (v.stats.runs > 0) {
      const lostT = ev.lost.length ? ` ${ev.lost.map(s => names[s].name).join(', ')}은(는) 증발해 사라졌어요. 모으려면 어떻게 해야 할까요?` : '';
      verdict = `<div class="verdict mid">아직 얻지 못한 물질: <b>${ev.missing.map(s => names[s].name).join(', ')}</b>.${lostT}</div>`;
    }

    // 코치
    const h = v.hints;
    const coach = `<div class="card coach"><h2>🧭 코치 (질문으로 도와줘요)</h2>
      <div class="row"><button class="btn small warn" data-act="hint" type="button" ${h.used >= h.limit ? 'disabled' : ''}>힌트 요청</button><span class="muted">남은 횟수 ${h.limit - h.used} / ${h.limit} (모둠 전체)</span></div>
      <div class="msg">${h.last ? `<b>${esc(h.last.who || '')}</b>님의 요청 → ${esc(h.last.text)}` : '<span class="muted">막히면 힌트를 눌러 보세요. 정답이 아니라 생각할 질문을 줄게요.</span>'}</div></div>`;

    // 기록
    const logHtml = v.log.length ? '<ul class="log">' + v.log.map(l => {
      if (l.kind === 'fail') return `<li class="fail">✗ ${E.TOOLS[l.tool] ? E.TOOLS[l.tool].name : ''} — ${esc(l.reason)} <span class="by">${esc(l.who)}</span></li>`;
      const s = l.step, outs = s.outIds.map(id => st.samples.find(x => x.id === id)).filter(Boolean);
      return `<li><span class="n">${s.n}단계</span> ${E.toolLabel(s)} <span class="tag">${s.propOk ? '✓' : '△'} ${E.PROPS[s.prop]}</span><br><span class="muted">→ ${outs.map(o => esc(o.label) + ': ' + esc(E.describe(o.comps))).join(' / ')}</span> <span class="by">${esc(s.who)}</span></li>`;
    }).join('') + '</ul>' : '<p class="muted">아직 실행한 단계가 없어요.</p>';

    root.innerHTML = `
      <div class="card"><h2><span class="num">1</span>${CFG.MIX_MODE === 'variant' ? '우리 모둠의 혼합물' : '분리할 혼합물을 골라요'}</h2>${mixes}
        <div class="row" style="margin-top:10px"><button class="btn small" data-act="undo" type="button" ${st.steps.length ? '' : 'disabled'}>↩ 한 단계 되돌리기</button><button class="btn small" data-act="reset" type="button">처음부터</button><span class="muted">혼합물을 바꾸면 모둠 모두의 화면이 처음부터 시작해요.</span></div></div>
      <div class="lab-grid"><div class="col">
        <div class="card"><h2><span class="num">2</span>시료 트레이 <span class="muted" style="font-weight:400">· 분리할 시료를 눌러 고르세요</span></h2><div class="tray">${tray}</div>${usedN ? `<p class="muted" style="margin-top:8px">사용을 마친 시료 ${usedN}개는 숨겼어요.</p>` : ''}</div>
        <div class="card"><h2><span class="num">3</span>도구와 이용할 특성을 골라 실행해요</h2>
          <div class="tools">${tools}</div>${help}
          ${tempChips}<p style="margin:12px 0 6px;font-weight:800">이 단계에서 이용하는 물질의 특성은?</p><div class="props-pick">${props}</div>
          <div class="runbar"><div class="sel-summary">${summary}</div><button class="btn primary" data-act="run" type="button" ${ready ? '' : 'disabled'}>▶ 실험 실행</button></div>
          ${banner}</div>
      </div><div class="col">${coach}
        <div class="card"><h2>📊 분리 현황</h2><div class="progress">${prog}</div>${verdict}</div>
        <div class="card"><h2>📒 실험 기록</h2>${logHtml}</div>
      </div></div>`;
  }

  $('#panelLab').addEventListener('click', e => {
    const b = e.target.closest('[data-act]'); if (!b || !S.view) return;
    const act = b.dataset.act, id = b.dataset.id;
    if (act === 'sample') { S.sel.sample = S.sel.sample === id ? '' : id; queueDraft(); renderLab(); }
    else if (act === 'tool') { S.sel.tool = S.sel.tool === id ? '' : id; queueDraft(); renderLab(); }
    else if (act === 'temp') { S.sel.temp = S.sel.temp === Number(id) ? 0 : Number(id); queueDraft(); renderLab(); }
    else if (act === 'prop') { S.sel.prop = S.sel.prop === id ? '' : id; queueDraft(); renderLab(); }
    else if (act === 'run') { if (S.sel.sample && S.sel.tool && S.sel.prop && (S.sel.tool !== 'cool' || S.sel.temp)) send({ type: 'run', tool: S.sel.tool, input: S.sel.sample, prop: S.sel.prop, temp: S.sel.tool === 'cool' ? S.sel.temp : undefined }); }
    else if (act === 'undo') send({ type: 'undo' });
    else if (act === 'reset') { if (confirm('모둠 전체의 실험을 처음부터 다시 시작할까요?')) { S.banner = null; send({ type: 'reset' }); } }
    else if (act === 'mix') { if (id !== S.view.mixId && (S.view.state.steps.length === 0 && CFG.MIX_MODE !== 'variant' || confirm('혼합물을 바꾸면 모둠 전체가 처음부터 시작해요. 바꿀까요?'))) { S.banner = null; send({ type: 'mixture', id }); } }
    else if (act === 'hint') send({ type: 'hint', key: S.view.key });
    else if (act === 'goframe') setTab('frame');
  });

  /* ---------- ③ 서술 정리 ---------- */
  let frameBuilt = false;
  const FRAME_FIELDS = [
    ['order', '1. 분리 순서', '어떤 순서로 분리했나요? (예: ① 자석 → ② …)'],
    ['prop', '2. 이용한 물질의 특성', '각 단계에서 어떤 특성의 차이를 이용했나요?'],
    ['tool', '3. 사용한 도구와 이유', '각 단계에서 어떤 도구를 왜 썼나요?'],
    ['result', '4. 분리되는 물질과 남는 물질', '각 단계에서 무엇이 분리되고 무엇이 남나요?'],
    ['check', '5. 분리 결과를 확인하는 방법', '분리가 잘 되었는지 어떻게 확인할 수 있을까요?']
  ];
  const CHECKS = ['각 단계에서 이용한 물질의 특성을 말할 수 있다.', '도구를 왜 그 순서로 썼는지 설명할 수 있다.', '분리되는 물질과 남는 물질을 구분해서 쓸 수 있다.', '다른 방법으로도 분리할 수 있는지 생각해 보았다.', '분리 결과를 확인하는 방법을 쓸 수 있다.'];
  function renderFrame() {
    const root = $('#panelFrame'), v = S.view;
    if (!frameBuilt) {
      frameBuilt = true;
      const chk = JSON.parse(store.get('ssl:chk') || '{}');
      root.innerHTML = `<div class="card frame"><h2><span class="num">3</span>서술형 답안 틀로 정리해요</h2>
        <p class="muted">다음 시간에는 <b>혼자서, 앱 없이</b> 실험을 설계해 서술해요. 아래 다섯 칸을 내 말로 쓸 수 있으면 준비 완료예요.</p>
        ${TYPE_NOTICE}
        <div class="row"><button class="btn small" id="fillDraft" type="button">내 설계로 초안 채우기</button><span class="muted">비어 있는 칸 1~4번만 채워 줘요. 모둠 모두에게 공유돼요.</span></div>
        ${FRAME_FIELDS.map(f => `<label><span>${f[1]}</span><textarea maxlength="1500" data-key="frame.${f[0]}" placeholder="${f[2]}"></textarea></label>`).join('')}</div>
        <div class="card"><h2>✅ 평가 대비 자기 점검 <span class="muted" style="font-weight:400">(내 기기에만 저장돼요)</span></h2><ul class="checklist">${CHECKS.map((c, i) => `<li><label><input type="checkbox" data-chk="${i}" ${chk[i] ? 'checked' : ''}>${c}</label></li>`).join('')}</ul></div>`;
    }
    FRAME_FIELDS.forEach(f => {
      const el = $(`textarea[data-key="frame.${f[0]}"]`, root), val = v.fields['frame.' + f[0]] || '';
      if (document.activeElement !== el && el.value !== val) el.value = val;
    });
  }

  (function bindFrame() {
    const root = $('#panelFrame'), timers = {};
    root.addEventListener('input', e => {
      const el = e.target.closest('textarea[data-key]'); if (!el) return;
      clearTimeout(timers[el.dataset.key]);
      timers[el.dataset.key] = setTimeout(() => send({ type: 'set', key: el.dataset.key, value: el.value }), 1200);
    });
    root.addEventListener('change', e => {
      const el = e.target.closest('textarea[data-key]');
      if (el) { clearTimeout(timers[el.dataset.key]); send({ type: 'set', key: el.dataset.key, value: el.value }); }
      const c = e.target.closest('[data-chk]');
      if (c) { const o = JSON.parse(store.get('ssl:chk') || '{}'); o[c.dataset.chk] = c.checked; store.set('ssl:chk', JSON.stringify(o)); }
    });
    root.addEventListener('click', e => {
      if (e.target.id !== 'fillDraft' || !S.view) return;
      if (!S.view.state.steps.length) { toast('먼저 ② 설계·실험에서 실험을 해 보세요.'); return; }
      const d = E.draftFrame(S.view);
      ['order', 'prop', 'tool', 'result'].forEach(k => { if (!(S.view.fields['frame.' + k] || '').trim()) send({ type: 'set', key: 'frame.' + k, value: d[k] }); });
    });
  })();

  /* ---------- ④ 공유 ---------- */
  // 입장한 반 번호(예: '2-3' → 3). 숫자를 못 찾으면 0
  const myClassNo = () => { const m = String(S.cls || '').split('-'); return Number(m[m.length - 1]) || 0; };
  const PRES = [
    ['a', '1. 발표 한 문장 요약 (모둠이 함께 써요)', '우리 모둠은 (   ) 혼합물을 (   ) 순서로 분리했고, 가장 중요한 특성은 (   )이다.']
  ];
  // 2·3번은 앱에 저장하지 않고 학생이 각자 공책·학습지에 쓰는 개인 활동
  const PERSONAL = [
    ['2. 다른 모둠 혼합물과 비교 (갤러리를 보고)', '섞여 있는 물질은 달랐지만 같았던 점, 우리 모둠과 달랐던 점은 무엇인가요?'],
    ['3. 혼합물이 달라도 변하지 않는 원리', '어떤 혼합물이든 분리할 때 가장 먼저 확인해야 하는 것은 무엇인가요? 그 이유도 써 보세요.']
  ];
  function buildPayload() {
    const v = S.view, st = v.state, ev = v.eval;
    const steps = st.steps.map(s => ({
      n: s.n, tool: E.toolLabel(s), prop: E.PROPS[s.prop], ok: s.propOk, warns: s.warns.length,
      outs: s.outIds.map(id => { const o = st.samples.find(x => x.id === id); return o.label + ': ' + E.describe(o.comps); })
    }));
    const sol = solveFor(v.mixId);
    const frame = {}; FRAME_FIELDS.forEach(f => { frame[f[0]] = v.fields['frame.' + f[0]] || ''; });
    const pres = {}; PRES.forEach(f => { pres[f[0]] = v.fields['pres.' + f[0]] || ''; });
    return {
      mixtureId: v.mixId, mixtureTitle: v.mix.title, mixComps: Array.from(new Set(v.mix.comps.map(c => E.SUBS[c.s].name))), groupName: S.roomLabel, cls: S.cls, steps, frame, pres, ai: aiSummary(v.fields),
      result: { done: ev.done, recovered: ev.recovered.map(s => E.SUBS[s].name), missing: ev.missing.map(s => E.SUBS[s].name), steps: ev.steps, minSteps: sol.minSteps, warnCount: ev.warnCount }
    };
  }

  function wrapText(ctx2, text, x, y, maxW, lh) {
    const words = String(text).split(''); let line = '', yy = y;
    for (const ch of words) {
      const t = line + ch;
      if (ctx2.measureText(t).width > maxW && line) { ctx2.fillText(line, x, yy); line = ch; yy += lh; } else line = t;
    }
    ctx2.fillText(line, x, yy);
    return yy + lh;
  }
  function drawCard(canvas, p) {
    const W = 1100, pad = 40, f = '"Pretendard","Noto Sans KR","Malgun Gothic","Apple SD Gothic Neo",sans-serif';
    const c = canvas.getContext('2d');
    if (!c.roundRect) c.roundRect = function (x, y, w, h) { this.rect(x, y, w, h); };
    // 높이 계산을 위해 먼저 측정
    function layout(draw) {
      let y = pad;
      c.fillStyle = '#f5f1e8'; if (draw) c.fillRect(0, 0, W, canvas.height);
      c.fillStyle = '#1d2b2f'; if (draw) c.fillRect(0, 0, W, 86);
      if (draw) { c.fillStyle = '#f5f1e8'; c.font = `800 34px ${f}`; c.fillText('혼합물 분리 설계 완성본', pad, 56); c.font = `600 20px ${f}`; c.textAlign = 'right'; c.fillText(`${p.cls} · ${p.groupName}`, W - pad, 54); c.textAlign = 'left'; }
      y = 86 + 36;
      if (draw) { c.fillStyle = '#0b5a54'; c.font = `800 26px ${f}`; c.fillText('혼합물: ' + p.mixtureTitle + (p.mixComps ? '  (' + p.mixComps.join(' + ') + ')' : ''), pad, y); }
      y += 22;
      p.steps.forEach(s => {
        const top = y; c.font = `500 20px ${f}`;
        const lines = [];
        s.outs.forEach(o => lines.push(o));
        const h = 56 + lines.length * 28 + 10;
        if (draw) {
          c.fillStyle = '#fffdf8'; c.strokeStyle = '#1d2b2f'; c.lineWidth = 2.5; c.beginPath(); c.roundRect(pad, top, W - pad * 2, h, 14); c.fill(); c.stroke();
          c.fillStyle = '#0f766e'; c.beginPath(); c.arc(pad + 28, top + 30, 18, 0, 7); c.fill();
          c.fillStyle = '#fff'; c.font = `800 20px ${f}`; c.textAlign = 'center'; c.fillText(String(s.n), pad + 28, top + 37); c.textAlign = 'left';
          c.fillStyle = '#1d2b2f'; c.font = `800 24px ${f}`; c.fillText(s.tool, pad + 60, top + 38); const tw = c.measureText(s.tool).width;
          c.fillStyle = '#0b5a54'; c.font = `600 20px ${f}`; c.fillText('이용한 특성: ' + s.prop + ' 차이', pad + 60 + Math.max(240, tw + 30), top + 37);
          c.fillStyle = '#1d2b2f'; c.font = `500 20px ${f}`;
          lines.forEach((l, i) => c.fillText('→ ' + l, pad + 30, top + 74 + i * 28));
        }
        y += h + 14;
      });
      if (!p.steps.length) { if (draw) { c.fillStyle = '#52646a'; c.font = `500 22px ${f}`; c.fillText('아직 실행한 단계가 없어요.', pad, y + 20); } y += 50; }
      // 결과
      const r = p.result, aiS = p.ai || { n: 0, diff: 0 }, boxH = aiS.n ? 114 : 84;
      if (draw) {
        c.fillStyle = r.done ? '#dcf3e2' : '#fdecc8'; c.strokeStyle = '#1d2b2f'; c.beginPath(); c.roundRect(pad, y, W - pad * 2, boxH, 14); c.fill(); c.stroke();
        c.fillStyle = '#1d2b2f'; c.font = `800 24px ${f}`;
        c.fillText(r.done ? `분리 성공! (${r.steps}단계 · 가장 짧은 경로 ${r.minSteps}단계)` : `분리 진행 중 · 아직 얻지 못한 물질: ${r.missing.join(', ')}`, pad + 20, y + 36);
        c.font = `500 20px ${f}`; c.fillText('얻은 물질: ' + (r.recovered.join(', ') || '없음') + (r.warnCount ? `   ·   안전·안정성 주의 ${r.warnCount}번` : ''), pad + 20, y + 68);
        if (aiS.n) { c.fillStyle = '#0b5a54'; c.font = `700 20px ${f}`; c.fillText(`🤖 AI 답변 검증 ${aiS.n}건 · 교과서와 다른 값을 찾은 것 ${aiS.diff}건`, pad + 20, y + 100); }
      }
      y += boxH + 24;
      // 서술
      const fr = Object.assign({}, p.frame, { 'pres.a': (p.pres || {}).a });
      [['order', '분리 순서'], ['prop', '이용한 특성'], ['result', '분리·남는 물질'], ['check', '확인 방법'], ['pres.a', '발표 요약']].forEach(([k, label]) => {
        if (!fr[k] || !fr[k].trim()) return;
        if (draw) { c.fillStyle = '#0b5a54'; c.font = `800 20px ${f}`; c.fillText(label, pad, y); }
        y += 8; c.font = `500 19px ${f}`;
        fr[k].split('\n').forEach(line => { y = wrapText(c, line, pad + 4, y + 20, W - pad * 2 - 8, 27); });
        y += 10;
      });
      y += 10;
      if (draw) { c.fillStyle = '#52646a'; c.font = `500 16px ${f}`; c.textAlign = 'center'; c.fillText('©수민T의 과학 실험실. All rights reserved.', W / 2, y + 6); c.textAlign = 'left'; }
      return y + 34;
    }
    canvas.width = W; canvas.height = 2000; c.textBaseline = 'alphabetic';
    const h = layout(false);
    canvas.height = h; canvas.width = W; c.textBaseline = 'alphabetic';
    layout(true);
  }

  function renderShareCard() {
    const root = $('#panelShare');
    if (!$('#shareCanvas', root)) {
      root.innerHTML = `<div class="card"><h2><span class="num">4</span>완성본 공유하기</h2>
        <p class="muted">설계가 끝나면 아래 카드를 <b>패들렛</b>에 올려 다른 모둠과 나누거나, <b>갤러리</b>에 올려 댓글을 주고받아요.</p>
        <div class="card pres" style="margin:0 0 12px;box-shadow:none"><h2>🎤 발표 준비</h2>
          <p class="muted">모둠마다 혼합물이 달라요. 발표에서는 <b>무엇이 달랐고, 무엇이 같았는지</b>가 중요해요. 1번만 모둠이 함께 쓰고, 2·3번은 <b>각자</b> 써요.</p>
          ${TYPE_NOTICE}
          ${PRES.map(f => `<label class="field frame"><span>${f[1]}</span><textarea maxlength="600" rows="2" data-pres="${f[0]}" placeholder="${f[2]}" style="width:100%;border:2px solid var(--ink);border-radius:10px;padding:10px 12px;background:#fff"></textarea></label>`).join('')}
          ${PERSONAL.map(f => `<div class="personal"><b>${f[0]} <span class="tag">개인 활동</span></b><p>${f[1]}</p></div>`).join('')}
          <p class="notice personalnote">✏ <b>2·3번은 이 화면에 쓰지 않아요.</b> 갤러리의 비교표와 다른 모둠의 카드를 보고, <b>내 공책이나 학습지에 내 말로 각자</b> 써요. 모둠 친구와 의견을 나눠도 좋지만 글은 자기 생각으로 써요.</p></div>
        <canvas id="shareCanvas" class="share-preview" aria-label="공유용 완성본 카드 미리보기"></canvas>
        <div class="row" style="margin-top:10px">
          <button class="btn primary" id="shCopy" type="button">🖼 이미지 복사</button>
          <button class="btn" id="shSave" type="button">⬇ 이미지 저장</button>
          <button class="btn" id="shText" type="button">📋 글로 복사</button>
          </div>
        <div class="padlets"><b>패들렛 열기</b> <span class="muted">(우리 반 패들렛에 카드를 올려요)</span>
          <div class="row" style="margin-top:6px">${[1, 2, 3, 4, 5, 6].map(n => `<button class="btn padbtn ${myClassNo() === n ? 'primary' : ''}" data-pad="${n}" type="button">${n}반(패들렛)</button>`).join('')}</div></div>
        <p class="muted" style="margin-top:6px">패들렛에서는 <b>＋</b> 게시물을 만든 뒤 복사한 이미지를 붙여넣거나(Ctrl+V), 저장한 이미지를 끌어다 놓으세요.</p></div>
        <div class="card"><h2>🖼 우리 반 갤러리</h2>
        <div class="row"><button class="btn primary" id="gPub" type="button">갤러리에 올리기(다시 올리면 덮어써요)</button><button class="btn" id="gRef" type="button">새로고침</button><span class="muted" id="gMsg"></span></div>
        <div class="gallery" id="gList"></div></div>`;
      $('#shCopy').onclick = copyImage; $('#shSave').onclick = saveImage; $('#shText').onclick = copyText;
      root.addEventListener('click', e => {
        const b = e.target.closest('[data-pad]'); if (!b) return;
        const n = b.dataset.pad, url = (CFG.PADLET_URLS || {})[n] || CFG.PADLET_URL;
        if (!url) { toast(n + '반 패들렛 주소가 아직 등록되지 않았어요. 선생님께 알려 주세요.'); return; }
        window.open(url, '_blank', 'noopener');
      });
      $('#gPub').onclick = publish; $('#gRef').onclick = refreshShare;
      const pt = {};
      root.addEventListener('input', e => { const el = e.target.closest('[data-pres]'); if (!el) return; clearTimeout(pt[el.dataset.pres]); pt[el.dataset.pres] = setTimeout(() => send({ type: 'set', key: 'pres.' + el.dataset.pres, value: el.value }), 1000); });
      root.addEventListener('change', e => { const el = e.target.closest('[data-pres]'); if (el) { clearTimeout(pt[el.dataset.pres]); send({ type: 'set', key: 'pres.' + el.dataset.pres, value: el.value }); } });
    }
    PRES.forEach(f => { const el = $(`[data-pres="${f[0]}"]`, root), val = S.view.fields['pres.' + f[0]] || ''; if (el && document.activeElement !== el && el.value !== val) el.value = val; });
    drawCard($('#shareCanvas'), buildPayload());
  }
  const canvasBlob = () => new Promise(res => $('#shareCanvas').toBlob(res, 'image/png'));
  async function copyImage() {
    try {
      const blob = await canvasBlob();
      await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]);
      toast('이미지를 복사했어요. 패들렛에서 붙여넣기(Ctrl+V) 하세요.');
    } catch (e) { toast('이 기기에서는 이미지 복사가 안 돼요. 대신 저장한 뒤 올려 주세요.'); saveImage(); }
  }
  async function saveImage() {
    const blob = await canvasBlob(), a = document.createElement('a');
    a.href = URL.createObjectURL(blob); a.download = `혼합물분리설계_${S.cls}_${S.roomLabel}.png`;
    document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  }
  async function copyText() {
    const p = buildPayload();
    const t = [`[혼합물 분리 설계] ${p.cls} ${p.groupName} · ${p.mixtureTitle}`, ...p.steps.map(s => `${s.n}) ${s.tool} - ${s.prop} 차이\n   ${s.outs.join('\n   ')}`),
      p.result.done ? `결과: 분리 성공 (${p.result.steps}단계)` : `결과: 진행 중 (미분리: ${p.result.missing.join(', ')})`,
      ...(p.ai && p.ai.n ? [`AI 답변 검증 ${p.ai.n}건 (교과서와 다른 값 ${p.ai.diff}건)`] : []),
      ...FRAME_FIELDS.filter(f => p.frame[f[0]]).map(f => `${f[1]}\n${p.frame[f[0]]}`)].join('\n');
    try { await navigator.clipboard.writeText(t); toast('글로 복사했어요. 패들렛에 붙여넣으세요.'); } catch (e) { toast('복사하지 못했어요.'); }
  }

  async function publish() {
    if (!S.view.state.steps.length) { toast('먼저 실험을 해 보세요.'); return; }
    try {
      const r = await S.net.publish(ctx(), buildPayload());
      if (r && r.ok === false) throw new Error(r.error);
      toast('갤러리에 올렸어요!'); refreshShare();
    } catch (e) { toast('올리지 못했어요. 잠시 후 다시 해 주세요.'); }
  }
  async function refreshShare() {
    renderShareCard();
    try {
      const r = await S.net.gallery(S.cls);
      S.gallery = (r && r.items) || [];
      $('#gMsg').textContent = S.gallery.length ? '' : '아직 올라온 설계가 없어요.';
      renderGallery();
    } catch (e) { $('#gMsg').textContent = '갤러리를 불러오지 못했어요.'; }
  }
  function renderGallery() {
    const items = (S.gallery || []).slice().sort((a, b) => (a.room === S.room ? -1 : b.room === S.room ? 1 : b.ts - a.ts));
    const keyProps = p => Array.from(new Set((p.steps || []).map(s => s.prop))).join(', ');
    const cmp = items.length >= 2 ? `<div class="table-wrap" style="margin-bottom:12px"><table class="props cmp"><thead><tr><th>모둠</th><th>섞여 있던 물질</th><th>분리 순서</th><th>이용한 특성</th></tr></thead><tbody>${items.map(it => { const p = it.payload || {}; return `<tr><td class="name">${esc(it.groupName)}</td><td>${esc((p.mixComps || [p.mixtureTitle || '']).join(' + '))}</td><td>${esc((p.steps || []).map(s => s.tool).join(' → '))}</td><td>${esc(keyProps(p))}</td></tr>`; }).join('')}</tbody></table></div>` : '';
    $('#gList').innerHTML = cmp + items.map(it => {
      const p = it.payload || {}, r = p.result || {};
      const flow = (p.steps || []).map(s => `<span class="st">${esc(s.tool)}</span>`).join('<span class="ar">→</span>');
      const cm = (it.comments || []).map(c => `<div class="cmt"><span class="k ${c.kind === '잘한점' ? 'good' : 'fix'}">${c.kind === '잘한점' ? '👍 잘한 점' : '🔧 보완할 점'}</span> · ${esc(c.from)}<br>${esc(c.text)}</div>`).join('');
      const own = it.room === S.room;
      return `<article class="gcard"><h3>${esc(it.groupName)} · ${esc(p.mixtureTitle || '')}</h3>
        <div class="flow">${flow || '<span class="muted">단계 없음</span>'}</div>
        <div class="muted">${r.done ? '분리 성공 · ' : '진행 중 · '}${r.steps || 0}단계${r.warnCount ? ' · 주의 ' + r.warnCount + '번' : ''}${p.ai && p.ai.n ? ' · 🤖 AI 검증 ' + p.ai.n + '건(다른 값 ' + p.ai.diff + '건)' : ''}</div>
        ${(p.steps || []).map(s => `<div class="muted">${s.n}) ${esc(s.prop)} 차이 → ${esc((s.outs || []).join(' / '))}</div>`).join('')}
        ${p.frame && p.frame.check ? `<div class="muted" style="margin-top:6px"><b>확인 방법:</b> ${esc(p.frame.check)}</div>` : ''}
        <div style="margin-top:8px">${cm || '<span class="muted">아직 댓글이 없어요.</span>'}</div>
        ${own ? '<div class="muted">우리 모둠의 설계예요.</div>' : `<form class="row" data-target="${esc(it.room)}" style="margin-top:6px">
          <select aria-label="댓글 종류"><option value="잘한점">👍 잘한 점</option><option value="보완">🔧 보완할 점</option></select>
          <input type="text" maxlength="100" placeholder="댓글(100자)" style="flex:1 1 140px;min-height:40px;border:2px solid var(--ink);border-radius:8px;padding:4px 8px" aria-label="댓글 내용">
          <button class="btn small" type="submit">등록</button></form>`}</article>`;
    }).join('');
  }
  document.addEventListener('submit', async e => {
    const f = e.target.closest('form[data-target]'); if (!f) return;
    e.preventDefault();
    const text = $('input', f).value.trim(); if (!text) return;
    try {
      await S.net.comment(ctx(), f.dataset.target, S.name + '(' + S.roomLabel + ')', $('select', f).value, text);
      toast('댓글을 남겼어요.'); refreshShare();
    } catch (er) { toast('댓글을 남기지 못했어요.'); }
  });

  /* ---------- 교사용 ---------- */
  let tTimer = null;
  function buildTeacher() {
    showScreen('teacher');
    $('#tCls').value = store.get('ssl:tcls') || '';
    const go = async () => {
      const cls = keyOf($('#tCls').value); if (!cls) return;
      store.set('ssl:tcls', $('#tCls').value.trim());
      const net = CFG.BACKEND_URL ? new RemoteNet(CFG.BACKEND_URL) : new LocalNet();
      const load = async () => {
        try {
          const r = await net.overview(cls);
          const rooms = (r.rooms || []).sort((a, b) => a.room.localeCompare(b.room, 'ko', { numeric: true }));
          $('#tInfo').textContent = rooms.length + '개 모둠 · ' + new Date().toLocaleTimeString('ko-KR');
          const tbl = rooms.length ? `<div class="table-wrap" style="grid-column:1/-1"><table class="props cmp"><thead><tr><th>모둠</th><th>혼합물</th><th>분리 순서</th><th>이용한 특성</th><th>상태</th></tr></thead><tbody>${rooms.map(rm => { const v = E.replay(rm.events, { hintLimit: CFG.HINT_LIMIT }); return `<tr><td class="name">${esc(rm.room)}</td><td>${esc(Array.from(new Set(v.mix.comps.map(c => E.SUBS[c.s].name))).join(' + '))}</td><td>${esc(v.state.steps.map(s => E.toolLabel(s)).join(' → ') || '-')}</td><td>${esc(Array.from(new Set(v.state.steps.map(s => E.PROPS[s.prop]))).join(', ') || '-')}</td><td>${v.eval.done ? '✅' : '⏳'}</td></tr>`; }).join('')}</tbody></table></div>` : '';
          $('#tGrid').innerHTML = tbl + rooms.map(rm => {
            const v = E.replay(rm.events, { hintLimit: CFG.HINT_LIMIT }), ev = v.eval;
            const path = v.state.steps.map(s => E.toolLabel(s)).join(' → ') || '아직 시작 전';
            const last = rm.events.length ? Math.max.apply(null, rm.events.map(e => e.ts || 0)) : 0;
            const ago = last ? Math.max(0, Math.round((Date.now() - last) / 60000)) + '분 전' : '-';
            return `<div class="tcard"><b>${esc(rm.room)}</b> <span class="tag">${v.mix.level} ${esc(v.mix.title)}</span>
              <div class="progress">${ev.need.map(s => `<span class="prog ${ev.recovered.includes(s) ? 'ok' : ''}">${ev.recovered.includes(s) ? '✓ ' : ''}${E.SUBS[s].name}</span>`).join('')}</div>
              <div style="margin:6px 0">${esc(path)}</div>
              <div class="kv">단계 ${ev.steps} · 실패 ${v.stats.fails} · 되돌리기 ${v.stats.undos} · 힌트 ${v.hints.used}/${v.hints.limit} · 특성 선택 오류 ${ev.badProp} · 주의 ${ev.warnCount}</div>
              ${(() => { const a = aiSummary(v.fields); return `<div class="kv">🤖 AI 답변 검증 ${a.n}건 · 다른 값 발견 ${a.diff}건</div>` + a.items.slice(0, 2).map(r => `<div class="kv">· ${esc(r.sub)} ${esc(r.field)}: AI '${esc(r.ai)}' ↔ 자료 '${esc(r.ref)}'</div>`).join(''); })()}
              <div class="kv">접속: ${(rm.presence || []).map(p => esc(p.name) + (p.role ? '(' + esc(p.role) + ')' : '')).join(', ') || '없음'} · 마지막 활동 ${ago}</div>
              <div class="kv">${ev.done ? '✅ 분리 완료' : '⏳ 진행 중'}</div></div>`;
          }).join('') || '<p class="muted">아직 입장한 모둠이 없어요.</p>';
        } catch (e) { $('#tInfo').textContent = '불러오지 못했어요.'; }
      };
      clearInterval(tTimer); await load(); tTimer = setInterval(load, 8000);
    };
    $('#tGo').onclick = go;
    if ($('#tCls').value) go();
  }

  /* ---------- 시작 ---------- */
  window.__SSL = { S, E, send, pollOnce };   // 점검용
  if (new URLSearchParams(location.search).get('teacher')) buildTeacher();
  else { showScreen('join'); buildJoin(); }
})();
