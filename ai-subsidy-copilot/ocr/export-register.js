// Regenerates the RAG knowledge files from tool-catalog.js so the assistant's eligible-tool
// answers can never drift from what RULE-005~007 actually enforce.
//   node ocr/export-register.js        (or: make sync-tools)
const fs = require('fs');
const path = require('path');
const { TOOL_KNOWLEDGE_BASE, AGGREGATOR_PLATFORMS } = require('./tool-catalog');

const outDir = path.join(__dirname, '..', 'knowledge');
const categoryLabel = { general: 'general', image: 'image', office: 'office', learning: 'learning', other: 'other' };

const eligible = TOOL_KNOWLEDGE_BASE.filter((t) => t.eligible);
const prohibited = TOOL_KNOWLEDGE_BASE.filter((t) => !t.eligible);

let md = `---
document_name: Eligible AI Services Register
version: 2026.2
effective_from: 2026-04-02
effective_to: 2026-10-31
topic: eligible_products
fictional: false
generated_from: ocr/tool-catalog.js
---

# Eligible AI Services Register

> Generated from the rule engine's tool catalog (ocr/tool-catalog.js). Do not edit by hand; run \`make sync-tools\`.
> A tool that is not listed here is NOT automatically eligible or ineligible: it goes to a human reviewer.

`;
for (const t of eligible) {
  md += `## ${t.product_name}\n\n- Company: ${t.company}\n- Category: ${categoryLabel[t.category] || t.category}\n- Region: ${t.country_or_region}\n- Official purchase site: ${t.official_domain}\n- Status: eligible (subscription plans bought from the official site; API, credit, token and points plans are excluded)\n- Policy basis: AI Subsidy Program 2026, Article 5.\n\n`;
}
md += `## Tools that are NOT eligible (prohibited list)\n\nTools developed or operated in Mainland China, Hong Kong or Macau are not eligible.\n\n`;
for (const t of prohibited) {
  md += `### ${t.product_name} — not eligible\n\n- Company: ${t.company}\n- Reason: ${t.prohibited_reason}\n\n`;
}
md += `## Aggregator and reseller platforms\n\nPurchases made through aggregator or reseller platforms are not eligible even for an eligible tool; the receipt must come from the tool's official site. Known platforms: ${AGGREGATOR_PLATFORMS.map((p) => p.name).join(', ')}.\n\n`;
md += `## Tools not on this register\n\nA tool that is not listed is not automatically approved or rejected. The service must say that eligibility cannot be established and refer the claim to a human reviewer. It must not invent a register entry.\n`;
fs.writeFileSync(path.join(outDir, 'eligible_ai_services.md'), md);

const register = TOOL_KNOWLEDGE_BASE.map((t) => ({
  name: t.product_name,
  company: t.company,
  eligible: t.eligible,
  reason: t.prohibited_reason,
  aliases: [...new Set([t.product_name.toLowerCase(), ...t.aliases.map((a) => a.toLowerCase())])],
}));
fs.writeFileSync(path.join(outDir, 'tool_register.json'), JSON.stringify(register, null, 2) + '\n');
console.log(`Wrote ${eligible.length} eligible and ${prohibited.length} prohibited tools.`);
