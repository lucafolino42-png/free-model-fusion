import { readFileSync, writeFileSync } from 'fs';

let html = readFileSync('public/index.html', 'utf-8');

// 1. Add accordion CSS
const accordionCSS = `
/* ── Provider Accordion (Model Groups) ────────────── */
.prov-group{border:1px solid var(--border);border-radius:var(--radius);margin-bottom:8px;overflow:hidden;transition:border-color .2s}
.prov-group:hover{border-color:rgba(255,255,255,.12)}
.prov-header{display:flex;align-items:center;gap:10px;padding:12px 16px;cursor:pointer;background:var(--bg-card);border:none;width:100%;text-align:left;color:var(--text-primary);font-family:var(--font-sans);font-size:14px;font-weight:600;transition:background .15s}
.prov-header:hover{background:var(--bg-card-hover)}
.prov-header .arrow{font-size:12px;transition:transform .2s;color:var(--text-muted);flex-shrink:0;width:16px;text-align:center}
.prov-header.open .arrow{transform:rotate(90deg)}
.prov-header .prov-label{flex:1;min-width:0}
.prov-header .prov-count{font-size:11px;font-weight:400;color:var(--text-muted);background:var(--bg-input);padding:2px 8px;border-radius:999px}
.prov-header .prov-discover{font-size:11px;padding:3px 10px;border-radius:var(--radius-sm);background:rgba(129,140,248,.12);color:var(--accent);border:1px solid transparent;cursor:pointer;transition:all .15s;font-family:var(--font-sans);font-weight:500}
.prov-header .prov-discover:hover{background:rgba(129,140,248,.2)}
.prov-header .prov-discover:disabled{opacity:.5;cursor:wait}
.prov-body{display:none;border-top:1px solid var(--border);padding:4px 0;background:rgba(0,0,0,.15)}
.prov-body.open{display:block}
.prov-body .model-item{display:flex;align-items:center;gap:8px;padding:8px 16px;font-size:13px;transition:background .1s}
.prov-body .model-item:hover{background:var(--bg-card-hover)}
.prov-body .model-item .m-status{font-size:12px;width:18px;text-align:center}
.prov-body .model-item .m-key{font-family:var(--font-mono);font-size:12px;font-weight:500;color:var(--accent);min-width:0;flex:1;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.prov-body .model-item .m-meta{font-size:11px;color:var(--text-muted);display:flex;gap:8px;flex-shrink:0}
.prov-body .model-item .m-meta .m-tag{font-size:10px;padding:1px 6px;border-radius:3px;background:var(--bg-input);color:var(--text-muted)}
.prov-body .model-item .m-actions{display:flex;gap:4px;flex-shrink:0}
.prov-group-empty{padding:20px;text-align:center;color:var(--text-muted);font-size:13px}
`;

html = html.replace('</style>', accordionCSS + '\n</style>');

// 2. Replace Models description
html = html.replace(
  'After adding, build a custom model set in <strong>Settings \u2192 Custom Model Combinations</strong>.',
  'Models are grouped by provider \u2014 click a provider to expand and see its models. Use <strong>Discover</strong> to auto-fetch all models from a provider API.'
);

// 3. Replace models table with accordion
const oldTable = 'id="modelsTable"><tr><td colspan="10" style="text-align:center;color:var(--text-muted)">Loading...</td></tr></tbody></table></div>\n        </div>';
const newAccordion = 'id="modelsAccordion" style="margin-bottom:16px">\n          <div style="text-align:center;padding:30px;color:var(--text-muted);font-size:13px">Loading models...</div>\n        </div>';
html = html.replace(oldTable, newAccordion);

// 4. Replace refreshModels
const oldRefresh = "async function refreshModels(){\n  try{\n    const r=await api('/models');const d=await r.json();\n    const t=$('modelsTable');\n    if(!d.models||d.models.length===0){t.innerHTML='<tr><td colspan=\"10\" style=\"text-align:center;color:var(--text-muted)\">No models configured.</td></tr>';return}\n    t.innerHTML=d.models.map(m=>{\n      const en=m.enabled?'\u2705':'\u274c';\n      const key=m.hasCredential?'\U0001f511':'\u274c';\n      return '<tr>'+\n        '<td>'+en+'</td>'+\n        '<td><code class=\"mono\">'+esc(m.id)+'</code></td>'+\n        '<td>'+esc(m.title)+'</td>'+\n        '<td><code class=\"key\">'+esc(m.providerId)+'</code></td>'+\n        '<td><code class=\"key\">'+esc(m.model)+'</code></td>'+\n        '<td>'+esc((m.useAs||[]).join(', '))+'</td>'+\n        '<td><span class=\"tag tag-blue\">'+esc(m.speedClass)+'</span></td>'+\n        '<td><span class=\"tag tag-accent\">'+esc(m.qualityClass)+'</span></td>'+\n        '<td>'+key+'</td>'+\n        '<td>'+(m.isPreset?'':('<button class=\"btn btn-sm btn-danger\" onclick=\"deleteModel(\''+escapeAttr(m.id)+'\')\">Delete</button>'))+'</td>'+\n        '</tr>'\n    }).join('');\n  }catch(e){$('modelsTable').innerHTML='<tr><td colspan=\"10\" style=\"text-align:center;color:var(--red)\">Error loading models.</td></tr>'}\n}";

if(html.includes(oldRefresh)) {
  html = html.replace(oldRefresh, 'async function refreshModels(){ return; }');
}

writeFileSync('public/index.html', html, 'utf-8');
console.log('Patched successfully, wrote ' + html.length + ' chars');
