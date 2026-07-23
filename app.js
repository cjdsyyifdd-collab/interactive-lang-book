
const PDF_URLS = {
  chapter1A: null,
  chapter1B: null
};

const STORAGE = {
  books: 'ibooks.v2.books',
  settings: 'ibooks.v2.settings',
  currentBook: 'ibooks.v2.currentBook',
  currentPage: 'ibooks.v2.currentPage',
  answers: 'ibooks.v2.answers',
  notes: 'ibooks.v2.notes',
  audio: 'ibooks.v2.audio',
  vocab: 'ibooks.v2.vocab',
  overlays: 'ibooks.v2.overlays'
};

const state = {
  books: [],
  currentBookId: null,
  currentPage: 1,
  zoom: 1.18,
  pdfDoc: null,
  renderPending: null,
  rendering: false,
  dark: false,
  autosave: true,
  showOverlay: true,
  activeTool: 'write',
  pdfObjectUrl: null,
  selectedOverlayId: null
};

const $ = (s) => document.querySelector(s);
const $$ = (s) => Array.from(document.querySelectorAll(s));

function readJSON(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : fallback;
  } catch { return fallback; }
}
function writeJSON(key, value) {
  localStorage.setItem(key, JSON.stringify(value));
}
function kAnswer(bookId, page, id) { return `${STORAGE.answers}:${bookId}:${page}:${id}`; }
function kNote(bookId, page) { return `${STORAGE.notes}:${bookId}:${page}`; }
function kOverlay(bookId, page, id) { return `${STORAGE.overlays}:${bookId}:${page}:${id}`; }

const chapter1Data = {
  bookTitle: 'Netzwerk neu A2',
  subtitle: 'Kapitel 1 - über Vergangenes berichten',
  pages: [12, 13, 14, 15, 16, 17, 18, 19],
  templates: {}
};

async function loadChapterTemplates() {
  const res = await fetch('./data/chapter1.json');
  const json = await res.json();
  chapter1Data.templates = json.templates || {};
  chapter1Data.bookTitle = json.bookTitle || chapter1Data.bookTitle;
  chapter1Data.subtitle = json.chapterTitle || chapter1Data.subtitle;
}

function defaultBooks() {
  return [
    {
      id: 'chapter1-import',
      title: 'Netzwerk neu A2',
      subtitle: 'Kapitel 1 - Importiere das PDF',
      pdfMode: 'imported',
      pages: chapter1Data.pages
    }
  ];
}

function getCurrentBook() {
  return state.books.find(b => b.id === state.currentBookId) || state.books[0] || null;
}

function getPageTemplates(page) {
  const book = getCurrentBook();
  const fromData = chapter1Data.templates[String(page)] || [];
  const manual = readJSON(STORAGE.overlays, {});
  const fromLocal = manual[`${state.currentBookId}:${page}`] || [];
  return [...fromData, ...fromLocal];
}

function setStatus(title, subtitle) {
  $('#bookTitle').textContent = title;
  $('#bookMeta').textContent = subtitle || '';
}

function applyTheme() {
  document.body.classList.toggle('dark', state.dark);
  $('#darkModeToggle').checked = state.dark;
  $('#autosaveToggle').checked = state.autosave;
  $('#overlayToggle').checked = state.showOverlay;
}

function syncSettings() {
  const settings = readJSON(STORAGE.settings, {});
  state.dark = !!settings.dark;
  state.autosave = settings.autosave !== false;
  state.showOverlay = settings.showOverlay !== false;
  applyTheme();
}

function saveSettings() {
  writeJSON(STORAGE.settings, { dark: state.dark, autosave: state.autosave, showOverlay: state.showOverlay });
}

function saveCurrentState() {
  if (!state.currentBookId) return;
  localStorage.setItem(STORAGE.currentBook, state.currentBookId);
  localStorage.setItem(STORAGE.currentPage, String(state.currentPage));
}

function renderBookList() {
  const wrap = $('#bookList');
  wrap.innerHTML = '';
  state.books.forEach(book => {
    const btn = document.createElement('button');
    btn.className = `book-item ${book.id === state.currentBookId ? 'active' : ''}`;
    btn.innerHTML = `<strong>${book.title}</strong><br><small>${book.subtitle}</small>`;
    btn.addEventListener('click', () => selectBook(book.id));
    wrap.appendChild(btn);
  });
}

async function init() {
  await loadChapterTemplates();
  state.books = readJSON(STORAGE.books, defaultBooks());
  state.currentBookId = localStorage.getItem(STORAGE.currentBook) || state.books[0].id;
  state.currentPage = Number(localStorage.getItem(STORAGE.currentPage) || 12);
  syncSettings();
  setupUI();
  renderBookList();
  await openCurrentBook();

  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('./sw.js').catch(() => {});
  }
}

function setupUI() {
  $('#importPdfBtn').addEventListener('click', () => $('#pdfInput').click());
  $('#pdfInput').addEventListener('change', onImportPdf);

  $('#prevPageBtn').addEventListener('click', () => changePage(-1));
  $('#nextPageBtn').addEventListener('click', () => changePage(1));
  $('#zoomSlider').addEventListener('input', (e) => {
    state.zoom = parseFloat(e.target.value);
    renderPage();
  });
  $('#zoomOutBtn').addEventListener('click', () => { state.zoom = Math.max(0.8, state.zoom - 0.05); $('#zoomSlider').value = state.zoom; renderPage(); });
  $('#zoomInBtn').addEventListener('click', () => { state.zoom = Math.min(2.4, state.zoom + 0.05); $('#zoomSlider').value = state.zoom; renderPage(); });

  $('#toggleSidebarBtn').addEventListener('click', () => $('#sidebar').classList.toggle('hidden'));
  $('#themeBtn').addEventListener('click', () => {
    state.dark = !state.dark; saveSettings(); applyTheme();
  });
  $('#darkModeToggle').addEventListener('change', (e) => { state.dark = e.target.checked; saveSettings(); applyTheme(); });
  $('#autosaveToggle').addEventListener('change', (e) => { state.autosave = e.target.checked; saveSettings(); });
  $('#overlayToggle').addEventListener('change', (e) => { state.showOverlay = e.target.checked; saveSettings(); renderOverlay(); });

  $('#noteToolBtn').addEventListener('click', () => setTool('note'));
  $('#highlightToolBtn').addEventListener('click', () => setTool('highlight'));
  $('#writeToolBtn').addEventListener('click', () => setTool('write'));
  $('#eraseToolBtn').addEventListener('click', () => setTool('erase'));
  $('#audioToolBtn').addEventListener('click', () => $('#listeningPanel').scrollIntoView({ behavior:'smooth', block:'start' }));

  $('#saveNoteBtn').addEventListener('click', saveNote);
  $('#attachAudioBtn').addEventListener('click', () => $('#audioFileInput').click());
  $('#audioFileInput').addEventListener('change', (e) => importAudio(e.target.files?.[0]));
  $('#addVocabBtn').addEventListener('click', addVocab);

  $('#searchBtn').addEventListener('click', () => alert('ميزة البحث ستُضاف في النسخة التالية.'));
  $('#bookmarkBtn').addEventListener('click', () => alert(`تم حفظ الصفحة ${state.currentPage} كإشارة مرجعية.`));
  $('#penBtn').addEventListener('click', () => alert('يمكنك الكتابة داخل الخانات الظاهرة فوق الصفحة.'));
  $$('.nav-item').forEach(btn => btn.addEventListener('click', () => switchPanel(btn.dataset.panel)));

  window.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowLeft') changePage(-1);
    if (e.key === 'ArrowRight') changePage(1);
  });
}

function setTool(tool) {
  state.activeTool = tool;
  const map = {
    note: 'وضع الملاحظات',
    highlight: 'وضع التظليل',
    write: 'وضع الكتابة',
    erase: 'وضع المسح'
  };
  $('#toolState').textContent = map[tool] || 'جاهز';
}

function switchPanel(panelId) {
  $$('.nav-item').forEach(b => b.classList.toggle('active', b.dataset.panel === panelId));
  $$('.panel').forEach(p => p.classList.remove('active'));
  document.getElementById(panelId).classList.add('active');
  if (panelId === 'notesPanel') renderNotes();
  if (panelId === 'listeningPanel') renderAudio();
  if (panelId === 'vocabPanel') renderVocab();
}

function onImportPdf(e) {
  const file = e.target.files?.[0];
  if (!file) return;
  if (file.type !== 'application/pdf') return alert('اختر ملف PDF صحيح.');
  const id = `book_${Date.now()}`;
  const url = URL.createObjectURL(file);
  const newBook = {
    id,
    title: file.name.replace(/\.pdf$/i, ''),
    subtitle: chapter1Data.subtitle,
    pdfUrl: url,
    pages: chapter1Data.pages,
    imported: true
  };
  state.books.unshift(newBook);
  state.currentBookId = id;
  state.currentPage = 12;
  writeJSON(STORAGE.books, state.books);
  saveCurrentState();
  renderBookList();
  openCurrentBook();
}

async function selectBook(bookId) {
  state.currentBookId = bookId;
  state.currentPage = Number(localStorage.getItem(STORAGE.currentPage) || 12);
  saveCurrentState();
  renderBookList();
  await openCurrentBook();
}

async function openCurrentBook() {
  const book = getCurrentBook();
  if (!book) return;

  setStatus(book.title || chapter1Data.bookTitle, book.subtitle || chapter1Data.subtitle);
  $('#emptyState').classList.add('hidden');
  $('#pdfWrapper').classList.remove('hidden');
  $('#bookInfoBadge').textContent = book.imported ? 'PDF مستورد' : 'PDF';

  const pdfUrl = book.pdfUrl || './sample-network-a2.pdf';
  if (!book.pdfUrl) {
    $('#emptyState').classList.remove('hidden');
    setStatus('افتح ملف PDF', 'استورد كتاب Netzwerk A2 من الهاتف');
    return;
  }

  if (state.pdfObjectUrl && state.pdfObjectUrl !== pdfUrl) URL.revokeObjectURL(state.pdfObjectUrl);
  state.pdfObjectUrl = pdfUrl;
  await ensurePdfWorker();
  state.pdfDoc = await window.pdfjsLib.getDocument(pdfUrl).promise;
  const pageCount = state.pdfDoc.numPages;
  state.currentPage = clamp(state.currentPage || 1, 1, pageCount);

  $('#pageIndicator').textContent = `${state.currentPage} / ${pageCount}`;
  $('#zoomSlider').value = state.zoom;
  renderPage();
  renderNotes();
  renderAudio();
  renderVocab();
}

async function ensurePdfWorker() {
  if (!window.pdfjsLib) throw new Error('PDF.js not loaded');
  window.pdfjsLib.GlobalWorkerOptions.workerSrc =
    'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';
}

function clamp(n, min, max) {
  return Math.max(min, Math.min(max, n));
}

async function changePage(delta) {
  if (!state.pdfDoc) return;
  state.currentPage = clamp(state.currentPage + delta, 1, state.pdfDoc.numPages);
  saveCurrentState();
  await renderPage();
}

async function renderPage() {
  if (!state.pdfDoc) return;
  if (state.rendering) {
    state.renderPending = state.currentPage;
    return;
  }
  state.rendering = true;

  const page = await state.pdfDoc.getPage(state.currentPage);
  const viewport = page.getViewport({ scale: state.zoom });
  const canvas = $('#pdfCanvas');
  const ctx = canvas.getContext('2d');

  canvas.width = viewport.width;
  canvas.height = viewport.height;
  canvas.style.width = `${viewport.width}px`;
  canvas.style.height = `${viewport.height}px`;

  $('#pdfWrapper').style.width = `${viewport.width}px`;
  $('#pdfWrapper').style.height = `${viewport.height}px`;
  $('#overlayLayer').style.width = `${viewport.width}px`;
  $('#overlayLayer').style.height = `${viewport.height}px`;

  await page.render({ canvasContext: ctx, viewport }).promise;

  state.rendering = false;
  $('#pageIndicator').textContent = `${state.currentPage} / ${state.pdfDoc.numPages}`;
  renderOverlay();
  renderPageSummary();
  renderAnswers();
  if (state.renderPending) {
    const next = state.renderPending;
    state.renderPending = null;
    state.currentPage = next;
    renderPage();
  }
}

function renderOverlay() {
  const layer = $('#overlayLayer');
  layer.innerHTML = '';
  layer.classList.toggle('hidden', !state.showOverlay);
  if (!state.showOverlay) return;

  const fields = getPageTemplates(state.currentPage);
  const rect = $('#pdfCanvas').getBoundingClientRect();
  const width = rect.width;
  const height = rect.height;

  fields.forEach(field => {
    const box = document.createElement('div');
    box.className = 'field-box';
    box.style.left = `${(field.x / 100) * width}px`;
    box.style.top = `${(field.y / 100) * height}px`;
    box.style.width = `${(field.w / 100) * width}px`;
    box.style.height = `${(field.h / 100) * height}px`;

    const tag = document.createElement('span');
    tag.className = 'field-tag';
    tag.textContent = field.label || field.id;

    let input;
    if (field.type === 'checkbox') {
      input = document.createElement('button');
      input.className = 'checkbox-pill';
      const saved = localStorage.getItem(kAnswer(state.currentBookId, state.currentPage, field.id)) === 'true';
      input.textContent = saved ? '✓' : '□';
      input.dataset.value = saved ? 'true' : 'false';
      input.addEventListener('click', () => {
        const next = input.dataset.value !== 'true';
        input.dataset.value = String(next);
        input.textContent = next ? '✓' : '□';
        localStorage.setItem(kAnswer(state.currentBookId, state.currentPage, field.id), String(next));
        renderAnswers();
      });
    } else {
      input = document.createElement('input');
      input.type = 'text';
      input.className = 'answer-input';
      input.placeholder = field.placeholder || 'اكتب هنا';
      input.value = localStorage.getItem(kAnswer(state.currentBookId, state.currentPage, field.id)) || '';
      input.addEventListener('input', () => {
        if (state.autosave) localStorage.setItem(kAnswer(state.currentBookId, state.currentPage, field.id), input.value);
        renderAnswers();
      });
      input.addEventListener('blur', () => {
        if (!state.autosave) localStorage.setItem(kAnswer(state.currentBookId, state.currentPage, field.id), input.value);
      });
    }

    const mark = document.createElement('div');
    mark.className = 'checkmark';
    mark.textContent = (input.type === 'text' && input.value.trim()) || (input.dataset?.value === 'true') ? '✓' : '';

    box.appendChild(tag);
    box.appendChild(input);
    box.appendChild(mark);
    layer.appendChild(box);
  });
}

function renderAnswers() {
  const list = $('#answersList');
  const fields = getPageTemplates(state.currentPage);
  list.innerHTML = '';
  if (!fields.length) {
    list.innerHTML = '<div class="summary-box">لا توجد خانات محددة لهذه الصفحة بعد. يمكنك إضافتها يدويًا لاحقًا.</div>';
    return;
  }
  fields.forEach(field => {
    const value = localStorage.getItem(kAnswer(state.currentBookId, state.currentPage, field.id)) || '';
    const row = document.createElement('div');
    row.className = 'answer-row';
    row.innerHTML = `<div><strong>${field.label || field.id}</strong><br><small>${value || 'فارغ'}</small></div>`;
    const del = document.createElement('button');
    del.className = 'mini-btn';
    del.textContent = '✕';
    del.addEventListener('click', () => {
      localStorage.removeItem(kAnswer(state.currentBookId, state.currentPage, field.id));
      renderPage();
      renderAnswers();
    });
    row.appendChild(del);
    list.appendChild(row);
  });
}

function renderPageSummary() {
  const fields = getPageTemplates(state.currentPage);
  $('#pageSummary').innerHTML = `
    <strong>Kapitel 1</strong><br>
    الصفحة الحالية: ${state.currentPage}<br>
    عدد الحقول: ${fields.length}<br>
    ${state.activeTool ? `الوضع الحالي: ${state.activeTool}` : ''}
  `;
}

function saveNote() {
  const text = $('#notesInput').value.trim();
  if (!text) return;
  localStorage.setItem(kNote(state.currentBookId, state.currentPage), text);
  const notes = readJSON(STORAGE.notes, []);
  notes.push({ id: `note_${Date.now()}`, bookId: state.currentBookId, page: state.currentPage, text });
  writeJSON(STORAGE.notes, notes);
  renderNotes();
}

function renderNotes() {
  $('#notesInput').value = localStorage.getItem(kNote(state.currentBookId, state.currentPage)) || '';
  const notes = readJSON(STORAGE.notes, []).filter(n => n.bookId === state.currentBookId);
  const list = $('#notesList');
  list.innerHTML = '';
  if (!notes.length) {
    list.innerHTML = '<div class="summary-box">لا توجد ملاحظات محفوظة.</div>';
    return;
  }
  notes.slice().reverse().forEach(n => {
    const card = document.createElement('div');
    card.className = 'card-row';
    card.innerHTML = `<div><strong>Page ${n.page}</strong><br><small>${n.text}</small></div>`;
    const del = document.createElement('button');
    del.className = 'mini-btn';
    del.textContent = '🗑';
    del.addEventListener('click', () => {
      const all = readJSON(STORAGE.notes, []).filter(x => x.id !== n.id);
      writeJSON(STORAGE.notes, all);
      renderNotes();
    });
    card.appendChild(del);
    list.appendChild(card);
  });
}

function importAudio(file) {
  if (!file) return;
  const reader = new FileReader();
  reader.onload = () => {
    const data = readJSON(STORAGE.audio, {});
    const key = `${state.currentBookId}:${state.currentPage}`;
    data[key] = data[key] || [];
    data[key].push({
      id: `audio_${Date.now()}`,
      fileName: file.name,
      label: $('#audioLabelInput').value.trim() || `Hören ${state.currentPage}`,
      dataUrl: reader.result
    });
    writeJSON(STORAGE.audio, data);
    renderAudio();
  };
  reader.readAsDataURL(file);
}

function renderAudio() {
  const key = `${state.currentBookId}:${state.currentPage}`;
  const data = readJSON(STORAGE.audio, {});
  const items = data[key] || [];
  const list = $('#audioList');
  const player = $('#audioPlayer');
  list.innerHTML = '';
  if (!items.length) {
    list.innerHTML = '<div class="summary-box">اربط ملف صوت بتمرين الاستماع هنا.</div>';
    return;
  }
  items.forEach(item => {
    const row = document.createElement('div');
    row.className = 'card-row';
    row.innerHTML = `<div><strong>${item.label}</strong><br><small>${item.fileName}</small></div>`;
    const controls = document.createElement('div');
    controls.style.display = 'flex';
    controls.style.gap = '8px';

    const play = document.createElement('button');
    play.className = 'mini-btn';
    play.textContent = '▶';
    play.addEventListener('click', () => {
      player.src = item.dataUrl;
      player.classList.remove('hidden');
      player.play();
    });

    const del = document.createElement('button');
    del.className = 'mini-btn';
    del.textContent = '✕';
    del.addEventListener('click', () => {
      const next = (readJSON(STORAGE.audio, {})[key] || []).filter(x => x.id !== item.id);
      const all = readJSON(STORAGE.audio, {});
      all[key] = next;
      writeJSON(STORAGE.audio, all);
      renderAudio();
    });

    controls.append(play, del);
    row.appendChild(controls);
    list.appendChild(row);
  });
}

function addVocab() {
  const word = $('#vocabWordInput').value.trim();
  const meaning = $('#vocabMeaningInput').value.trim();
  if (!word) return;
  const vocab = readJSON(STORAGE.vocab, []);
  vocab.push({ id: `v_${Date.now()}`, bookId: state.currentBookId, page: state.currentPage, word, meaning });
  writeJSON(STORAGE.vocab, vocab);
  $('#vocabWordInput').value = '';
  $('#vocabMeaningInput').value = '';
  renderVocab();
}

function renderVocab() {
  const list = $('#vocabList');
  const items = readJSON(STORAGE.vocab, []).filter(v => v.bookId === state.currentBookId);
  list.innerHTML = '';
  if (!items.length) {
    list.innerHTML = '<div class="summary-box">لم يتم حفظ كلمات بعد.</div>';
    return;
  }
  items.slice().reverse().forEach(item => {
    const row = document.createElement('div');
    row.className = 'card-row';
    row.innerHTML = `<div><strong>${item.word}</strong><br><small>${item.meaning || ''}</small></div>`;
    const del = document.createElement('button');
    del.className = 'mini-btn';
    del.textContent = '✕';
    del.addEventListener('click', () => {
      const next = readJSON(STORAGE.vocab, []).filter(x => x.id !== item.id);
      writeJSON(STORAGE.vocab, next);
      renderVocab();
    });
    row.appendChild(del);
    list.appendChild(row);
  });
}

window.addEventListener('beforeunload', saveCurrentState);
init().catch(err => {
  console.error(err);
  alert('حدث خطأ أثناء تشغيل التطبيق.');
});
