// ================================
// MONACO EDITOR CONFIGURATION
// ================================

// Configure Monaco base path
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
  let currentModel = null;

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
  // FILE EXPLORER UI
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

  function openFile(file) {
    if (currentModel) {
      currentModel.dispose();
    }

    currentModel = monaco.editor.createModel(
      file.content,
      file.language
    );

    editor.setModel(currentModel);
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

    // Open first file by default
    const files = await getAllFiles();
    if (files.length) openFile(files[0]);
  })();

});
