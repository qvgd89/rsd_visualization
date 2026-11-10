// Loading and parsing of the galaxy table.
// The file is plain text with one galaxy per row. Columns may be separated by
// whitespace or commas. The first non-empty line is the header; a leading '#'
// is allowed (e.g. "# Y Z V_Z M_s ...").

export async function loadTable(url, onProgress) {
  const resp = await fetch(url);
  if (!resp.ok) throw new Error(`Could not load ${url}: HTTP ${resp.status}`);

  let text;
  const total = Number(resp.headers.get('Content-Length')) || 0;
  if (resp.body && resp.body.getReader && onProgress) {
    const reader = resp.body.getReader();
    const chunks = [];
    let received = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(value);
      received += value.length;
      onProgress(received, total);
    }
    const buf = new Uint8Array(received);
    let off = 0;
    for (const c of chunks) { buf.set(c, off); off += c.length; }
    text = new TextDecoder().decode(buf);
  } else {
    text = await resp.text();
  }
  return parseTable(text);
}

export function parseTable(text) {
  const lines = text.split(/\r?\n/);
  let li = 0;
  while (li < lines.length && lines[li].trim() === '') li++;
  const headerLine = lines[li++].replace(/^\s*#\s*/, '').trim();
  // Decide on the separator from the first data row (a stray comma in the
  // header should not turn a whitespace-separated file into a CSV)
  let firstRow = '';
  for (let k = li; k < lines.length; k++) {
    const t = lines[k].trim();
    if (t && t[0] !== '#') { firstRow = t; break; }
  }
  const sep = firstRow.includes(',') ? /\s*,\s*|\s+/ : /\s+/;
  const names = headerLine.split(/\s*,\s*|\s+/).filter((s) => s.length);

  const rows = [];
  for (; li < lines.length; li++) {
    const s = lines[li].trim();
    if (!s || s[0] === '#') continue;
    rows.push(s);
  }

  const n = rows.length;
  const columns = {};
  for (const nm of names) columns[nm] = new Float64Array(n);
  const cols = names.map((nm) => columns[nm]);
  for (let i = 0; i < n; i++) {
    const parts = rows[i].split(sep);
    for (let j = 0; j < cols.length; j++) cols[j][i] = parseFloat(parts[j]);
  }
  return { n, names, columns };
}
