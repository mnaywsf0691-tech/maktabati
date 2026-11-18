(function () {
  'use strict';

  const STORAGE_KEY = 'maktabati_state_v1';
  const DB_NAME = 'maktabati_db_v1';
  const DB_STORE = 'files';

  const DEFAULT_CATEGORIES = ['الطب', 'الفلسفة', 'العلوم', 'التاريخ', 'الأدب', 'الدين', 'التقنية', 'التنمية الذاتية', 'أخرى'];
  const CATEGORY_KEYWORDS = {
    'الطب': ['طب', 'medical', 'medicine', 'health', 'صحة', 'تشريح', 'دواء', 'تمريض', 'nursing', 'anatomy', 'pharma', 'surgery', 'clinic'],
    'الفلسفة': ['فلسفة', 'philosophy', 'منطق', 'logic', 'ميتافيزيق', 'وجود', 'ethics', 'أخلاق'],
    'العلوم': ['علم', 'science', 'physics', 'فيزياء', 'كيمياء', 'chemistry', 'biology', 'أحياء', 'رياضيات', 'math', 'space', 'فضاء'],
    'التاريخ': ['تاريخ', 'history', 'حضارة', 'civilization', 'سيرة', 'chronicle', 'war', 'حرب'],
    'الأدب': ['أدب', 'literature', 'رواية', 'novel', 'شعر', 'poetry', 'قصة', 'story', 'نقد'],
    'الدين': ['دين', 'قرآن', 'quran', 'islam', 'إسلام', 'فقه', 'حديث', 'تفسير', 'عقيدة', 'bible', 'torah'],
    'التقنية': ['برمجة', 'programming', 'code', 'computer', 'حاسوب', 'software', 'تقنية', 'tech', 'ai', 'ذكاء', 'شبكات', 'network', 'data', 'javascript', 'python'],
    'التنمية الذاتية': ['تنمية', 'self', 'success', 'نجاح', 'عادات', 'habits', 'productivity', 'إنتاجية', 'leadership', 'إدارة الوقت', 'time']
  };

  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));
  const uid = () => 'b_' + Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;','\'':'&#39;'}[c]));
  const fmtSize = (n) => {
    if (!n && n !== 0) return '—';
    const u = ['B','KB','MB','GB']; let i=0, x=Number(n)||0;
    while (x>=1024 && i<u.length-1){x/=1024;i++;} return (i?x.toFixed(1):x)+' '+u[i];
  };

  let state = loadState();
  let currentBookId = null;
  let timer = { total: 25*60, left: 25*60, running: false, handle: null };
  let dbp = null;

  function loadState() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) {
        const s = JSON.parse(raw);
        s.books = s.books || [];
        s.categories = s.categories || DEFAULT_CATEGORIES.slice();
        s.plans = s.plans || [];
        s.notes = s.notes || {}; // bookId -> {notes, highlights[], contentOverride}
        return s;
      }
    } catch(e) {}
    return { books: [], categories: DEFAULT_CATEGORIES.slice(), plans: [], notes: {} };
  }
  function saveState() { localStorage.setItem(STORAGE_KEY, JSON.stringify(state)); }

  function openDB() {
    if (dbp) return dbp;
    dbp = new Promise((resolve) => {
      if (!('indexedDB' in window)) return resolve(null);
      const req = indexedDB.open(DB_NAME, 1);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains(DB_STORE)) db.createObjectStore(DB_STORE);
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => resolve(null);
    });
    return dbp;
  }
  async function dbPut(key, val) {
    const db = await openDB(); if (!db) return;
    return new Promise(res => { const tx=db.transaction(DB_STORE,'readwrite'); tx.objectStore(DB_STORE).put(val,key); tx.oncomplete=()=>res(true); tx.onerror=()=>res(false); });
  }
  async function dbGet(key) {
    const db = await openDB(); if (!db) return null;
    return new Promise(res => { const tx=db.transaction(DB_STORE,'readonly'); const r=tx.objectStore(DB_STORE).get(key); r.onsuccess=()=>res(r.result); r.onerror=()=>res(null); });
  }
  async function dbDel(key) {
    const db = await openDB(); if (!db) return;
    return new Promise(res => { const tx=db.transaction(DB_STORE,'readwrite'); tx.objectStore(DB_STORE).delete(key); tx.oncomplete=()=>res(true); tx.onerror=()=>res(false); });
  }

  function toast(msg) {
    const t = $('#toast');
    t.textContent = msg; t.classList.remove('hidden'); t.classList.add('show');
    clearTimeout(toast._h); toast._h = setTimeout(()=>{t.classList.add('hidden'); t.classList.remove('show');}, 2600);
  }

  // Merge auto-scanned library
  function mergeAutoLibrary() {
    const auto = Array.isArray(window.AUTO_LIBRARY) ? window.AUTO_LIBRARY : [];
    if (!auto.length) return;
    const known = new Set(state.books.map(b => (b.path || '').toLowerCase()).filter(Boolean));
    let added = 0;
    for (const it of auto) {
      const p = (it.path || '').toLowerCase();
      if (!p || known.has(p)) continue;
      state.books.push({
        id: it.id || uid(), title: it.title || 'بدون عنوان', path: it.path || '', ext: (it.ext||'').toLowerCase(),
        size: it.size || 0, modified: it.modified || '', source: 'auto', category: it.category || '', addedAt: it.addedAt || new Date().toISOString()
      });
      known.add(p); added++;
    }
    if (added) saveState();
  }

  function getBook(id){ return state.books.find(b=>b.id===id); }
  function ensureNote(id){ if(!state.notes[id]) state.notes[id]={notes:'', highlights:[], contentOverride:null, textContent:null}; return state.notes[id]; }

  function colorFor(str) {
    const colors = ['#7a4a2a','#1f5e46','#6b2c39','#2e4f86','#5a3b7a','#3f6a52','#7a5a1f','#3b5f6b','#6a3f5e','#2f6b6b'];
    let h=0; const s=String(str||''); for(let i=0;i<s.length;i++) h=(h*31+s.charCodeAt(i))>>>0;
    return colors[h % colors.length];
  }

  // Navigation
  function showView(name) {
    $$('.nav-item').forEach(b=>b.classList.toggle('active', b.dataset.view===name));
    $$('.view').forEach(v=>v.classList.toggle('active', v.id==='view-'+name));
    const titles = {library:['المكتبة','رفوف كتبك في مكان واحد'], categories:['الأقسام','تنظيم الكتب ضمن أقسام وفئات'], planner:['منظم الدراسة','تقسيم الوقت والكميات لسهولة الدراسة'], assistant:['المساعد الذكي','تحليل ذكي وتحسين دقة التنظيم'], settings:['الإعدادات','إدارة البيانات والفحص']};
    const t=titles[name]||['مكتبتي',''];
    $('#viewTitle').textContent=t[0]; $('#viewSubtitle').textContent=t[1];
    if (name==='library') renderLibrary();
    if (name==='categories') renderCategories();
    if (name==='planner') renderPlans();
    if (name==='assistant') renderAssistant();
    if (name==='settings') renderSettings();
  }

  // Library rendering
  function filteredBooks() {
    const q = ($('#searchInput').value||'').trim().toLowerCase();
    const cat = $('#categoryFilter').value;
    const sort = $('#sortSelect').value;
    let arr = state.books.slice();
    if (q) arr = arr.filter(b => (b.title||'').toLowerCase().includes(q));
    if (cat) arr = arr.filter(b => (b.category||'') === cat);
    if (sort==='title') arr.sort((a,b)=>(a.title||'').localeCompare(b.title||'', 'ar'));
    else if (sort==='recent') arr.sort((a,b)=> (b.addedAt||b.modified||'').localeCompare(a.addedAt||a.modified||''));
    else if (sort==='category') arr.sort((a,b)=>(a.category||'').localeCompare(b.category||'', 'ar') || (a.title||'').localeCompare(b.title||'', 'ar'));
    else if (sort==='size') arr.sort((a,b)=>(b.size||0)-(a.size||0));
    return arr;
  }

  function renderLibrary() {
    updateStats();
    const books = filteredBooks();
    const container = $('#shelvesContainer');
    container.innerHTML = '';
    const byCat = new Map();
    for (const b of books) {
      const c = b.category || 'بدون قسم';
      if (!byCat.has(c)) byCat.set(c, []);
      byCat.get(c).push(b);
    }
    // keep category order: known categories then others
    const cats = [];
    for (const c of state.categories) if (byCat.has(c)) cats.push(c);
    for (const c of byCat.keys()) if (!cats.includes(c)) cats.push(c);

    $('#libraryStats').textContent = `إجمالي الكتب: ${state.books.length} | المعروضة: ${books.length}`;

    if (state.books.length === 0) {
      container.innerHTML = `
        <div class="shelf-section">
          <div class="shelf-header"><div class="shelf-title">رفوف المكتبة</div><div class="shelf-count">فارغة</div></div>
          <div class="shelf-row empty"><div class="empty-state"><div class="big">📚</div><div>مكتبتك فارغة حاليًا. أضف كتبًا أو استورد مجلدًا لتظهر هنا على الرفوف.</div></div></div>
          <div class="shelf-plank"></div>
          <div class="shelf-row empty"><div class="empty-state">رف إضافي جاهز لاستقبال كتبك القادمة</div></div>
          <div class="shelf-plank"></div>
        </div>`;
      return;
    }

    if (cats.length === 0) {
      container.innerHTML = `<div class="empty-state"><div class="big">🔎</div><div>لا توجد نتائج مطابقة للبحث أو التصفية.</div></div>`;
      return;
    }

    for (const cat of cats) {
      const list = byCat.get(cat) || [];
      const sec = document.createElement('div');
      sec.className = 'shelf-section';
      sec.innerHTML = `<div class="shelf-header"><div class="shelf-title">${esc(cat)}</div><div class="shelf-count">${list.length} كتاب</div></div>`;
      // chunk into shelves of ~14 for visual rows
      const chunkSize = 14;
      for (let i=0; i<list.length; i+=chunkSize) {
        const chunk = list.slice(i,i+chunkSize);
        const row = document.createElement('div'); row.className='shelf-row';
        chunk.forEach(b => row.appendChild(renderBookSpine(b)));
        sec.appendChild(row);
        const plank = document.createElement('div'); plank.className='shelf-plank'; sec.appendChild(plank);
      }
      container.appendChild(sec);
    }
  }

  function renderBookSpine(book) {
    const d = document.createElement('div');
    d.className = 'book';
    const c1 = colorFor(book.title), c2 = colorFor(book.title + '_2');
    d.style.background = `linear-gradient(180deg, ${c1}, ${c2})`;
    const h = 150 + (hashNum(book.title) % 30);
    d.style.height = h + 'px';
    d.title = book.title;
    d.innerHTML = `<span class="badge">${esc((book.ext||'').toUpperCase() || 'كتاب')}</span><span class="book-spine">${esc(book.title)}</span>`;
    d.addEventListener('click', () => openBook(book.id));
    return d;
  }
  function hashNum(s){ let h=0; s=String(s||''); for(let i=0;i<s.length;i++) h=(h*33+s.charCodeAt(i))|0; return Math.abs(h); }

  function updateStats() {
    const total = state.books.length;
    const cats = new Set(state.books.map(b=>b.category||'بدون قسم')).size;
    const plans = state.plans.length;
    $('#statsMini').innerHTML = `الكتب: <b>${total}</b><br>الأقسام المستخدمة: <b>${cats}</b><br>الخطط الدراسية: <b>${plans}</b>`;
    // category filter options
    const sel = $('#categoryFilter'); const cur = sel.value;
    sel.innerHTML = '<option value="">كل الأقسام</option>' + state.categories.map(c=>`<option value="${esc(c)}">${esc(c)}</option>`).join('') + '<option value="بدون قسم">بدون قسم</option>';
    if ([...sel.options].some(o=>o.value===cur)) sel.value = cur;
  }

  // Import
  async function importFiles(fileList, fromFolder=false) {
    const files = Array.from(fileList||[]);
    if (!files.length) return;
    let added=0, textRead=0;
    for (const f of files) {
      const ext = (f.name.split('.').pop()||'').toLowerCase();
      if (!ext) continue;
      const title = f.name.replace(/\.[^.]+$/, '');
      // avoid duplicates by name+size for manual import
      if (state.books.some(b=>b.source==='manual' && b.title===title && b.size===f.size)) continue;
      const id = uid();
      const book = { id, title, path:'', ext, size:f.size, modified: new Date(f.lastModified||Date.now()).toISOString(), source:'manual', category:'', addedAt:new Date().toISOString(), fileName:f.name, hasBlob:true };
      state.books.push(book);
      // store content: text for text-like, dataURL for others (best effort)
      const note = ensureNote(id);
      try {
        if (['txt','md','csv','html','htm','json','xml','rtf'].includes(ext)) {
          const text = await readFileAsText(f);
          note.textContent = text; textRead++;
        } else {
          // store blob/data for pdf/epub/etc if reasonably small (< 25MB)
          if (f.size <= 25*1024*1024) {
            const dataUrl = await readFileAsDataURL(f);
            await dbPut('file:'+id, {dataUrl, type: f.type||'', name: f.name});
          } else {
            book.hasBlob = false;
          }
        }
      } catch(e) { /* ignore per-file */ }
      added++;
    }
    saveState(); renderLibrary();
    toast(`تمت إضافة ${added} عنصر${fromFolder?' من المجلد':''}.`);
  }
  function readFileAsText(f){ return new Promise((res,rej)=>{const r=new FileReader(); r.onload=()=>res(String(r.result||'')); r.onerror=rej; r.readAsText(f);}); }
  function readFileAsDataURL(f){ return new Promise((res,rej)=>{const r=new FileReader(); r.onload=()=>res(String(r.result||'')); r.onerror=rej; r.readAsDataURL(f);}); }

  // Book modal & reader
  async function openBook(id) {
    const b = getBook(id); if(!b) return;
    currentBookId = id;
    $('#modalBookTitle').textContent = b.title;
    const note = ensureNote(id);
    $('#bookNotes').value = note.notes || '';
    $('#highlightText').value = '';
    renderHighlights(id);
    renderBookMeta(b);
    populateModalCategory(b);
    $('#editContentBtn').classList.remove('hidden');
    $('#saveContentBtn').classList.add('hidden');
    $('#cancelEditBtn').classList.add('hidden');
    await renderReader(b);
    $('#bookModal').classList.remove('hidden');
  }
  function closeModal(){ $('#bookModal').classList.add('hidden'); currentBookId=null; }

  function renderBookMeta(b) {
    const pathLine = b.path ? `<div class="meta-row"><b>المسار:</b> <span style="direction:ltr;unicode-bidi:embed">${esc(b.path)}</span></div>` : '';
    $('#modalBookMeta').innerHTML = `
      <div class="meta-row"><b>النوع:</b> ${esc((b.ext||'').toUpperCase()||'—')}</div>
      <div class="meta-row"><b>الحجم:</b> ${esc(fmtSize(b.size))}</div>
      <div class="meta-row"><b>القسم:</b> ${esc(b.category||'بدون قسم')}</div>
      <div class="meta-row"><b>المصدر:</b> ${b.source==='auto'?'تم اكتشافه تلقائيًا':'مضاف يدويًا'}</div>
      ${pathLine}
    `;
  }
  function populateModalCategory(b) {
    const sel = $('#modalCategorySelect');
    sel.innerHTML = `<option value="">بدون قسم</option>` + state.categories.map(c=>`<option value="${esc(c)}">${esc(c)}</option>`).join('');
    sel.value = b.category || '';
  }

  async function renderReader(b) {
    const area = $('#readerArea');
    const hint = $('#readerHint');
    area.innerHTML = '';
    const note = ensureNote(b.id);
    const ext = (b.ext||'').toLowerCase();

    // editable text content if available
    const text = (note.contentOverride != null ? note.contentOverride : note.textContent);
    if (text != null) {
      hint.textContent = 'محتوى نصي: يمكنك التمييز بالهايلايتر أو تعديل المحتوى وحفظه.';
      area.innerHTML = `<div class="reader-text" id="readerText"></div>`;
      renderTextWithHighlights(text, note.highlights||[]);
      return;
    }

    // stored blob/dataUrl (pdf/images etc.)
    const stored = await dbGet('file:'+b.id);
    if (stored && stored.dataUrl) {
      if (ext === 'pdf' || (stored.type||'').includes('pdf')) {
        hint.textContent = 'عرض PDF مضمّن. يمكن إضافة الملاحظات والتمييزات في اللوحة الجانبية.';
        area.innerHTML = `<embed src="${stored.dataUrl}" type="application/pdf" />`;
        return;
      }
      if (['png','jpg','jpeg','gif','webp','bmp','svg'].includes(ext) || (stored.type||'').startsWith('image/')) {
        hint.textContent = 'عرض صورة.';
        area.innerHTML = `<div style="text-align:center"><img src="${stored.dataUrl}" alt="" style="max-width:100%;border-radius:8px"/></div>`;
        return;
      }
      if (['html','htm'].includes(ext)) {
        hint.textContent = 'عرض ملف HTML (معزول).';
        area.innerHTML = `<iframe sandbox src="${stored.dataUrl}"></iframe>`;
        return;
      }
      hint.textContent = 'تم حفظ الملف داخل المكتبة. يمكن فتحه عبر النظام إذا لزم.';
      area.innerHTML = `<div class="empty-state"><div class="big">📄</div><div>هذا النوع (${esc(ext)}) محفوظ في المكتبة. استخدم "فتح في النظام" للعرض الكامل إن توفر.</div></div>`;
      return;
    }

    // path-based (auto scanned)
    if (b.path) {
      const fileUrl = pathToFileUrl(b.path);
      if (ext === 'pdf') {
        hint.textContent = 'محاولة عرض PDF من المسار المحلي. إن لم يظهر، استخدم "فتح في النظام".';
        area.innerHTML = `<embed src="${esc(fileUrl)}" type="application/pdf" />`;
      } else if (['png','jpg','jpeg','gif','webp','bmp','svg'].includes(ext)) {
        area.innerHTML = `<div style="text-align:center"><img src="${esc(fileUrl)}" alt="" style="max-width:100%;border-radius:8px"/></div>`;
        hint.textContent = 'صورة من المسار المحلي.';
      } else {
        hint.textContent = 'كتاب مكتشف تلقائيًا. لقراءة/تعديل المحتوى النصي أضف الملف يدويًا، أو افتحه في النظام.';
        area.innerHTML = `<div class="empty-state"><div class="big">📘</div><div><b>${esc(b.title)}</b></div><div style="margin-top:8px;direction:ltr;unicode-bidi:embed;font-size:13px;color:#a8b3cc">${esc(b.path)}</div><div style="margin-top:10px">يمكنك إضافة ملاحظات وتمييزات (هايلايتر) لهذا الكتاب من اللوحة الجانبية.</div></div>`;
      }
      return;
    }

    hint.textContent = 'لا يوجد محتوى للعرض.';
    area.innerHTML = `<div class="empty-state"><div class="big">📄</div><div>لا تتوفر معاينة لهذا الكتاب.</div></div>`;
  }

  function pathToFileUrl(p) {
    let s = String(p||'').replace(/\\/g,'/');
    if (!/^([a-zA-Z]:)/.test(s) && !s.startsWith('/')) s = '/' + s;
    return 'file:///' + encodeURI(s).replace(/#/g,'%23');
  }

  function renderTextWithHighlights(text, highlights) {
    const el = $('#readerText'); if(!el) return;
    let html = esc(text);
    const hs = (highlights||[]).filter(h=>h && h.trim()).slice().sort((a,b)=>b.length-a.length);
    for (const h of hs) {
      const pat = esc(h);
      if (!pat) continue;
      try { html = html.split(pat).join('<mark>'+pat+'</mark>'); } catch(e) {}
    }
    el.innerHTML = html || '<span class="muted">لا يوجد نص.</span>';
  }

  function renderHighlights(id) {
    const note = ensureNote(id);
    const list = $('#highlightsList');
    const hs = note.highlights || [];
    if (!hs.length) { list.innerHTML = '<div class="muted">لا توجد تمييزات بعد.</div>'; return; }
    list.innerHTML = hs.map((h,i)=>`<div class="hl-item"><span class="hl">${esc(h)}</span><button class="icon-btn" data-del-hl="${i}" title="حذف">✕</button></div>`).join('');
    $$('[data-del-hl]', list).forEach(btn=>btn.addEventListener('click',()=>{
      const idx=Number(btn.dataset.delHl); note.highlights.splice(idx,1); saveState(); renderHighlights(id);
      if(currentBookId===id){ const b=getBook(id); if(b) renderReader(b); }
    }));
  }

  // Categories
  function renderCategories() {
    // list
    const counts = {};
    state.books.forEach(b=>{ const c=b.category||'بدون قسم'; counts[c]=(counts[c]||0)+1; });
    const list = $('#categoriesList');
    list.innerHTML = state.categories.map(c=>`
      <div class="cat-item">
        <div><span class="cat-name">${esc(c)}</span> <span class="pill">${counts[c]||0} كتاب</span></div>
        <div class="row gap">
          <button class="btn btn-secondary" data-ren-cat="${esc(c)}">إعادة تسمية</button>
          <button class="btn btn-danger" data-del-cat="${esc(c)}">حذف</button>
        </div>
      </div>`).join('') + `<div class="cat-item"><div><span class="cat-name">بدون قسم</span> <span class="pill">${counts['بدون قسم']||0} كتاب</span></div><div class="muted">افتراضي</div></div>`;

    $$('[data-del-cat]').forEach(b=>b.addEventListener('click',()=>{
      const name=b.getAttribute('data-del-cat');
      if(!confirm('حذف القسم "'+name+'"? ستصبح كتبه بدون قسم.')) return;
      state.categories = state.categories.filter(c=>c!==name);
      state.books.forEach(bk=>{ if(bk.category===name) bk.category=''; });
      saveState(); renderCategories(); renderLibrary(); toast('تم حذف القسم');
    }));
    $$('[data-ren-cat]').forEach(b=>b.addEventListener('click',()=>{
      const old=b.getAttribute('data-ren-cat');
      const nn = prompt('اسم جديد للقسم:', old);
      if(!nn || !nn.trim() || nn===old) return;
      const name = nn.trim();
      if (state.categories.includes(name)) { toast('الاسم موجود بالفعل'); return; }
      state.categories = state.categories.map(c=>c===old?name:c);
      state.books.forEach(bk=>{ if(bk.category===old) bk.category=name; });
      saveState(); renderCategories(); renderLibrary(); toast('تم تحديث القسم');
    }));

    // assign controls
    const bsel = $('#assignBookSelect');
    bsel.innerHTML = state.books.length ? state.books.map(b=>`<option value="${b.id}">${esc(b.title)} ${b.category?('— '+esc(b.category)):'(بدون قسم)'}</option>`).join('') : '<option value="">لا توجد كتب</option>';
    const csel = $('#assignCategorySelect');
    csel.innerHTML = `<option value="">بدون قسم</option>` + state.categories.map(c=>`<option value="${esc(c)}">${esc(c)}</option>`).join('');

    const uncat = state.books.filter(b=>!b.category);
    $('#uncategorizedList').innerHTML = uncat.length ? uncat.slice(0,50).map(b=>`<div class="assign-item"><span>${esc(b.title)}</span><span class="muted">${esc(b.ext||'')}</span></div>`).join('') : '<div class="muted">جميع الكتب مصنفة.</div>';
  }

  // Planner
  function distribute(total, days) {
    const base = Math.floor(total/days); let rem = total % days;
    const arr = []; for(let i=0;i<days;i++){ arr.push(base + (rem>0?1:0)); if(rem>0) rem--; } return arr;
  }
  function buildSchedule(plan) {
    const parts = distribute(Number(plan.total), Number(plan.days));
    const start = plan.start ? new Date(plan.start+'T00:00:00') : new Date();
    let cum=0; const rows=[];
    for(let i=0;i<parts.length;i++){
      const d = new Date(start); d.setDate(start.getDate()+i);
      cum += parts[i];
      rows.push({ day:i+1, date:d.toISOString().slice(0,10), amount:parts[i], cumulative:cum });
    }
    return rows;
  }

  function renderPlans() {
    const list = $('#plansList');
    if (!state.plans.length) { list.innerHTML = '<div class="muted">لا توجد خطط بعد. أنشئ خطة لتقسيم الكمية على الأيام.</div>'; return; }
    list.innerHTML = state.plans.map(p=>{
      const rows = buildSchedule(p);
      const done = p.progress || 0; const pct = Math.min(100, Math.round((done/Number(p.total))*100));
      const sched = rows.map(r=>`<div class="schedule-row"><div>اليوم ${r.day} (${r.date})</div><div>${r.amount} ${esc(p.unit)} — تراكمي: ${r.cumulative}</div><div>${Math.round((r.cumulative/Number(p.total))*100)}%</div></div>`).join('');
      return `<div class="plan-item" style="flex-direction:column;align-items:stretch">
        <div class="row" style="justify-content:space-between;gap:8px;">
          <div><b>${esc(p.name)}</b> <span class="muted">— ${esc(p.material||'')}</span></div>
          <div class="row gap"><button class="btn btn-secondary" data-prog="${p.id}">تحديث التقدم</button><button class="btn btn-danger" data-del-plan="${p.id}">حذف</button></div>
        </div>
        <div class="muted" style="margin-top:4px">الإجمالي: ${p.total} ${esc(p.unit)} على ${p.days} يوم | جلسة: ${p.session} دقيقة | التقدم: ${done}/${p.total} (${pct}%)</div>
        <div class="progress"><span style="width:${pct}%"></span></div>
        <details style="margin-top:8px"><summary style="cursor:pointer;color:var(--gold-soft)">عرض جدول التقسيم الزمني</summary><div class="schedule">${sched}</div></details>
      </div>`;
    }).join('');
    $$('[data-del-plan]').forEach(b=>b.addEventListener('click',()=>{ state.plans=state.plans.filter(p=>p.id!==b.dataset.delPlan); saveState(); renderPlans(); toast('تم حذف الخطة'); }));
    $$('[data-prog]').forEach(b=>b.addEventListener('click',()=>{
      const p = state.plans.find(x=>x.id===b.dataset.prog); if(!p) return;
      const v = prompt('أدخل الكمية المنجزة حتى الآن:', String(p.progress||0));
      if(v==null) return; p.progress = Math.max(0, Math.min(Number(p.total), Number(v)||0)); saveState(); renderPlans(); toast('تم تحديث التقدم');
    }));
  }

  function createPlan(smart=false) {
    let name = $('#planName').value.trim();
    let material = $('#planMaterial').value.trim();
    let total = Number($('#planTotal').value);
    let unit = $('#planUnit').value.trim() || 'صفحة';
    let days = Number($('#planDays').value);
    let start = $('#planStart').value;
    let session = Number($('#planSession').value) || 45;
    if (smart) {
      // suggest based on library or defaults
      if (!total) total = 200; if (!days) days = Math.max(5, Math.ceil(total/20));
      if (!name) name = 'خطة دراسة ذكية';
      if (!material && state.books[0]) material = state.books[0].title;
      if (!start) start = new Date().toISOString().slice(0,10);
      // adjust session based on volume
      if (total/days > 40) session = 60; else if (total/days < 10) session = 25;
    }
    if (!name || !total || !days || total<1 || days<1) { toast('يرجى إدخال الاسم والكمية وعدد الأيام'); return; }
    if (!start) start = new Date().toISOString().slice(0,10);
    const plan = { id: uid(), name, material, total, unit, days, start, session, progress:0, createdAt:new Date().toISOString() };
    state.plans.unshift(plan); saveState();
    const rows = buildSchedule(plan);
    $('#planPreview').innerHTML = `<div class="panel" style="margin-top:10px"><b>تم إنشاء الخطة:</b> ${esc(name)}<div class="muted">تقسيم ${total} ${esc(unit)} على ${days} يوم (حوالي ${(total/days).toFixed(1)} ${esc(unit)} يوميًا)</div><div class="schedule">${rows.slice(0,7).map(r=>`<div class="schedule-row"><div>اليوم ${r.day}</div><div>${r.amount} ${esc(unit)}</div><div>${r.date}</div></div>`).join('')}${rows.length>7?'<div class="muted">...عرض الجدول الكامل من قائمة الخطط</div>':''}</div></div>`;
    renderPlans(); toast('تم إنشاء الخطة وتقسيم الكمية');
  }

  // Timer
  function fmtTime(s){ s=Math.max(0,Math.floor(s)); const m=String(Math.floor(s/60)).padStart(2,'0'); const ss=String(s%60).padStart(2,'0'); return m+':'+ss; }
  function updateTimerUI(){ $('#timerDisplay').textContent = fmtTime(timer.left); }
  function timerTick(){ if(!timer.running) return; timer.left--; if(timer.left<=0){ timer.left=0; timer.running=false; clearInterval(timer.handle); timer.handle=null; $('#timerStatus').textContent='انتهت الجلسة! أحسنت.'; try{new AudioContext().resume();}catch(e){} toast('انتهى وقت الجلسة'); } updateTimerUI(); }

  // AI / Smart features
  function suggestCategory(title) {
    const t = (title||'').toLowerCase();
    let best = '', scoreBest = 0;
    for (const [cat, keys] of Object.entries(CATEGORY_KEYWORDS)) {
      let score = 0; for (const k of keys) { if (t.includes(k.toLowerCase())) score += k.length > 3 ? 2 : 1; }
      if (score > scoreBest) { scoreBest = score; best = cat; }
    }
    return scoreBest>0 ? best : '';
  }
  function autoCategorizeAll() {
    let changed = 0;
    for (const b of state.books) {
      if (b.category) continue;
      const sug = suggestCategory(b.title);
      if (sug) { if (!state.categories.includes(sug)) state.categories.push(sug); b.category = sug; changed++; }
    }
    saveState(); renderLibrary();
    return changed;
  }
  function getInsights() {
    const total = state.books.length;
    const uncat = state.books.filter(b=>!b.category).length;
    const byExt = {};
    state.books.forEach(b=>{ const e=(b.ext||'other').toUpperCase(); byExt[e]=(byExt[e]||0)+1; });
    const topExt = Object.entries(byExt).sort((a,b)=>b[1]-a[1]).slice(0,5).map(x=>`${x[0]} (${x[1]})`).join('، ') || '—';
    const plans = state.plans.length;
    const active = state.plans.filter(p=> (p.progress||0) < Number(p.total)).length;
    const score = total ? Math.round(((total-uncat)/total)*100) : 100;
    return { total, uncat, topExt, plans, active, score };
  }
  function renderAssistant() {
    const m = getInsights();
    $('#aiMetrics').innerHTML = [
      ['الكتب', m.total], ['نسبة التصنيف', m.score+'%'], ['بدون قسم', m.uncat], ['خطط نشطة', m.active]
    ].map(x=>`<div class="metric"><div class="val">${x[1]}</div><div class="lbl">${x[0]}</div></div>`).join('');
    const tips = [];
    if (m.uncat>0) tips.push(`لديك ${m.uncat} كتاب بدون قسم — استخدم التصنيف التلقائي الذكي لتحسين التنظيم.`);
    if (m.total===0) tips.push('ابدأ باستيراد مجلد الكتب من جهازك لملء الرفوف تلقائيًا.');
    if (m.plans===0) tips.push('أنشئ خطة دراسة لتقسيم صفحات كتابك على أيام وتثبيت وقت جلسات التركيز.');
    tips.push('قسّم الكميات الكبيرة إلى وحدات يومية صغيرة (مثلاً 15-25 صفحة) لرفع الدقة والاستمرارية.');
    tips.push('استخدم مؤقت التركيز (25/45 دقيقة) مع استراحات قصيرة لتحسين الفهم.');
    tips.push('أضف تمييزات (هايلايتر) للنقاط المهمة داخل الكتب النصية لمراجعتها بسرعة.');
    $('#aiTips').innerHTML = tips.map(t=>`<li>${esc(t)}</li>`).join('');
  }

  // Settings
  function renderSettings() {
    const m = getInsights();
    const scanned = window.AUTO_LIBRARY_SCANNED_AT || 'غير متاح على هذا الجهاز';
    $('#settingsInfo').innerHTML = `
      <div><b>عدد الكتب:</b> ${m.total}</div>
      <div><b>عدد الأقسام:</b> ${state.categories.length}</div>
      <div><b>عدد الخطط:</b> ${state.plans.length}</div>
      <div><b>آخر فحص تلقائي:</b> ${esc(scanned)}</div>
      <div><b>إصدار التطبيق:</b> نسخة Android/Web</div>
      <div><b>مسار التطبيق:</b> <span style="direction:ltr;unicode-bidi:embed">${esc(location.href)}</span></div>
    `;
  }

  // Events
  function bindEvents() {
    $$('.nav-item').forEach(b=>b.addEventListener('click',()=>showView(b.dataset.view)));
    $('#searchInput').addEventListener('input', renderLibrary);
    $('#categoryFilter').addEventListener('change', renderLibrary);
    $('#sortSelect').addEventListener('change', renderLibrary);
    $('#importFiles').addEventListener('change', e=>{ importFiles(e.target.files,false); e.target.value=''; });
    $('#importFolder').addEventListener('change', e=>{ importFiles(e.target.files,true); e.target.value=''; });

    // modal
    $$('[data-close="modal"]').forEach(el=>el.addEventListener('click', closeModal));
    $('#modalSaveCategory').addEventListener('click',()=>{
      if(!currentBookId) return; const b=getBook(currentBookId); if(!b) return; b.category=$('#modalCategorySelect').value; saveState(); renderBookMeta(b); renderLibrary(); renderCategories(); toast('تم حفظ القسم');
    });
    $('#deleteBookBtn').addEventListener('click', async ()=>{
      if(!currentBookId) return; if(!confirm('إزالة الكتاب من المكتبة؟')) return;
      const id=currentBookId; await dbDel('file:'+id); delete state.notes[id]; state.books=state.books.filter(b=>b.id!==id);
      saveState(); closeModal(); renderLibrary(); renderCategories(); toast('تمت الإزالة');
    });
    $('#saveNotesBtn').addEventListener('click',()=>{
      if(!currentBookId) return; const n=ensureNote(currentBookId); n.notes=$('#bookNotes').value; saveState(); toast('تم حفظ الملاحظات');
    });
    $('#addHighlightBtn').addEventListener('click', async ()=>{
      if(!currentBookId) return; const txt=$('#highlightText').value.trim(); if(!txt) return; const n=ensureNote(currentBookId);
      n.highlights = n.highlights||[]; if(!n.highlights.includes(txt)) n.highlights.push(txt);
      saveState(); $('#highlightText').value=''; renderHighlights(currentBookId); const b=getBook(currentBookId); if(b) await renderReader(b); toast('تمت إضافة التمييز');
    });
    $('#openExternalBtn').addEventListener('click',()=>{
      if(!currentBookId) return; const b=getBook(currentBookId); if(!b) return;
      if (b.path) {
        try { window.open(pathToFileUrl(b.path), '_blank'); }
        catch(e){ prompt('انسخ المسار لفتح الكتاب:', b.path); }
      } else {
        toast('هذا الكتاب مضاف داخل التطبيق. إن لم تُفتح المعاينة، أعد إضافته كملف.');
      }
    });
    $('#editContentBtn').addEventListener('click',()=>{
      if(!currentBookId) return; const n=ensureNote(currentBookId); const text = (n.contentOverride!=null?n.contentOverride:n.textContent);
      if (text==null) { toast('تعديل المحتوى متاح للكتب النصية المضافة كمحتوى.'); return; }
      $('#readerArea').innerHTML = `<textarea id="editorArea" class="reader-edit"></textarea>`;
      $('#editorArea').value = text;
      $('#editContentBtn').classList.add('hidden'); $('#saveContentBtn').classList.remove('hidden'); $('#cancelEditBtn').classList.remove('hidden');
      $('#readerHint').textContent = 'وضع تعديل المحتوى النصي';
    });
    $('#saveContentBtn').addEventListener('click', async ()=>{
      if(!currentBookId) return; const n=ensureNote(currentBookId); const ta=$('#editorArea'); if(!ta) return;
      n.contentOverride = ta.value; saveState();
      $('#editContentBtn').classList.remove('hidden'); $('#saveContentBtn').classList.add('hidden'); $('#cancelEditBtn').classList.add('hidden');
      const b=getBook(currentBookId); if(b) await renderReader(b); toast('تم حفظ التعديلات على المحتوى');
    });
    $('#cancelEditBtn').addEventListener('click', async ()=>{ $('#editContentBtn').classList.remove('hidden'); $('#saveContentBtn').classList.add('hidden'); $('#cancelEditBtn').classList.add('hidden'); const b=getBook(currentBookId); if(b) await renderReader(b); });

    // categories
    $('#addCategoryBtn').addEventListener('click',()=>{
      const name = $('#newCategoryName').value.trim(); if(!name) return;
      if (state.categories.includes(name)) { toast('القسم موجود بالفعل'); return; }
      state.categories.push(name); $('#newCategoryName').value=''; saveState(); renderCategories(); renderLibrary(); toast('تمت إضافة القسم');
    });
    $('#assignCategoryBtn').addEventListener('click',()=>{
      const bid=$('#assignBookSelect').value; const cat=$('#assignCategorySelect').value; if(!bid) return; const b=getBook(bid); if(!b) return;
      b.category = cat; saveState(); renderCategories(); renderLibrary(); toast('تم تعيين القسم');
    });

    // planner
    $('#createPlanBtn').addEventListener('click',()=>createPlan(false));
    $('#smartPlanBtn').addEventListener('click',()=>createPlan(true));
    const today = new Date().toISOString().slice(0,10); $('#planStart').value = today;

    // timer
    $('#timerStart').addEventListener('click',()=>{ if(timer.running) return; if(timer.left<=0) timer.left=timer.total; timer.running=true; $('#timerStatus').textContent='جلسة تركيز جارية...'; timer.handle=setInterval(timerTick,1000); });
    $('#timerPause').addEventListener('click',()=>{ timer.running=false; clearInterval(timer.handle); timer.handle=null; $('#timerStatus').textContent='متوقف مؤقتًا'; });
    $('#timerReset').addEventListener('click',()=>{ timer.running=false; clearInterval(timer.handle); timer.handle=null; timer.left=timer.total; updateTimerUI(); $('#timerStatus').textContent='جاهز للبدء'; });
    $$('.chip[data-min]').forEach(b=>b.addEventListener('click',()=>{ timer.total=Number(b.dataset.min)*60; timer.left=timer.total; timer.running=false; clearInterval(timer.handle); timer.handle=null; updateTimerUI(); $('#timerStatus').textContent='تم ضبط المؤقت على '+b.dataset.min+' دقيقة'; }));

    // assistant
    $('#aiCategorizeBtn').addEventListener('click',()=>{
      const n = autoCategorizeAll();
      $('#aiOutput').textContent = n ? `تم التصنيف الذكي لـ ${n} كتاب بناءً على تحليل العناوين والكلمات المفتاحية.\nتم تحديث الرفوف والأقسام تلقائيًا.` : 'لا توجد كتب جديدة تحتاج تصنيفًا تلقائيًا، أو لم يتم التعرف على كلمات مفتاحية كافية.';
      renderAssistant(); renderCategories();
    });
    $('#aiInsightsBtn').addEventListener('click',()=>{
      const m=getInsights();
      const lines = [
        'تحليل المكتبة:',
        `- إجمالي الكتب: ${m.total}`,
        `- نسبة التصنيف: ${m.score}% (${m.uncat} بدون قسم)`,
        `- أكثر الصيغ تواجدًا: ${m.topExt}`,
        `- الخطط: ${m.plans} (النشطة غير المكتملة: ${m.active})`,
        '',
        'اقتراحات ذكية:',
        m.uncat?`- صنّف الكتب غير المصنفة لرفع دقة التنظيم.`:'- التصنيف ممتاز، حافظ على تنظيم الكتب عند الإضافة.',
        m.total?'- أنشئ خطة لكل كتاب كبير بتقسيم الكمية على أيام وجلسات ثابتة.':'- ابدأ باستيراد مجلد "المستندات" أو "كتب" لملء المكتبة.',
        '- للحفظ الأفضل: راجع التمييزات (الهايلايتر) في نهاية كل جلسة.'
      ];
      $('#aiOutput').textContent = lines.join('\n');
    });
    $('#aiPlanBtn').addEventListener('click',()=>{
      // suggest plan for first uncategorized/any book or generic
      const target = state.books.find(b=>!b.category) || state.books[0];
      const total = 180; const days = 12; const per = (total/days).toFixed(1);
      const mat = target ? target.title : 'مادة دراسية';
      $('#aiOutput').textContent = `خطة دراسة ذكية مقترحة:\n- المادة: ${mat}\n- الكمية المقترحة: ${total} وحدة\n- المدة: ${days} يوم\n- المتوسط اليومي: ${per} وحدة\n- الجلسة: 45 دقيقة تركيز + 10 دقائق استراحة\n\nيمكنك تطبيقها من تبويب "منظم الدراسة" عبر زر "اقتراح ذكي للخطة" أو تعبئة الحقول ثم الإنشاء.`;
      $('#planName').value = 'خطة ذكية: '+mat; $('#planMaterial').value = mat; $('#planTotal').value=total; $('#planDays').value=days; $('#planSession').value=45; $('#planStart').value=new Date().toISOString().slice(0,10);
      toast('تم تجهيز اقتراح خطة ذكية في منظم الدراسة');
    });

    // settings
    $('#exportBtn').addEventListener('click',()=>{
      const data = JSON.stringify(state, null, 2);
      const blob = new Blob([data], {type:'application/json'});
      const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = 'maktabati-backup.json'; a.click();
      setTimeout(()=>URL.revokeObjectURL(a.href), 1000);
    });
    $('#importData').addEventListener('change', async (e)=>{
      const f=e.target.files[0]; if(!f) return; try{ const txt=await readFileAsText(f); const s=JSON.parse(txt); if(s && Array.isArray(s.books)){ state=s; state.categories=state.categories||DEFAULT_CATEGORIES.slice(); state.plans=state.plans||[]; state.notes=state.notes||{}; saveState(); renderLibrary(); renderCategories(); renderPlans(); toast('تم استيراد البيانات'); } else toast('ملف غير صالح'); }catch(err){ toast('تعذر قراءة الملف'); } e.target.value='';
    });
    $('#resetBtn').addEventListener('click', async ()=>{
      if(!confirm('سيتم حذف بيانات التنظيم والخطط والملاحظات داخل التطبيق. هل أنت متأكد؟')) return;
      localStorage.removeItem(STORAGE_KEY);
      const db = await openDB(); if(db){ try{ const tx=db.transaction(DB_STORE,'readwrite'); tx.objectStore(DB_STORE).clear(); }catch(e){} }
      state = loadState(); mergeAutoLibrary(); saveState(); renderLibrary(); renderCategories(); renderPlans(); renderAssistant(); renderSettings(); toast('تمت إعادة الضبط');
    });
    const rescanBtn = $('#rescanBtn');
    if (rescanBtn) rescanBtn.addEventListener('click',()=>{
      toast('لتحديث الفحص التلقائي شغّل ملف Scan-Library.ps1 أو أعد تشغيل التطبيق عبر الملف التشغيلي.');
    });
  }

  function init() {
    mergeAutoLibrary();
    saveState();
    bindEvents();
    updateTimerUI();
    updateStats();
    renderLibrary();
    // splash
    setTimeout(()=>{
      $('#splash').classList.add('fade-out');
      $('#app').classList.remove('hidden');
      setTimeout(()=>$('#splash').classList.add('hidden'), 700);
    }, 1800);
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();
})();
