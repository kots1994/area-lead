// Lightweight website scraper to enrich Place rows.
// Fetches homepage + likely contact pages, extracts:
//  - emails
//  - contact form URL
//  - meta description / og:description
//  - presence of inquiry form indicators
//
// Defensive: respects robots.txt is OUT OF SCOPE for MVP — we only fetch HTML
// pages the user could view themselves. We don't store fetched content
// permanently and we set a custom UA. We also rate-limit and timeout.

import * as cheerio from "cheerio";

const UA = "AreaLeadBot/0.1 (+https://github.com/kots1994/area-lead)";
const TIMEOUT_MS = 8000;
const MAX_BYTES = 800_000;

const CONTACT_PATHS = [
  "/contact", "/contacts", "/contact-us", "/contactus",
  "/inquiry", "/inquiries",
  "/お問い合わせ", "/contact/",
  "/about", "/company",
];

const EMAIL_RE = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g;

async function fetchHtml(url, signal) {
  try {
    const r = await fetch(url, {
      headers: { "User-Agent": UA, Accept: "text/html,application/xhtml+xml" },
      redirect: "follow",
      signal,
    });
    if (!r.ok) return null;
    const ct = r.headers.get("content-type") || "";
    if (!ct.includes("html")) return null;
    const reader = r.body.getReader();
    let received = 0;
    const chunks = [];
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      received += value.length;
      chunks.push(value);
      if (received >= MAX_BYTES) break;
    }
    const text = new TextDecoder("utf-8", { fatal: false }).decode(
      new Uint8Array(chunks.flatMap((c) => [...c])).slice(0, MAX_BYTES)
    );
    return text;
  } catch {
    return null;
  }
}

function pickEmails(html) {
  if (!html) return [];
  const found = new Set();
  for (const m of html.matchAll(EMAIL_RE)) {
    const email = m[0].toLowerCase();
    if (
      email.endsWith(".png") || email.endsWith(".jpg") ||
      email.endsWith(".gif") || email.endsWith(".svg")
    ) continue;
    if (email.startsWith("noreply@") || email.startsWith("no-reply@")) continue;
    if (email.includes("example.com") || email.includes("sentry.io")) continue;
    found.add(email);
  }
  return [...found].slice(0, 5);
}

function findContactPage($, baseUrl) {
  const links = [];
  $("a[href]").each((_, el) => {
    const href = $(el).attr("href");
    if (!href) return;
    const text = ($(el).text() || "").toLowerCase();
    const lc = href.toLowerCase();
    if (
      /(contact|inquiry|お問い合わせ|問合せ)/i.test(href) ||
      /(contact|inquiry|お問い合わせ|問合せ|reach out|get in touch)/i.test(text)
    ) {
      try { links.push(new URL(href, baseUrl).toString()); } catch {}
    }
  });
  return links[0] || null;
}

function metaDescription($) {
  return (
    $('meta[property="og:description"]').attr("content") ||
    $('meta[name="description"]').attr("content") ||
    ""
  ).trim();
}

function hasInquiryForm($) {
  const forms = $("form").length;
  const hasTextarea = $("textarea").length > 0;
  return forms > 0 && hasTextarea;
}

/**
 * Enrich a single row by fetching its website (and contact page if any).
 */
export async function enrichRow(row) {
  if (!row.website) return { ...row, enrichment_status: "no_website" };

  const ac = new AbortController();
  const t = setTimeout(() => ac.abort(), TIMEOUT_MS);
  try {
    const homeHtml = await fetchHtml(row.website, ac.signal);
    if (!homeHtml) {
      return { ...row, enrichment_status: "fetch_failed" };
    }
    const $home = cheerio.load(homeHtml);
    const meta_description = metaDescription($home);
    const home_emails = pickEmails(homeHtml);
    const contact_url = findContactPage($home, row.website);

    let contact_emails = [];
    let has_inquiry_form = hasInquiryForm($home);
    if (contact_url) {
      const ac2 = new AbortController();
      const t2 = setTimeout(() => ac2.abort(), TIMEOUT_MS);
      try {
        const html2 = await fetchHtml(contact_url, ac2.signal);
        if (html2) {
          contact_emails = pickEmails(html2);
          const $c = cheerio.load(html2);
          if (!has_inquiry_form) has_inquiry_form = hasInquiryForm($c);
        }
      } finally { clearTimeout(t2); }
    }

    const all_emails = [...new Set([...home_emails, ...contact_emails])].slice(0, 5);
    return {
      ...row,
      meta_description,
      contact_url: contact_url || "",
      emails: all_emails.join(";"),
      has_inquiry_form,
      enrichment_status: "ok",
    };
  } catch (e) {
    return { ...row, enrichment_status: `error:${e.message?.slice(0, 50)}` };
  } finally {
    clearTimeout(t);
  }
}

/**
 * Enrich rows with limited concurrency.
 */
export async function enrichRows(rows, { concurrency = 4 } = {}) {
  const out = new Array(rows.length);
  let next = 0;
  async function worker() {
    while (true) {
      const i = next++;
      if (i >= rows.length) return;
      out[i] = await enrichRow(rows[i]);
    }
  }
  await Promise.all(Array.from({ length: concurrency }, worker));
  return out;
}
