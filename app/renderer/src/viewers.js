// Type-specific views for text files. Everything is HTML-escaped: HTML or scripts inside a file are never
// executed (files from an archive, encrypted or not, are treated as untrusted).

import { t as tr } from '../../../lib/i18n.js';
import { icon } from './icons.js';

const esc = (s) => String(s).replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

/** Text view flavor from file name / MIME type. */
export function textFlavor(name, mime) {
  const ext = (name.split('.').pop() || '').toLowerCase();
  if (ext === 'md' || ext === 'markdown' || mime === 'text/markdown') return 'markdown';
  if (ext === 'json' || mime === 'application/json') return 'json';
  if (ext === 'csv' || ext === 'tsv' || mime === 'text/csv') return 'csv';
  if (['js', 'ts', 'py', 'css', 'html', 'xml', 'yml', 'yaml', 'sh', 'sql', 'ini', 'toml'].includes(ext)) return 'code';
  return 'text';
}

// ---------- Markdown (safe, small subset) ----------
function inline(s) {
  let t = esc(s);
  t = t.replace(/`([^`]+)`/g, '<code>$1</code>');
  t = t.replace(/\*\*([^*]+)\*\*/g, '<b>$1</b>').replace(/__([^_]+)__/g, '<b>$1</b>');
  t = t.replace(/(^|[^*])\*([^*\s][^*]*)\*/g, '$1<i>$2</i>').replace(/(^|[^_\w])_([^_\s][^_]*)_/g, '$1<i>$2</i>');
  t = t.replace(/~~([^~]+)~~/g, '<s>$1</s>');
  // links are shown as text only (no navigation to external sites)
  t = t.replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, '<span class="md-link" title="$2">$1</span>');
  return t;
}

export function renderMarkdown(src) {
  const lines = src.replace(/\r\n?/g, '\n').split('\n');
  const out = [];
  let list = null;
  let para = [];
  const flushPara = () => {
    if (para.length) out.push(`<p>${para.map(inline).join('<br>')}</p>`);
    para = [];
  };
  const flushList = () => {
    if (list) out.push(`</${list}>`);
    list = null;
  };
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (/^```/.test(line)) {
      flushPara();
      flushList();
      const code = [];
      while (++i < lines.length && !/^```/.test(lines[i])) code.push(lines[i]);
      out.push(`<pre class="md-code">${esc(code.join('\n'))}</pre>`);
      continue;
    }
    let m;
    if ((m = /^(#{1,6})\s+(.*)$/.exec(line))) {
      flushPara();
      flushList();
      out.push(`<h${m[1].length}>${inline(m[2])}</h${m[1].length}>`);
    } else if (/^\s*([-*_])(\s*\1){2,}\s*$/.test(line)) {
      flushPara();
      flushList();
      out.push('<hr>');
    } else if ((m = /^\s*[-*+]\s+(\[([ xX])\]\s+)?(.*)$/.exec(line))) {
      flushPara();
      if (list !== 'ul') {
        flushList();
        out.push('<ul>');
        list = 'ul';
      }
      const box = m[1] ? `<span class="md-box">${icon(m[2] === ' ' ? 'square' : 'checkSquare')}</span> ` : '';
      out.push(`<li>${box}${inline(m[3])}</li>`);
    } else if ((m = /^\s*\d+[.)]\s+(.*)$/.exec(line))) {
      flushPara();
      if (list !== 'ol') {
        flushList();
        out.push('<ol>');
        list = 'ol';
      }
      out.push(`<li>${inline(m[1])}</li>`);
    } else if ((m = /^>\s?(.*)$/.exec(line))) {
      flushPara();
      flushList();
      out.push(`<blockquote>${inline(m[1])}</blockquote>`);
    } else if (/^\|.*\|\s*$/.test(line) && /^\|?[\s:-]+\|/.test(lines[i + 1] || '')) {
      flushPara();
      flushList();
      const cells = (l) => l.trim().replace(/^\||\|$/g, '').split('|').map((c) => c.trim());
      const head = cells(line);
      i++;
      const rows = [];
      while (i + 1 < lines.length && /^\|.*\|\s*$/.test(lines[i + 1])) rows.push(cells(lines[++i]));
      out.push(`<table><thead><tr>${head.map((h) => `<th>${inline(h)}</th>`).join('')}</tr></thead><tbody>${
        rows.map((r) => `<tr>${r.map((c) => `<td>${inline(c)}</td>`).join('')}</tr>`).join('')}</tbody></table>`);
    } else if (!line.trim()) {
      flushPara();
      flushList();
    } else {
      flushList();
      para.push(line);
    }
  }
  flushPara();
  flushList();
  return `<article class="md">${out.join('\n')}</article>`;
}

// ---------- JSON tree ----------
function jsonNode(key, v, depth) {
  const k = key === null ? '' : `<span class="j-key">${esc(key)}</span>: `;
  if (v === null) return `<div class="j-row">${k}<span class="j-null">null</span></div>`;
  if (typeof v === 'string') return `<div class="j-row">${k}<span class="j-str">"${esc(v)}"</span></div>`;
  if (typeof v === 'number') return `<div class="j-row">${k}<span class="j-num">${v}</span></div>`;
  if (typeof v === 'boolean') return `<div class="j-row">${k}<span class="j-bool">${v}</span></div>`;
  const isArr = Array.isArray(v);
  const entries = isArr ? v.map((x, i) => [i, x]) : Object.entries(v);
  const summary = isArr ? `[${entries.length}]` : `{${entries.length}}`;
  return `<details ${depth < 2 ? 'open' : ''}><summary>${k}<span class="j-sum">${summary}</span></summary>
    <div class="j-children">${entries.map(([ck, cv]) => jsonNode(isArr ? String(ck) : ck, cv, depth + 1)).join('')}</div></details>`;
}

export function renderJson(src) {
  try {
    const v = JSON.parse(src);
    return `<div class="json-tree">${jsonNode(null, v, 0)}</div>`;
  } catch (e) {
    return `<div class="view-error">${icon('alert', 'xs')}${esc(tr('view.jsonError', { msg: e.message }))}</div>${renderCode(src)}`;
  }
}

// ---------- CSV table ----------
function parseCsv(src) {
  const sep = (src.split('\n')[0].match(/\t/g) || []).length > (src.split('\n')[0].match(/,/g) || []).length ? '\t'
    : (src.split('\n')[0].match(/;/g) || []).length > (src.split('\n')[0].match(/,/g) || []).length ? ';' : ',';
  const rows = [];
  let row = [], cell = '', q = false;
  for (let i = 0; i < src.length; i++) {
    const c = src[i];
    if (q) {
      if (c === '"' && src[i + 1] === '"') { cell += '"'; i++; } else if (c === '"') q = false; else cell += c;
    } else if (c === '"') q = true;
    else if (c === sep) { row.push(cell); cell = ''; } else if (c === '\n') { row.push(cell.replace(/\r$/, '')); rows.push(row); row = []; cell = ''; } else cell += c;
  }
  if (cell || row.length) { row.push(cell); rows.push(row); }
  return rows;
}

export function renderCsv(src) {
  const rows = parseCsv(src).slice(0, 2000);
  if (!rows.length) return renderCode(src);
  const [head, ...body] = rows;
  return `<div class="csv-wrap"><table class="csv"><thead><tr><th>#</th>${head.map((h) => `<th>${esc(h)}</th>`).join('')}</tr></thead>
    <tbody>${body.map((r, i) => `<tr><td class="ln">${i + 1}</td>${r.map((c) => `<td>${esc(c)}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`;
}

// ---------- Code / text (with line numbers) ----------
export function renderCode(src) {
  const lines = src.replace(/\r\n?/g, '\n').split('\n');
  return `<div class="code-view">${lines.map((l, i) => `<div class="cl"><span class="ln">${i + 1}</span><span class="lc">${esc(l) || ' '}</span></div>`).join('')}</div>`;
}

export function renderText(src) {
  return `<pre class="txt-view">${esc(src)}</pre>`;
}

export function renderFlavor(flavor, src) {
  return { markdown: renderMarkdown, json: renderJson, csv: renderCsv, code: renderCode, text: renderText }[flavor](src);
}
