// ================================
// GITHUB PAGES FIX (WORKER PROXY)
// ================================
window.MonacoEnvironment = {
  getWorkerUrl: function (workerId, label) {
    return `data:text/javascript;charset=utf-8,${encodeURIComponent(`
      self.MonacoEnvironment = {
        baseUrl: 'https://unpkg.com/monaco-editor@0.45.0/min/'
      };
      importScripts('https://unpkg.com/monaco-editor@0.45.0/min/vs/base/worker/workerMain.js');`
    )}`;
  }
};

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
  const openTabs = new Map(); // filename -> { model, cursorPosition, dirty, element }
  let activeFile = null;
  let debounceTimer = null;
  let splitViewActive = false;
  let secondaryEditor = null;
  let panelHeight = 200;
  let currentTheme = localStorage.getItem('ide-theme') || 'one-dark';
  let currentActivity = 'explorer';
  let currentPanel = 'problems';

  // DOM Elements
  const previewFrame = document.getElementById('preview-frame');
  const previewOverlay = document.getElementById('preview-overlay');
  const activityItems = document.querySelectorAll('.activity-item');
  const sidebarViews = document.querySelectorAll('.sidebar-view');
  const panelTabs = document.querySelectorAll('.panel-tab');
  const panelViews = document.querySelectorAll('.panel-view');
  const themeToggleBtn = document.getElementById('theme-toggle');
  const newFileBtn = document.getElementById('new-file-btn');
  const newFolderBtn = document.getElementById('new-folder-btn');
  const refreshBtn = document.getElementById('refresh-btn');
  const collapseAllBtn = document.getElementById('collapse-all-btn');
  const splitEditorBtn = document.getElementById('split-editor-btn');
  const closeAllTabsBtn = document.getElementById('close-all-tabs-btn');
  const previewRefreshBtn = document.getElementById('preview-refresh-btn');
  const previewExternalBtn = document.getElementById('preview-external-btn');
  const previewToggleBtn = document.getElementById('preview-toggle-btn');
  const startDebugBtn = document.getElementById('start-debug-btn');
  const welcomeCloseBtn = document.getElementById('welcome-close-btn');
  const fileTree = document.getElementById('file-tree');
  const tabsContainer = document.getElementById('tabs-container');
  const statusCursor = document.getElementById('cursor-position');
  const languageStatus = document.getElementById('language-status');
  const gitBranchStatus = document.getElementById('git-branch-status');
  const problemsStatus = document.getElementById('problems-status');
  const zoomLevel = document.getElementById('zoom-level').querySelector('span');
  const zoomOutBtn = document.getElementById('zoom-out-btn');
  const zoomInBtn = document.getElementById('zoom-in-btn');
  const panelResizer = document.querySelector('.panel-resizer');
  const panel = document.getElementById('panel');
  const welcomeScreen = document.getElementById('welcome-screen');
  const quickInputOverlay = document.getElementById('quick-input-overlay');
  const commandInput = document.getElementById('command-input');
  const commandList = document.getElementById('command-list');
  const contextMenu = document.getElementById('context-menu');
  const notificationCenter = document.getElementById('notification-center');

  // ================================
  // MONACO EDITOR SETUP
  // ================================
  monaco.editor.defineTheme('one-dark', {
    base: 'vs-dark',
    inherit: true,
    rules: [
      { token: 'comment', foreground: '6a9955' },
      { token: 'keyword', foreground: '569cd6' },
      { token: 'string', foreground: 'ce9178' },
      { token: 'number', foreground: 'b5cea8' }
    ],
    colors: { 
      'editor.background': '#1e1e1e',
      'editor.lineHighlightBackground': '#2a2d2e',
      'editorLineNumber.foreground': '#858585',
      'editorCursor.foreground': '#aeafad',
      'editor.selectionBackground': '#264f78',
      'editor.inactiveSelectionBackground': '#3a3d41'
    }
  });

  monaco.editor.defineTheme('high-contrast', {
    base: 'hc-black',
    inherit: true,
    rules: [],
    colors: { 
      'editor.background': '#000000',
      'editor.foreground': '#ffffff',
      'editorCursor.foreground': '#ffff00'
    }
  });

  monaco.editor.defineTheme('light', {
    base: 'vs',
    inherit: true,
    rules: [
      { token: 'comment', foreground: '008000' },
      { token: 'keyword', foreground: '0000ff' },
      { token: 'string', foreground: 'a31515' }
    ],
    colors: { 
      'editor.background': '#f3f3f3',
      'editor.lineHighlightBackground': '#e8e8e8',
      'editorLineNumber.foreground': '#237893'
    }
  });

  // Create Primary Editor
  window.editor = monaco.editor.create(
    document.getElementById('editor'),
    {
      theme: currentTheme,
      fontSize: 14,
      fontFamily: "'JetBrains Mono', 'Fira Code', monospace",
      minimap: { enabled: false },
      automaticLayout: true,
      wordWrap: 'on',
      padding: { top: 16 },
      tabSize: 2,
      insertSpaces: true,
      renderLineHighlight: 'all',
      scrollBeyondLastLine: false,
      renderWhitespace: 'boundary',
      formatOnPaste: true,
      formatOnType: true,
      suggestOnTriggerCharacters: true,
      acceptSuggestionOnEnter: 'on',
      snippetSuggestions: 'inline'
    }
  );

  // ================================
  // THEME MANAGEMENT
  // ================================
  function setTheme(theme) {
    currentTheme = theme;
    document.documentElement.setAttribute('data-theme', theme);
    
    const themeMap = {
      'one-dark': 'one-dark',
      'high-contrast': 'high-contrast',
      'light': 'light'
    };
    
    monaco.editor.setTheme(themeMap[theme] || 'one-dark');
    localStorage.setItem('ide-theme', theme);
    
    // Update theme icon
    const themeIcon = themeToggleBtn.querySelector('i');
    themeIcon.className = theme === 'one-dark' ? 'fas fa-moon' : 
                         theme === 'light' ? 'fas fa-sun' : 'fas fa-adjust';
  }

  themeToggleBtn.onclick = () => {
    const themes = ['one-dark', 'light', 'high-contrast'];
    const currentIndex = themes.indexOf(currentTheme);
    const nextTheme = themes[(currentIndex + 1) % themes.length];
    setTheme(nextTheme);
  };

  // ================================
  // ACTIVITY BAR & SIDEBAR
  // ================================
  function setActiveActivity(activity) {
    // Update activity items
    activityItems.forEach(item => {
      item.classList.toggle('active', item.dataset.view === activity);
    });
    
    // Update sidebar views
    sidebarViews.forEach(view => {
      view.classList.toggle('active', view.id === `${activity}-view`);
    });
    
    currentActivity = activity;
    localStorage.setItem('last-activity', activity);
  }

  activityItems.forEach(item => {
    item.addEventListener('click', () => {
      if (item.dataset.view === 'profile') {
        // Profile click - open user menu
        showNotification('Profile feature coming soon!');
        return;
      }
      
      if (item.dataset.view === 'theme-toggle') {
        themeToggleBtn.click();
        return;
      }
      
      setActiveActivity(item.dataset.view);
    });
  });

  // ================================
  // PANEL MANAGEMENT
  // ================================
  function setActivePanel(panelName) {
    panelTabs.forEach(tab => {
      tab.classList.toggle('active', tab.dataset.panel === panelName);
    });
    
    panelViews.forEach(view => {
      view.classList.toggle('active', view.id === `${panelName}-panel`);
    });
    
    currentPanel = panelName;
    localStorage.setItem('last-panel', panelName);
  }

  panelTabs.forEach(tab => {
    tab.addEventListener('click', () => {
      setActivePanel(tab.dataset.panel);
    });
  });

  // Panel resizing
  let isResizing = false;
  panelResizer.addEventListener('mousedown', startResize);

  function startResize(e) {
    isResizing = true;
    document.addEventListener('mousemove', resizePanel);
    document.addEventListener('mouseup', stopResize);
    e.preventDefault();
  }

  function resizePanel(e) {
    if (!isResizing) return;
    
    const appHeight = document.getElementById('app').offsetHeight;
    const statusBarHeight = 22;
    const newHeight = appHeight - e.clientY - statusBarHeight;
    
    if (newHeight > 100 && newHeight < appHeight - 200) {
      panelHeight = newHeight;
      panel.style.maxHeight = `${panelHeight}px`;
      panel.style.minHeight = '35px';
    }
  }

  function stopResize() {
    isResizing = false;
    document.removeEventListener('mousemove', resizePanel);
    document.removeEventListener('mouseup', stopResize);
    localStorage.setItem('panel-height', panelHeight);
  }

  // ================================
  // DATABASE (IndexedDB)
  // ================================
  function openDB() {
    return new Promise(resolve => {
      const req = indexedDB.open('zero-latency-ide-v2', 2);
      
      req.onupgradeneeded = e => {
        const db = e.target.result;
        
        if (!db.objectStoreNames.contains('files')) {
          db.createObjectStore('files', { keyPath: 'id' });
        }
        
        if (!db.objectStoreNames.contains('settings')) {
          db.createObjectStore('settings', { keyPath: 'key' });
        }
        
        if (!db.objectStoreNames.contains('recent')) {
          db.createObjectStore('recent', { keyPath: 'id', autoIncrement: true });
        }
      };
      
      req.onsuccess = e => { 
        db = e.target.result; 
        resolve(); 
      };
      
      req.onerror = e => {
        console.error('IndexedDB error:', e.target.error);
        resolve(); // Continue even if DB fails
      };
    });
  }

  const store = (storeName, mode) => db.transaction(storeName, mode).objectStore(storeName);
  
  // File operations
  const saveFileDB = file => store('files', 'readwrite').put(file);
  const deleteFileDB = id => store('files', 'readwrite').delete(id);
  const getAllFiles = () => new Promise(res => {
    const r = store('files', 'readonly').getAll();
    r.onsuccess = () => res(r.result || []);
    r.onerror = () => res([]);
  });
  
  // Settings operations
  const saveSetting = (key, value) => store('settings', 'readwrite').put({ key, value });
  const getSetting = key => new Promise(res => {
    const r = store('settings', 'readonly').get(key);
    r.onsuccess = () => res(r.result ? r.result.value : null);
    r.onerror = () => res(null);
  });

  // ================================
  // HELPER FUNCTIONS
  // ================================
  const detectLanguage = name => {
    const ext = name.split('.').pop().toLowerCase();
    const languageMap = {
      'html': 'html',
      'htm': 'html',
      'css': 'css',
      'js': 'javascript',
      'jsx': 'javascript',
      'ts': 'typescript',
      'tsx': 'typescript',
      'json': 'json',
      'md': 'markdown',
      'py': 'python',
      'php': 'php',
      'java': 'java',
      'cpp': 'cpp',
      'c': 'c',
      'cs': 'csharp',
      'go': 'go',
      'rs': 'rust',
      'rb': 'ruby'
    };
    return languageMap[ext] || 'plaintext';
  };

  const getFileIcon = name => {
    const ext = name.split('.').pop().toLowerCase();
    const iconMap = {
      'html': '<i class="fas fa-code"></i>',
      'htm': '<i class="fas fa-code"></i>',
      'css': '<i class="fab fa-css3-alt"></i>',
      'js': '<i class="fab fa-js-square"></i>',
      'jsx': '<i class="fab fa-react"></i>',
      'ts': '<i class="fas fa-code"></i>',
      'json': '<i class="fas fa-braille"></i>',
      'md': '<i class="fas fa-book"></i>',
      'py': '<i class="fab fa-python"></i>',
      'php': '<i class="fab fa-php"></i>',
      'java': '<i class="fab fa-java"></i>',
      'folder': '<i class="fas fa-folder"></i>'
    };
    return iconMap[ext] || '<i class="fas fa-file"></i>';
  };

  async function seedFiles() {
    const files = await getAllFiles();
    if (files.length > 0) return;
    
    const defaultFiles = [
      {
        id: 'index.html',
        language: 'html',
        content: `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Zero-Latency IDE</title>
  <link rel="stylesheet" href="style.css">
</head>
<body>
  <div class="container">
    <h1>🚀 Welcome to Zero-Latency IDE!</h1>
    <p>This is a browser-based development environment.</p>
    <p>Try editing this file and see the live preview update!</p>
    <button id="demo-btn">Click Me</button>
  </div>
  <script src="script.js"></script>
</body>
</html>`
      },
      {
        id: 'style.css',
        language: 'css',
        content: `/* Main Styles */
body {
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Oxygen, Ubuntu, sans-serif;
  margin: 0;
  padding: 20px;
  background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
  color: #333;
  min-height: 100vh;
}

.container {
  max-width: 800px;
  margin: 0 auto;
  background: white;
  padding: 40px;
  border-radius: 20px;
  box-shadow: 0 20px 60px rgba(0,0,0,0.3);
}

h1 {
  color: #667eea;
  margin-bottom: 20px;
}

p {
  font-size: 18px;
  line-height: 1.6;
  margin-bottom: 15px;
}

#demo-btn {
  background: #667eea;
  color: white;
  border: none;
  padding: 12px 24px;
  font-size: 16px;
  border-radius: 8px;
  cursor: pointer;
  margin-top: 20px;
  transition: all 0.3s ease;
}

#demo-btn:hover {
  background: #764ba2;
  transform: translateY(-2px);
  box-shadow: 0 5px 15px rgba(0,0,0,0.2);
}`
      },
      {
        id: 'script.js',
        language: 'javascript',
        content: `// Welcome to JavaScript!
console.log('Zero-Latency IDE is ready! 🚀');

// Demo button functionality
document.addEventListener('DOMContentLoaded', function() {
  const demoBtn = document.getElementById('demo-btn');
  
  if (demoBtn) {
    demoBtn.addEventListener('click', function() {
      const messages = [
        'Awesome! 🎉',
        'Great click! 👏',
        'You did it! 🚀',
        'Nice work! 💫',
        'Perfect! 🌟'
      ];
      
      const randomMessage = messages[Math.floor(Math.random() * messages.length)];
      demoBtn.textContent = randomMessage;
      
      // Reset after 2 seconds
      setTimeout(() => {
        demoBtn.textContent = 'Click Me Again!';
      }, 2000);
    });
  }
  
  // Log current time
  const now = new Date();
  console.log(\`Page loaded at: \${now.toLocaleTimeString()}\`);
});`
      }
    ];
    
    for (const file of defaultFiles) {
      await saveFileDB(file);
    }
  }

  // ================================
  // FILE TREE MANAGEMENT
  // ================================
  async function renderFileTree() {
    fileTree.innerHTML = '';
    const files = await getAllFiles();
    
    if (files.length === 0) {
      fileTree.innerHTML = `
        <div class="empty-state">
          <i class="fas fa-folder-open"></i>
          <p>No files yet</p>
          <button id="create-sample-btn" class="empty-action">Create Sample Files</button>
        </div>
      `;
      
      document.getElementById('create-sample-btn')?.addEventListener('click', async () => {
        await seedFiles();
        await renderFileTree();
      });
      return;
    }
    
    files.forEach(file => {
      const li = document.createElement('li');
      li.className = 'file-tree-item';
      if (file.id === activeFile) li.classList.add('selected');
      li.dataset.file = file.id;
      li.title = file.id;
      
      li.innerHTML = `
        <span class="file-icon">${getFileIcon(file.id)}</span>
        <span class="file-name">${file.id}</span>
        <span class="file-status"></span>
      `;
      
      li.addEventListener('click', (e) => {
        if (!e.target.classList.contains('file-name')) {
          openFile(file);
        }
      });
      
      // Double click to rename
      li.addEventListener('dblclick', (e) => {
        if (!e.target.classList.contains('file-name')) return;
        startRename(file.id);
      });
      
      // Context menu
      li.addEventListener('contextmenu', (e) => {
        e.preventDefault();
        showContextMenu(e.clientX, e.clientY, file.id);
      });
      
      fileTree.appendChild(li);
    });
  }

  // ================================
  // TAB MANAGEMENT
  // ================================
  function openFile(file) {
    if (openTabs.has(file.id)) {
      switchTab(file.id);
      return;
    }

    // Create Model
    const model = monaco.editor.createModel(file.content, file.language);
    openTabs.set(file.id, { 
      model, 
      cursorPosition: null, 
      dirty: false,
      element: null
    });
    
    // Add Tab UI
    createTab(file.id);
    switchTab(file.id);
    
    // Update language status
    updateStatusBar();
  }

  function createTab(name) {
    const tab = document.createElement('div');
    tab.className = 'editor-tab';
    tab.dataset.file = name;
    
    tab.innerHTML = `
      <span class="tab-icon">${getFileIcon(name)}</span>
      <span class="tab-name">${name}</span>
      <span class="tab-close"><i class="fas fa-times"></i></span>
    `;
    
    // Store reference
    const tabData = openTabs.get(name);
    if (tabData) {
      tabData.element = tab;
    }
    
    // Handle tab clicks
    tab.addEventListener('click', (e) => {
      if (e.target.closest('.tab-close')) {
        e.stopPropagation();
        closeTab(name);
      } else {
        switchTab(name);
      }
    });
    
    tabsContainer.appendChild(tab);
  }

  function switchTab(name) {
    if (!openTabs.has(name)) return;
    
    // Save previous cursor position
    if (activeFile && openTabs.has(activeFile)) {
      const prevTab = openTabs.get(activeFile);
      prevTab.cursorPosition = editor.getPosition();
      if (prevTab.element) {
        prevTab.element.classList.remove('active');
      }
    }
    
    activeFile = name;
    const tabData = openTabs.get(name);
    
    // Set model and cursor
    editor.setModel(tabData.model);
    if (tabData.cursorPosition) {
      editor.setPosition(tabData.cursorPosition);
    }
    editor.focus();
    
    // Update UI
    if (tabData.element) {
      tabData.element.classList.add('active');
    }
    
    // Update file tree selection
    document.querySelectorAll('.file-tree-item').forEach(item => {
      item.classList.toggle('selected', item.dataset.file === name);
    });
    
    // Update status bar
    updateStatusBar();
    
    // Trigger preview if it's an HTML file
    if (name.endsWith('.html')) {
      updatePreview();
    }
  }

  function closeTab(name) {
    if (!openTabs.has(name)) return;
    
    const tabData = openTabs.get(name);
    
    // Dispose model
    tabData.model.dispose();
    openTabs.delete(name);
    
    // Remove tab element
    if (tabData.element) {
      tabData.element.remove();
    }
    
    // Switch to another tab if needed
    if (activeFile === name) {
      const remaining = Array.from(openTabs.keys());
      if (remaining.length > 0) {
        switchTab(remaining[remaining.length - 1]);
      } else {
        activeFile = null;
        editor.setModel(monaco.editor.createModel('', 'plaintext'));
        updateStatusBar();
      }
    }
  }

  // ================================
  // FILE OPERATIONS
  // ================================
  newFileBtn.addEventListener('click', async () => {
    const name = prompt('Enter file name (include extension):', 'newfile.html');
    if (!name) return;
    
    const files = await getAllFiles();
    if (files.find(f => f.id === name)) {
      showNotification(`File "${name}" already exists!`, 'warning');
      return;
    }
    
    const newFile = { 
      id: name, 
      language: detectLanguage(name), 
      content: '' 
    };
    
    await saveFileDB(newFile);
    await renderFileTree();
    openFile(newFile);
    showNotification(`Created "${name}"`);
  });

  newFolderBtn.addEventListener('click', () => {
    showNotification('Folder creation coming soon!');
  });

  refreshBtn.addEventListener('click', async () => {
    await renderFileTree();
    showNotification('File tree refreshed');
  });

  collapseAllBtn.addEventListener('click', () => {
    // For now, just refresh
    renderFileTree();
  });

  function startRename(filename) {
    const item = document.querySelector(`.file-tree-item[data-file="${filename}"]`);
    if (!item) return;
    
    const nameSpan = item.querySelector('.file-name');
    const originalName = nameSpan.textContent;
    
    const input = document.createElement('input');
    input.type = 'text';
    input.value = originalName;
    input.className = 'rename-input';
    
    nameSpan.replaceWith(input);
    input.focus();
    input.select();
    
    const finishRename = async () => {
      const newName = input.value.trim();
      
      if (!newName || newName === originalName) {
        input.replaceWith(nameSpan);
        return;
      }
      
      if (newName.includes('/') || newName.includes('\\')) {
        showNotification('File names cannot contain slashes', 'error');
        input.replaceWith(nameSpan);
        return;
      }
      
      // Check if file exists
      const files = await getAllFiles();
      if (files.find(f => f.id === newName)) {
        showNotification(`File "${newName}" already exists!`, 'warning');
        input.replaceWith(nameSpan);
        return;
      }
      
      // Get content
      let content = '';
      if (openTabs.has(originalName)) {
        content = openTabs.get(originalName).model.getValue();
        // Close old tab
        closeTab(originalName);
      } else {
        const file = files.find(f => f.id === originalName);
        content = file ? file.content : '';
      }
      
      // Delete old and save new
      await deleteFileDB(originalName);
      const newFile = {
        id: newName,
        language: detectLanguage(newName),
        content: content
      };
      await saveFileDB(newFile);
      
      // Update UI
      await renderFileTree();
      openFile(newFile);
      showNotification(`Renamed to "${newName}"`);
    };
    
    input.addEventListener('blur', finishRename);
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        finishRename();
      } else if (e.key === 'Escape') {
        input.replaceWith(nameSpan);
      }
    });
  }

  // ================================
  // EDITOR FEATURES
  // ================================
  splitEditorBtn.addEventListener('click', () => {
    if (!splitViewActive) {
      // Create secondary editor
      const secondaryPane = document.getElementById('secondary-editor-pane');
      secondaryPane.style.display = 'block';
      
      secondaryEditor = monaco.editor.create(
        document.getElementById('secondary-editor'),
        {
          theme: currentTheme,
          fontSize: 14,
          fontFamily: "'JetBrains Mono', 'Fira Code', monospace",
          minimap: { enabled: false },
          automaticLayout: true,
          wordWrap: 'on',
          padding: { top: 16 }
        }
      );
      
      // Clone current model if exists
      if (activeFile && openTabs.has(activeFile)) {
        const model = openTabs.get(activeFile).model;
        secondaryEditor.setModel(monaco.editor.createModel(
          model.getValue(),
          model.getLanguageId()
        ));
      }
      
      splitViewActive = true;
      splitEditorBtn.innerHTML = '<i class="fas fa-times"></i>';
      splitEditorBtn.title = 'Close Split View';
    } else {
      // Close secondary editor
      if (secondaryEditor) {
        secondaryEditor.dispose();
        secondaryEditor = null;
      }
      
      document.getElementById('secondary-editor-pane').style.display = 'none';
      splitViewActive = false;
      splitEditorBtn.innerHTML = '<i class="fas fa-columns"></i>';
      splitEditorBtn.title = 'Split Editor (Ctrl+\)';
    }
  });

  closeAllTabsBtn.addEventListener('click', () => {
    if (openTabs.size === 0) return;
    
    if (confirm(`Close all ${openTabs.size} tabs?`)) {
      const tabs = Array.from(openTabs.keys());
      tabs.forEach(tab => closeTab(tab));
    }
  });

  // Editor event listeners
  editor.onDidChangeCursorPosition(e => {
    const position = e.position;
    statusCursor.textContent = `Ln ${position.lineNumber}, Col ${position.column}`;
  });

  editor.onDidChangeModelContent(() => {
    if (!activeFile) return;
    
    const tabData = openTabs.get(activeFile);
    if (!tabData) return;
    
    // Mark as dirty
    if (!tabData.dirty) {
      tabData.dirty = true;
      if (tabData.element) {
        const tabName = tabData.element.querySelector('.tab-name');
        if (tabName) {
          tabName.innerHTML = `${activeFile} <span class="dirty-indicator">●</span>`;
        }
      }
    }
    
    // Debounced preview update
    clearTimeout(debounceTimer);
    debounceTimer = setTimeout(() => {
      if (activeFile && (activeFile.endsWith('.html') || activeFile.endsWith('.css') || activeFile.endsWith('.js'))) {
        updatePreview();
      }
    }, 1000);
  });

  // Save with Ctrl+S
  window.addEventListener('keydown', async (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key === 's') {
      e.preventDefault();
      if (!activeFile) return;
      
      const tabData = openTabs.get(activeFile);
      if (!tabData) return;
      
      const content = tabData.model.getValue();
      await saveFileDB({
        id: activeFile,
        language: tabData.model.getLanguageId(),
        content: content
      });
      
      tabData.dirty = false;
      if (tabData.element) {
        const tabName = tabData.element.querySelector('.tab-name');
        if (tabName) {
          tabName.textContent = activeFile;
        }
      }
      
      showNotification(`Saved "${activeFile}"`, 'success');
    }
    
    // Split editor with Ctrl+\
    if ((e.ctrlKey || e.metaKey) && e.key === '\\') {
      e.preventDefault();
      splitEditorBtn.click();
    }
    
    // Command palette with Ctrl+Shift+P
    if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key === 'p') {
      e.preventDefault();
      toggleCommandPalette();
    }
    
    // Quick preview refresh with Ctrl+F5
    if ((e.ctrlKey || e.metaKey) && e.key === 'F5') {
      e.preventDefault();
      updatePreview();
    }
  });

  // ================================
  // LIVE PREVIEW
  // ================================
  previewRefreshBtn.addEventListener('click', updatePreview);
  
  previewExternalBtn.addEventListener('click', () => {
    const previewUrl = previewFrame.src;
    if (previewUrl) {
      window.open(previewUrl, '_blank');
    } else {
      showNotification('No preview available', 'warning');
    }
  });
  
  previewToggleBtn.addEventListener('click', () => {
    const previewPanel = document.getElementById('preview-panel');
    previewPanel.style.display = previewPanel.style.display === 'none' ? 'flex' : 'none';
  });

  async function updatePreview() {
    const files = await getAllFiles();
    
    // Show loading overlay
    previewOverlay.style.display = 'flex';
    
    // Get content from open tabs or saved files
    const getContent = (filename) => {
      if (openTabs.has(filename)) {
        return openTabs.get(filename).model.getValue();
      }
      const file = files.find(f => f.id === filename);
      return file ? file.content : '';
    };
    
    const html = getContent('index.html') || 
                 files.find(f => f.id.endsWith('.html'))?.content || 
                 '<h1>No HTML file found</h1><p>Create an index.html file to see preview</p>';
    
    const cssFiles = files.filter(f => f.id.endsWith('.css'));
    const css = cssFiles.map(f => getContent(f.id)).join('\n');
    
    const jsFiles = files.filter(f => f.id.endsWith('.js'));
    const js = jsFiles.map(f => getContent(f.id)).join('\n');
    
    const source = `
      <!DOCTYPE html>
      <html>
        <head>
          <meta charset="UTF-8">
          <meta name="viewport" content="width=device-width, initial-scale=1.0">
          <style>
            body { margin: 0; padding: 20px; font-family: sans-serif; }
            ${css}
          </style>
        </head>
        <body>
          ${html}
          <script>
            // Wrap in try-catch to prevent preview errors
            try {
              ${js}
            } catch (err) {
              console.error('Preview error:', err);
            }
            
            // Auto-hide loading overlay
            setTimeout(() => {
              if (window.parent) {
                window.parent.postMessage({ type: 'previewLoaded' }, '*');
              }
            }, 500);
          </script>
        </body>
      </html>
    `;
    
    previewFrame.srcdoc = source;
    
    // Hide overlay after a delay
    setTimeout(() => {
      previewOverlay.style.display = 'none';
    }, 1000);
  }

  // Listen for preview loaded message
  window.addEventListener('message', (e) => {
    if (e.data.type === 'previewLoaded') {
      previewOverlay.style.display = 'none';
    }
  });

  // ================================
  // STATUS BAR UPDATES
  // ================================
  function updateStatusBar() {
    if (!activeFile) {
      languageStatus.textContent = 'Plain Text';
      return;
    }
    
    const tabData = openTabs.get(activeFile);
    if (!tabData) return;
    
    const language = tabData.model.getLanguageId();
    languageStatus.textContent = language.charAt(0).toUpperCase() + language.slice(1);
    
    // Update file size
    const content = tabData.model.getValue();
    const size = new Blob([content]).size;
    const fileSize = document.getElementById('file-size');
    if (fileSize) {
      fileSize.textContent = formatFileSize(size);
    }
  }

  function formatFileSize(bytes) {
    if (bytes < 1024) return bytes + ' B';
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
    return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
  }

  // Zoom controls
  zoomOutBtn.addEventListener('click', () => {
    const currentSize = parseInt(editor.getOption(monaco.editor.EditorOption.fontSize));
    if (currentSize > 8) {
      editor.updateOptions({ fontSize: currentSize - 1 });
      zoomLevel.textContent = `${currentSize - 1}px`;
      saveSetting('fontSize', currentSize - 1);
    }
  });

  zoomInBtn.addEventListener('click', () => {
    const currentSize = parseInt(editor.getOption(monaco.editor.EditorOption.fontSize));
    if (currentSize < 36) {
      editor.updateOptions({ fontSize: currentSize + 1 });
      zoomLevel.textContent = `${currentSize + 1}px`;
      saveSetting('fontSize', currentSize + 1);
    }
  });

  // ================================
  // COMMAND PALETTE
  // ================================
  const commands = [
    { label: 'New File', icon: 'fa-file', action: () => newFileBtn.click(), shortcut: 'Ctrl+N' },
    { label: 'Save File', icon: 'fa-save', action: () => saveCurrentFile(), shortcut: 'Ctrl+S' },
    { label: 'Run Preview', icon: 'fa-play', action: updatePreview, shortcut: 'Ctrl+F5' },
    { label: 'Toggle Theme', icon: 'fa-palette', action: () => themeToggleBtn.click() },
    { label: 'Split Editor', icon: 'fa-columns', action: () => splitEditorBtn.click(), shortcut: 'Ctrl+\\' },
    { label: 'Command Palette', icon: 'fa-terminal', action: toggleCommandPalette, shortcut: 'Ctrl+Shift+P' },
    { label: 'Refresh Preview', icon: 'fa-sync', action: updatePreview },
    { label: 'Open Settings', icon: 'fa-cog', action: () => setActiveActivity('settings') },
    { label: 'Show Explorer', icon: 'fa-folder', action: () => setActiveActivity('explorer'), shortcut: 'Ctrl+Shift+E' },
    { label: 'Show Search', icon: 'fa-search', action: () => setActiveActivity('search'), shortcut: 'Ctrl+Shift+F' },
    { label: 'Show Terminal', icon: 'fa-terminal', action: () => setActivePanel('terminal'), shortcut: 'Ctrl+`' }
  ];

  async function saveCurrentFile() {
    if (!activeFile) return;
    
    const tabData = openTabs.get(activeFile);
    if (!tabData) return;
    
    const content = tabData.model.getValue();
    await saveFileDB({
      id: activeFile,
      language: tabData.model.getLanguageId(),
      content: content
    });
    
    tabData.dirty = false;
    if (tabData.element) {
      const tabName = tabData.element.querySelector('.tab-name');
      if (tabName) {
        tabName.textContent = activeFile;
      }
    }
    
    showNotification(`Saved "${activeFile}"`, 'success');
  }

  function toggleCommandPalette() {
    const isVisible = quickInputOverlay.style.display !== 'none';
    
    if (!isVisible) {
      quickInputOverlay.style.display = 'flex';
      commandInput.value = '';
      renderCommands(commands);
      commandInput.focus();
    } else {
      quickInputOverlay.style.display = 'none';
      editor.focus();
    }
  }

  function renderCommands(list, query = '') {
    commandList.innerHTML = '';
    
    const filtered = query ? 
      list.filter(cmd => cmd.label.toLowerCase().includes(query.toLowerCase())) : 
      list;
    
    if (filtered.length === 0) {
      commandList.innerHTML = '<div class="quick-input-item">No commands found</div>';
      return;
    }
    
    filtered.forEach((cmd, index) => {
      const item = document.createElement('div');
      item.className = 'quick-input-item' + (index === 0 ? ' selected' : '');
      item.innerHTML = `
        <span class="quick-input-icon"><i class="fas ${cmd.icon || 'fa-code'}"></i></span>
        <span class="quick-input-label">${cmd.label}</span>
        ${cmd.shortcut ? `<span class="quick-input-detail">${cmd.shortcut}</span>` : ''}
      `;
      
      item.addEventListener('click', () => {
        quickInputOverlay.style.display = 'none';
        cmd.action();
      });
      
      commandList.appendChild(item);
    });
  }

  commandInput.addEventListener('input', () => {
    renderCommands(commands, commandInput.value);
  });

  commandInput.addEventListener('keydown', (e) => {
    const items = commandList.querySelectorAll('.quick-input-item');
    const selected = commandList.querySelector('.quick-input-item.selected');
    let index = Array.from(items).indexOf(selected);
    
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      if (index < items.length - 1) {
        items.forEach(item => item.classList.remove('selected'));
        items[index + 1].classList.add('selected');
      }
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      if (index > 0) {
        items.forEach(item => item.classList.remove('selected'));
        items[index - 1].classList.add('selected');
      }
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (selected) {
        selected.click();
      }
    } else if (e.key === 'Escape') {
      e.preventDefault();
      quickInputOverlay.style.display = 'none';
      editor.focus();
    }
  });

  // Close palette when clicking outside
  quickInputOverlay.addEventListener('click', (e) => {
    if (e.target === quickInputOverlay) {
      quickInputOverlay.style.display = 'none';
      editor.focus();
    }
  });

  // ================================
  // CONTEXT MENU
  // ================================
  function showContextMenu(x, y, filename) {
    contextMenu.style.display = 'block';
    contextMenu.style.left = x + 'px';
    contextMenu.style.top = y + 'px';
    
    // Update menu items
    const menuItems = contextMenu.querySelectorAll('.context-menu-item');
    menuItems.forEach(item => {
      item.onclick = async () => {
        contextMenu.style.display = 'none';
        
        switch (item.dataset.action) {
          case 'rename':
            startRename(filename);
            break;
          case 'delete':
            if (confirm(`Delete "${filename}"?`)) {
              await deleteFileDB(filename);
              if (openTabs.has(filename)) {
                closeTab(filename);
              }
              await renderFileTree();
              showNotification(`Deleted "${filename}"`);
            }
            break;
          case 'new-file':
            newFileBtn.click();
            break;
          case 'download':
            downloadFile(filename);
            break;
          case 'reveal-in-explorer':
            showNotification('Reveal in Explorer coming soon!');
            break;
        }
      };
    });
  }

  async function downloadFile(filename) {
    const files = await getAllFiles();
    const file = files.find(f => f.id === filename);
    
    if (!file) {
      showNotification(`File "${filename}" not found`, 'error');
      return;
    }
    
    const blob = new Blob([file.content], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    
    showNotification(`Downloaded "${filename}"`);
  }

  // Close context menu on click elsewhere
  document.addEventListener('click', () => {
    contextMenu.style.display = 'none';
  });

  // ================================
  // NOTIFICATIONS
  // ================================
  function showNotification(message, type = 'info') {
    const notification = document.createElement('div');
    notification.className = `notification ${type}`;
    notification.innerHTML = `
      <i class="fas ${type === 'success' ? 'fa-check-circle' : 
                    type === 'warning' ? 'fa-exclamation-triangle' : 
                    type === 'error' ? 'fa-times-circle' : 'fa-info-circle'}"></i>
      <span>${message}</span>
    `;
    
    document.body.appendChild(notification);
    
    // Animate in
    setTimeout(() => {
      notification.style.opacity = '1';
      notification.style.transform = 'translateX(0)';
    }, 10);
    
    // Remove after delay
    setTimeout(() => {
      notification.style.opacity = '0';
      notification.style.transform = 'translateX(100%)';
      setTimeout(() => {
        if (notification.parentNode) {
          notification.parentNode.removeChild(notification);
        }
      }, 300);
    }, 3000);
  }

  // ================================
  // WELCOME SCREEN
  // ================================
  welcomeCloseBtn.addEventListener('click', () => {
    welcomeScreen.style.display = 'none';
    localStorage.setItem('welcome-shown', 'true');
  });

  // ================================
  // DRAG & DROP
  // ================================
  window.addEventListener('dragover', (e) => {
    e.preventDefault();
    if (e.dataTransfer.types.includes('Files')) {
      document.body.classList.add('drag-over');
    }
  });

  window.addEventListener('dragleave', (e) => {
    if (!e.relatedTarget || e.relatedTarget.nodeName === 'HTML') {
      document.body.classList.remove('drag-over');
    }
  });

  window.addEventListener('drop', async (e) => {
    e.preventDefault();
    document.body.classList.remove('drag-over');
    
    if (e.dataTransfer.files.length > 0) {
      for (const file of e.dataTransfer.files) {
        if (file.type.startsWith('text/') || 
            file.name.endsWith('.html') || 
            file.name.endsWith('.css') || 
            file.name.endsWith('.js')) {
          
          const content = await file.text();
          const newFile = {
            id: file.name,
            language: detectLanguage(file.name),
            content: content
          };
          
          await saveFileDB(newFile);
          showNotification(`Imported "${file.name}"`);
        }
      }
      
      await renderFileTree();
    }
  });

  // ================================
  // INITIALIZATION
  // ================================
  (async () => {
    // Initialize database
    await openDB();
    
    // Apply saved settings
    const savedTheme = await getSetting('theme') || 'one-dark';
    setTheme(savedTheme);
    
    const savedFontSize = await getSetting('fontSize');
    if (savedFontSize) {
      editor.updateOptions({ fontSize: savedFontSize });
    }
    
    // Restore panel height
    const savedPanelHeight = localStorage.getItem('panel-height');
    if (savedPanelHeight) {
      panelHeight = parseInt(savedPanelHeight);
      panel.style.maxHeight = `${panelHeight}px`;
    }
    
    // Seed files if empty
    await seedFiles();
    
    // Render file tree
    await renderFileTree();
    
    // Set initial activity
    const lastActivity = localStorage.getItem('last-activity') || 'explorer';
    setActiveActivity(lastActivity);
    
    // Set initial panel
    const lastPanel = localStorage.getItem('last-panel') || 'problems';
    setActivePanel(lastPanel);
    
    // Open index.html by default
    const files = await getAllFiles();
    const index = files.find(f => f.id === 'index.html');
    if (index) {
      openFile(index);
    }
    
    // Show welcome screen on first visit
    const welcomeShown = localStorage.getItem('welcome-shown');
    if (!welcomeShown) {
      welcomeScreen.style.display = 'flex';
    }
    
    // Initial preview
    setTimeout(updatePreview, 500);
    
    // Add notification CSS
    const notificationStyles = document.createElement('style');
    notificationStyles.textContent = `
      .notification {
        position: fixed;
        top: 20px;
        right: 20px;
        background: var(--bg-sidebar);
        border: 1px solid var(--border);
        border-left: 4px solid var(--accent);
        padding: 12px 16px;
        border-radius: 4px;
        display: flex;
        align-items: center;
        gap: 10px;
        z-index: 10000;
        box-shadow: 0 4px 12px rgba(0,0,0,0.3);
        transform: translateX(100%);
        opacity: 0;
        transition: all 0.3s ease;
        max-width: 300px;
      }
      
      .notification.success {
        border-left-color: var(--success);
      }
      
      .notification.warning {
        border-left-color: var(--warning);
      }
      
      .notification.error {
        border-left-color: var(--danger);
      }
      
      .notification i {
        font-size: 16px;
      }
      
      .drag-over {
        box-shadow: inset 0 0 0 3px var(--accent) !important;
      }
      
      .empty-state {
        padding: 40px 20px;
        text-align: center;
        color: var(--text-secondary);
      }
      
      .empty-state i {
        font-size: 48px;
        margin-bottom: 16px;
        opacity: 0.5;
      }
      
      .empty-action {
        background: var(--accent);
        color: white;
        border: none;
        padding: 8px 16px;
        border-radius: 4px;
        cursor: pointer;
        margin-top: 16px;
        font-size: 14px;
      }
    `;
    document.head.appendChild(notificationStyles);
    
    console.log('Zero-Latency IDE initialized! 🚀');
  })();
});