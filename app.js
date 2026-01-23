// ================================
// MONACO EDITOR CONFIGURATION
// ================================
require.config({
  paths: {
    vs: 'https://unpkg.com/monaco-editor@0.45.0/min/vs'
  }
});

require(['vs/editor/editor.main'], () => {

  // ================================
  // GLOBAL STATE
  // ================================
  let db;
  const openTabs = new Map(); // filename -> { model, cursorPosition }
  let activeFile = null;

  // ================================
  // CREATE MONACO EDITOR
  // ================================
  window.editor = monaco.editor.create(
    document.getElementById('editor'),
    {
      value: '',
      language: 'html',
      theme: 'vs-dark',
      fontSize: 14,
      fontFamily: 'Fira Code, Consolas, monospace',
      minimap: { enabled: false },
      scrollBeyondLastLine: false,
      automaticLayout: true,
      tabSize: 2,
      wordWrap: 'on'
    }
  );

  // ================================
  // INDEXED DB SETUP
  // ================================
  function openDB() {
    return new Promise((resolve, reject) => {
      const request = indexedDB.open('zero-latency-ide', 1);

      request.onupgradeneeded = e => {
        db = e.target.result;
        db.createObjectStore('files', { keyPath: 'id' });
      };

      request.onsuccess = e => {
        db = e.target.result;
        resolve();
      };

      request.onerror = () => reject('IndexedDB failed');
    });
  }

  function saveFile(file) {
    const tx = db.transaction('files', 'readwrite');
    tx.objectStore('files').put(file);
  }

  function getAllFiles() {
    return new Promise(resolve => {
      const tx = db.transaction('files', 'readonly');
      const request = tx.objectStore('files').getAll();
      request.onsuccess = () => resolve(request.result);
    });
  }

  // ================================
  // FILE HELPERS
  // ================================
  function detectLanguage(filename) {
    if (filename.endsWith('.html')) return 'html';
    if (filename.endsWith('.css')) return 'css';
    if (filename.endsWith('.js')) return 'javascript';
    if (filename.endsWith('.py')) return 'python';
    return 'plaintext';
  }

  async function seedFiles() {
    const files = await getAllFiles();
    if (files.length === 0) {
      saveFile({
        id: 'index.html',
        language: 'html',
        content: `<!DOCTYPE html>
<html>
<body>
  <h1>Hello Zero-Latency IDE 🚀</h1>
</body>
</html>`
      });

      saveFile({
        id: 'style.css',
        language: 'css',
        content: `body {
  font-family: sans-serif;
}`
      });

      saveFile({
        id: 'app.js',
        language: 'javascript',
        content: `console.log("Hello World");`
      });
    }
  }

  // ================================
  // FILE EXPLORER
  // ================================
  async function renderFileTree() {
    const tree = document.getElementById('file-tree');
    tree.innerHTML = '';

    const files = await getAllFiles();

    files.forEach(file => {
      const li = document.createElement('li');
      li.className = 'file';
      li.textContent = file.id;
      li.onclick = () => openFile(file);
      tree.appendChild(li);
    });
  }

  // ================================
  // TAB SYSTEM (CORE FEATURE)
  // ================================
  function openFile(file) {
    if (openTabs.has(file.id)) {
      switchTab(file.id);
      return;
    }

    const model = monaco.editor.createModel(
      file.content,
      file.language
    );

    openTabs.set(file.id, {
      model,
      cursorPosition: null
    });

    createTab(file.id);
    switchTab(file.id);
  }

  function createTab(filename) {
    const tabs = document.getElementById('tabs');

    const tab = document.createElement('div');
    tab.className = 'tab';
    tab.dataset.file = filename;
    tab.innerHTML = `
      ${filename}
      <span class="close">✕</span>
    `;

    tab.onclick = e => {
      if (e.target.classList.contains('close')) {
        closeTab(filename);
        e.stopPropagation();
      } else {
        switchTab(filename);
      }
    };

    tabs.appendChild(tab);
  }

  function switchTab(filename) {
    if (activeFile && openTabs.has(activeFile)) {
      openTabs.get(activeFile).cursorPosition =
        editor.getPosition();
    }

    activeFile = filename;
    const { model, cursorPosition } = openTabs.get(filename);

    editor.setModel(model);
    if (cursorPosition) editor.setPosition(cursorPosition);

    highlightActiveTab(filename);
  }

  function highlightActiveTab(filename) {
    document.querySelectorAll('.tab').forEach(tab => {
      tab.classList.toggle(
        'active',
        tab.dataset.file === filename
      );
    });
  }

  function closeTab(filename) {
    const tabData = openTabs.get(filename);
    if (!tabData) return;

    tabData.model.dispose();
    openTabs.delete(filename);

    document
      .querySelector(`.tab[data-file="${filename}"]`)
      ?.remove();

    if (activeFile === filename) {
      const next = openTabs.keys().next().value;
      if (next) {
        switchTab(next);
      } else {
        editor.setModel(null);
        activeFile = null;
      }
    }
  }

  // ================================
  // CREATE NEW FILE
  // ================================
  document.getElementById('new-file-btn').onclick = async () => {
    const name = prompt('Enter file name');
    if (!name) return;

    saveFile({
      id: name,
      language: detectLanguage(name),
      content: ''
    });

    await renderFileTree();
  };

  // ================================
  // INIT IDE
  // ================================
  (async function initIDE() {
    await openDB();
    await seedFiles();
    await renderFileTree();

    const files = await getAllFiles();
    if (files.length) openFile(files[0]);
  })();

});
