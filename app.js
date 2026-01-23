// Configure Monaco base path
require.config({
  paths: {
    vs: 'https://unpkg.com/monaco-editor@0.45.0/min/vs'
  }
});

// Load Monaco Editor
require(['vs/editor/editor.main'], () => {

  window.editor = monaco.editor.create(
    document.getElementById('editor'),
    {
      value: `<!DOCTYPE html>
<html>
  <head>
    <title>Zero Latency IDE</title>
  </head>
  <body>
    <h1>Hello, World 🚀</h1>
  </body>
</html>`,
      language: 'html',
      theme: 'vs-dark',
      fontSize: 14,
      minimap: { enabled: false },
      automaticLayout: true
    }
  );

});
