// Minimal CSV exporter (RFC 4180-ish, Excel-friendly with BOM).

function escapeCell(v) {
  if (v === null || v === undefined) return "";
  let s = String(v);
  if (typeof v === "boolean") s = v ? "TRUE" : "FALSE";
  if (/[",\n\r]/.test(s)) {
    s = `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

export function rowsToCsv(rows, columns) {
  if (!rows || rows.length === 0) return "";
  const cols = columns || Object.keys(rows[0]);
  const header = cols.map(escapeCell).join(",");
  const lines = rows.map((r) => cols.map((c) => escapeCell(r[c])).join(","));
  // Add BOM so Excel opens UTF-8 correctly.
  return "﻿" + [header, ...lines].join("\r\n");
}
