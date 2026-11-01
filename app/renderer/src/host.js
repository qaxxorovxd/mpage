// File system access: the preload API inside Electron, file inputs and downloads in a plain browser.

function pickViaInput(accept, multiple) {
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = accept;
    input.multiple = multiple;
    input.onchange = async () => {
      resolve(await Promise.all([...input.files].map(async (f) => ({ name: f.name, data: new Uint8Array(await f.arrayBuffer()) }))));
    };
    input.oncancel = () => resolve([]);
    input.click();
  });
}

function download(name, data, type) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([data], { type }));
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  return true;
}

const web = {
  readFile: async (url) => {
    const r = await fetch(url);
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    return { path: null, data: new Uint8Array(await r.arrayBuffer()) };
  },
  pickFile: async () => (await pickViaInput('.mpage', false))[0] || null,
  pickFiles: () => pickViaInput('*/*', true),
  readFolder: async () => null,
  saveFile: async ({ data, title }) => download(`${title || 'archive'}.mpage`, data, 'application/x-mpage'),
  exportFile: async ({ name, data }) => download(name, data, 'application/octet-stream'),
  examplePath: async () => 'examples/demo.mpage',
  pathForFile: () => null,
  setTitle: (t) => (document.title = t),
  setLanguage: () => {},
  onOpenFile: () => {},
};

export const host = window.mpageHost || web;
