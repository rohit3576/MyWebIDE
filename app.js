// ================================
// MONACO EDITOR CONFIGURATION
// ================================
require.config({
  paths: { vs: 'https://unpkg.com/monaco-editor@0.45.0/min/vs' }
});

require(['vs/editor/editor.main'], () => {

  // ================================
  // GLOBAL STATE
  // ================================
  let db;
  const openTabs = new Map(); // filename -> { model, cursorPosition, dirty }
  let activeFile = null;

  // DOM Elements
  const previewFrame = document.getElementById('preview-frame');
  const runBtn = document.getElementById('run-btn');
  const newBtn = document.getElementById('new-file-btn');
  const deleteBtn = document.getElementById('delete-file-btn');
  const themeToggleBtn = document.getElementById('theme-toggle');
  const statusCursor = document.getElementById('status-cursor');
  const fileTree = document.getElementById('file-tree');
  const tabsContainer = document.getElementById('tabs');

  // Command Palette
  const paletteOverlay = document.getElementById('command-palette-overlay');
  const paletteInput = document.getElementById('command-input');
  const commandList = document.getElementById('command-list');

  // ================================
  // MONACO THEMES & SETUP
  // ================================
  monaco.editor.defineTheme('one-dark', {
    base: 'vs-dark',
    inherit: true,
    rules: [
      { token: 'comment', foreground: '6a9955' },
      { token: 'keyword', foreground: '569cd6' }
    ],
    colors: { 
      'editor.background': '#1e1e1e',
      'editor.lineHighlightBackground': '#2a2d2e',
      'editorLineNumber.foreground': '#858585'
    }
  });

  monaco.editor.defineTheme('high-contrast', {
    base: 'hc-black',
    inherit: true,
    rules: [],
    colors: { 'editor.background': '#000000' }
  });

  // Create Editor
  window.editor = monaco.editor.create(
    document.getElementById('editor'),
    {
      theme: 'one-dark',
      fontSize: 14,
      fontFamily: "'JetBrains Mono', 'Fira Code', monospace",
      minimap: { enabled: false },
      automaticLayout: true,
      wordWrap: 'on',
      padding: { top: 16 }
    }
  );

  // Update Status Bar on Cursor Change
  editor.onDidChangeCursorPosition(e => {
    statusCursor.textContent = `Ln ${e.position.lineNumber}, Col ${e.position.column}`;
  });

  // ================================
  // THEME ENGINE
  // ================================
  function setTheme(theme) {
    document.documentElement.setAttribute('data-theme', theme);
    monaco.editor.setTheme(theme === 'high-contrast' ? 'high-contrast' : 'one-dark');
    localStorage.setItem('ide-theme', theme);
  }

  themeToggleBtn.onclick = () => {
    const cur = localStorage.getItem('ide-theme') || 'one-dark';
    setTheme(cur === 'one-dark' ? 'high-contrast' : 'one-dark');
  };

  // ================================
  // DATABASE (IndexedDB)
  // ================================
  function openDB() {
    return new Promise(resolve => {
      const req = indexedDB.open('zero-latency-ide', 1);
      req.onupgradeneeded = e =>
        e.target.result.createObjectStore('files', { keyPath: 'id' });
      req.onsuccess = e => { db = e.target.result; resolve(); };
    });
  }

  const store = mode => db.transaction('files', mode).objectStore('files');
  const saveFileDB = file => store('readwrite').put(file);
  const deleteFileDB = id => store('readwrite').delete(id);
  const getAllFiles = () =>
    new Promise(res => {
      const r = store('readonly').getAll();
      r.onsuccess = () => res(r.result);
    });

  // ================================
  // HELPER FUNCTIONS
  // ================================
  const detectLanguage = name =>
    name.endsWith('.html') ? 'html' :
    name.endsWith('.css') ? 'css' :
    name.endsWith('.js') ? 'javascript' : 'plaintext';

  const getFileIcon = name => {
    if (name.endsWith('.html')) return '🌐';
    if (name.endsWith('.css')) return '🎨';
    if (name.endsWith('.js')) return '📜';
    return '📄';
  };

  async function seedFiles() {
    const files = await getAllFiles();
    if (files.length) return;
    
    await saveFileDB({ id: 'index.html', language: 'html', content: '<h1>Hello IDE 🚀</h1>' });
    await saveFileDB({ id: 'style.css', language: 'css', content: 'body {\n  font-family: sans-serif;\n  background: #f4f4f4;\n  color: #333;\n}' });
    await saveFileDB({ id: 'script.js', language: 'javascript', content: 'console.log("System Ready");' });
  }

  // ================================
  // FILE EXPLORER
  // ================================
  async function renderFileTree() {
    fileTree.innerHTML = '';
    const files = await getAllFiles();

    files.forEach(f => {
      const li = document.createElement('li');
      li.className = 'file';
      if (f.id === activeFile) li.classList.add('active');
      li.dataset.file = f.id;
      li.title = f.id; // Tooltip

      // New HTML Structure matching CSS
      li.innerHTML = `
        <span class="file-icon">${getFileIcon(f.id)}</span>
        <span class="file-name">${f.id}</span>
        <input class="rename-input" value="${f.id}" />
      `;

      li.onclick = e => {
        if (!e.target.classList.contains('rename-input')) openFile(f);
      };

      fileTree.appendChild(li);
    });
  }

  // ================================
  // TAB MANAGEMENT
  // ================================
  function openFile(file) {
    if (openTabs.has(file.id)) return switchTab(file.id);

    // Create Model
    const model = monaco.editor.createModel(file.content, file.language);
    openTabs.set(file.id, { model, cursorPosition: null, dirty: false });
    
    // Add Tab UI
    createTab(file.id);
    switchTab(file.id);
  }

  function createTab(name) {
    const tab = document.createElement('div');
    tab.className = 'tab';
    tab.dataset.file = name;

    tab.innerHTML = `
      <span class="dirty-indicator"></span>
      <span class="tab-name">${name}</span>
      <span class="close">✕</span>
    `;

    // Handle Close vs Switch
    tab.onclick = e => {
      e.stopPropagation();
      if (e.target.classList.contains('close')) {
        closeTab(name);
      } else {
        switchTab(name);
      }
    };

    tabsContainer.appendChild(tab);
  }

  function switchTab(name) {
    // Save previous cursor
    if (activeFile && openTabs.has(activeFile)) {
      openTabs.get(activeFile).cursorPosition = editor.getPosition();
    }

    activeFile = name;
    const tabData = openTabs.get(name);
    
    // Restore model and cursor
    editor.setModel(tabData.model);
    if (tabData.cursorPosition) editor.setPosition(tabData.cursorPosition);
    editor.focus();

    // Update UI Classes
    document.querySelectorAll('.tab').forEach(t => 
      t.classList.toggle('active', t.dataset.file === name)
    );
    document.querySelectorAll('.file-tree .file').forEach(f => 
      f.classList.toggle('active', f.dataset.file === name)
    );
  }

  function closeTab(name) {
    if (!openTabs.has(name)) return;

    // Dispose model
    openTabs.get(name).model.dispose();
    openTabs.delete(name);

    // Remove UI
    document.querySelector(`.tab[data-file="${name}"]`)?.remove();

    // Switch to another tab if active was closed
    if (activeFile === name) {
      activeFile = null;
      const keys = [...openTabs.keys()];
      if (keys.length > 0) {
        switchTab(keys[keys.length - 1]);
      } else {
        editor.setModel(null); // Clear editor
      }
    }
  }

  // ================================
  // FILE OPERATIONS
  // ================================
  
  // Create New File
  newBtn.onclick = async () => {
    const name = prompt("Enter file name (e.g. page.html):");
    if (!name) return;
    
    const exists = (await getAllFiles()).find(f => f.id === name);
    if (exists) return alert("File already exists!");

    const newFile = { id: name, language: detectLanguage(name), content: '' };
    await saveFileDB(newFile);
    await renderFileTree();
    openFile(newFile);
  };

  // Delete File
  deleteBtn.onclick = async () => {
    if (!activeFile) return;
    if (!confirm(`Delete ${activeFile}?`)) return;

    await deleteFileDB(activeFile);
    closeTab(activeFile);
    await renderFileTree();
  };

  // Rename Logic (Inline)
  function startRename() {
    if (!activeFile) return;

    // Target input in sidebar
    const input = document.querySelector(`[data-file="${activeFile}"] .rename-input`);
    if (!input) return;

    input.style.display = 'block';
    input.focus();
    // Select filename without extension (simple heuristic)
    const dotIndex = activeFile.lastIndexOf('.');
    input.setSelectionRange(0, dotIndex > 0 ? dotIndex : activeFile.length);

    const commit = async () => {
        const newName = input.value.trim();
        if (newName && newName !== activeFile) {
            await finishRename(newName);
        } else {
            input.style.display = 'none'; // Cancel
        }
    };

    input.onblur = commit;
    input.onkeydown = e => {
      if (e.key === 'Enter') { input.blur(); } // Triggers onblur
      if (e.key === 'Escape') { 
          input.value = activeFile; 
          input.style.display = 'none'; 
      }
    };
  }

  async function finishRename(newName) {
    // Get content from memory (editor) if open, or DB
    let content;
    if (openTabs.has(activeFile)) {
      content = openTabs.get(activeFile).model.getValue();
    } else {
      const files = await getAllFiles();
      content = files.find(f => f.id === activeFile)?.content || '';
    }

    // Delete old, save new
    await deleteFileDB(activeFile);
    const newFile = { id: newName, language: detectLanguage(newName), content };
    await saveFileDB(newFile);

    // Update UI
    closeTab(activeFile);
    await renderFileTree();
    openFile(newFile);
  }

  // ================================
  // EDITOR EVENTS (Dirty State & Save)
  // ================================
  editor.onDidChangeModelContent(() => {
    if (!activeFile) return;
    
    const tabData = openTabs.get(activeFile);
    if (!tabData.dirty) {
      tabData.dirty = true;
      const indicator = document.querySelector(`.tab[data-file="${activeFile}"] .dirty-indicator`);
      if (indicator) indicator.textContent = '●';
    }
  });

  window.addEventListener('keydown', async e => {
    if ((e.ctrlKey || e.metaKey) && e.key === 's') {
      e.preventDefault();
      if (!activeFile) return;

      const tabData = openTabs.get(activeFile);
      const content = tabData.model.getValue();
      
      await saveFileDB({
        id: activeFile,
        language: tabData.model.getLanguageId(),
        content: content
      });

      tabData.dirty = false;
      const indicator = document.querySelector(`.tab[data-file="${activeFile}"] .dirty-indicator`);
      if (indicator) indicator.textContent = '';
      
      // Update Save Status in Toolbar
      const status = document.getElementById('save-status');
      status.textContent = 'Saved';
      setTimeout(() => status.textContent = '', 2000);
    }
  });

  // ================================
  // EXECUTION LOGIC
  // ================================
  runBtn.onclick = async () => {
    const files = await getAllFiles();
    
    // Get content from live editors if available (to run unsaved changes)
    const getContent = (filename) => {
        if (openTabs.has(filename)) return openTabs.get(filename).model.getValue();
        return files.find(f => f.id === filename)?.content || '';
    };

    const html = getContent('index.html');
    const css = files.filter(f => f.id.endsWith('.css')).map(f => getContent(f.id)).join('\n');
    const js = files.filter(f => f.id.endsWith('.js')).map(f => getContent(f.id)).join('\n');

    const source = `
      <!DOCTYPE html>
      <html>
        <head>
          <style>${css}</style>
        </head>
        <body>
          ${html}
          <script>
            try {
              ${js}
            } catch (err) {
              console.error(err);
            }
          </script>
        </body>
      </html>
    `;
    
    previewFrame.srcdoc = source;
  };

  // ================================
  // COMMAND PALETTE
  // ================================
  const commands = [
    { label: '> Run Project', action: () => runBtn.click() },
    { label: '> New File', action: () => newBtn.click() },
    { label: '> Rename File', action: startRename },
    { label: '> Delete File', action: () => deleteBtn.click() },
    { label: '> Toggle Theme', action: () => themeToggleBtn.click() }
  ];

  function togglePalette() {
    const isHidden = paletteOverlay.hidden;
    if (isHidden) {
        paletteOverlay.hidden = false;
        paletteInput.value = '';
        renderCommands(commands);
        paletteInput.focus();
    } else {
        paletteOverlay.hidden = true;
        editor.focus();
    }
  }

  function renderCommands(list) {
    commandList.innerHTML = '';
    list.forEach(cmd => {
      const li = document.createElement('li');
      li.textContent = cmd.label;
      li.onclick = () => {
        paletteOverlay.hidden = true;
        cmd.action();
      };
      commandList.appendChild(li);
    });
  }

  paletteInput.oninput = () => {
    const q = paletteInput.value.toLowerCase();
    renderCommands(commands.filter(c => c.label.toLowerCase().includes(q)));
  };

  window.addEventListener('keydown', e => {
    // Ctrl+Shift+P or F1
    if ((e.ctrlKey && e.shiftKey && e.key.toLowerCase() === 'p') || e.key === 'F1') {
      e.preventDefault();
      togglePalette();
    }
    if (e.key === 'Escape') {
        if (!paletteOverlay.hidden) {
            paletteOverlay.hidden = true;
            editor.focus();
        }
    }
    if (e.key === 'F2') startRename();
  });

  // ================================
  // INITIALIZATION
  // ================================
  (async () => {
    await openDB();
    await seedFiles();
    await renderFileTree();
    setTheme(localStorage.getItem('ide-theme') || 'one-dark');
    
    // Open index.html by default
    const files = await getAllFiles();
    const index = files.find(f => f.id === 'index.html');
    if (index) openFile(index);
  })();

});