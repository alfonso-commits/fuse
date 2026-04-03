// ============================================================
// classifier.gs — Credit Union classification (3-step logic)
// ============================================================

var CLAUDE_API_KEY = PropertiesService.getScriptProperties().getProperty('CLAUDE_API_KEY') || '';
var CLAUDE_API_URL = 'https://api.anthropic.com/v1/messages';

// ── Step 1: Company Type field ────────────────────────────────
// Returns true (is CU), false (explicitly not CU), null (blank/unknown)
function isCreditUnionByType(companyType) {
  if (!companyType || companyType.trim() === '') return null;
  return /credit\s*union/i.test(companyType.trim());
}

// ── Step 2: Name-based regex ──────────────────────────────────
// Returns true (clear CU indicator), null (unclear)
function isCuByName(name) {
  if (!name) return null;
  var n = name.trim();
  if (/\bcredit\s+union\b/i.test(n))   return true;
  if (/\bfederal\s+credit\b/i.test(n)) return true;
  if (/\bfcu\b/i.test(n))              return true;
  if (/\bccu\b/i.test(n))              return true;
  if (/\bpcu\b/i.test(n))              return true;
  if (/\s+cu\s*$/i.test(n))            return true; // ends with " CU"
  if (/^cu\s+/i.test(n))               return true; // starts with "CU "
  return null;
}

// ── Step 3: Batch Claude API classification ───────────────────
// companiesInfo = [{name, domain}, ...]
// Returns array of 'Credit Union' | 'Bank' | 'Finance Company'
function batchClassifyWithClaude(companiesInfo) {
  if (!companiesInfo || companiesInfo.length === 0) return [];

  var list = companiesInfo.map(function(c, i) {
    var line = (i + 1) + '. ' + (c.name || 'Unknown');
    if (c.domain) line += ' (website: ' + c.domain + ')';
    return line;
  }).join('\n');

  var prompt =
    'You are a financial industry expert with comprehensive knowledge of US financial ' +
    'institutions. For each institution below, classify it as exactly one of:\n' +
    '  "Credit Union"    — nonprofit, member-owned cooperative\n' +
    '  "Bank"            — for-profit depository institution\n' +
    '  "Finance Company" — financial services but not a depository institution\n\n' +
    'Use the name, website domain, and your knowledge of known institutions.\n\n' +
    'Institutions:\n' + list + '\n\n' +
    'Return ONLY a valid JSON array, one object per institution in the same order:\n' +
    '[{"type":"Credit Union"},{"type":"Bank"},{"type":"Finance Company"},...]';

  var payload = {
    model: 'claude-opus-4-6',
    max_tokens: 2048,
    thinking: { type: 'adaptive' },
    messages: [{ role: 'user', content: prompt }]
  };

  var resp = UrlFetchApp.fetch(CLAUDE_API_URL, {
    method: 'post',
    contentType: 'application/json',
    headers: {
      'x-api-key': CLAUDE_API_KEY,
      'anthropic-version': '2023-06-01'
    },
    payload: JSON.stringify(payload),
    muteHttpExceptions: true
  });

  if (resp.getResponseCode() !== 200) {
    throw new Error('Claude API error ' + resp.getResponseCode() + ': ' + resp.getContentText());
  }

  var data = JSON.parse(resp.getContentText());

  // Adaptive thinking returns a thinking block then a text block — find the text block
  var text = '';
  (data.content || []).forEach(function(block) {
    if (block.type === 'text') text = block.text.trim();
  });

  var jsonMatch = text.match(/\[[\s\S]*\]/);
  if (!jsonMatch) throw new Error('Claude unexpected format: ' + text.substring(0, 300));

  var results = JSON.parse(jsonMatch[0]);
  return results.map(function(r) { return r.type || ''; });
}

// ── Main filter ───────────────────────────────────────────────
// Returns only the deals associated with a Credit Union.
//
// @param {object[]}  deals             Raw deal objects from HubSpot
// @param {object[]}  dealPropDefs      Ordered deal property definitions (to resolve "Company Type" internal name)
// @param {object}    dealToCompanyMap  { dealId: [{id, isPrimary}] }
// @param {object}    companyDataMap    { companyId: { properties: {...} } }
function filterCreditUnionDeals(deals, dealPropDefs, dealToCompanyMap, companyDataMap) {

  // Resolve "Company Type" internal property name
  var companyTypeProp = null;
  (dealPropDefs || []).forEach(function(d) {
    if (d.label.toLowerCase() === 'company type') companyTypeProp = d.name;
  });

  var definite   = [];  // confirmed credit unions
  var needClaude = [];  // ambiguous — need Claude

  deals.forEach(function(deal) {
    // Resolve primary company for this deal
    var assocs  = (dealToCompanyMap[deal.id] || []);
    var primary = assocs.filter(function(a) { return a.isPrimary; })[0] || assocs[0] || null;
    var company = (primary && companyDataMap[primary.id]) ? companyDataMap[primary.id] : null;

    var companyType   = companyTypeProp ? (deal.properties[companyTypeProp] || '') : '';
    // companyDataMap stores the properties object directly (not nested under .properties)
    var companyName   = company ? (company.name   || '') : '';
    var companyDomain = company ? (company.domain || '') : '';

    // ── Step 1: Company Type field is set ──────────
    var typeResult = isCreditUnionByType(companyType);
    if (typeResult === true)  { definite.push(deal); return; }
    if (typeResult === false) { return; }               // explicitly not CU, skip

    // ── Step 2: Blank type → check company name ───
    if (isCuByName(companyName) === true) { definite.push(deal); return; }

    // ── Step 3: Still unclear → ask Claude ────────
    needClaude.push({
      deal: deal,
      name: companyName || deal.properties.dealname || 'Unknown',
      domain: companyDomain
    });
  });

  // ── Step 3: Batch call Claude ──────────────────────────────
  if (needClaude.length > 0) {
    console.log('[Classifier] Sending ' + needClaude.length + ' unclear companies to Claude...');
    try {
      var classifications = batchClassifyWithClaude(
        needClaude.map(function(x) { return { name: x.name, domain: x.domain }; })
      );
      needClaude.forEach(function(item, i) {
        var cls = (classifications[i] || '').toLowerCase().trim();
        console.log('[Classifier] "' + item.name + '" → ' + (classifications[i] || 'unknown'));
        if (cls === 'credit union') definite.push(item.deal);
      });
    } catch (e) {
      console.error('[Classifier] Claude call failed — including unclear companies as fallback: ' + e.message);
      // Conservative fallback: include unclear ones so no CU is accidentally dropped
      needClaude.forEach(function(item) { definite.push(item.deal); });
    }
  }

  console.log('[Classifier] Kept ' + definite.length + ' / ' + deals.length + ' deals (Credit Unions only)');
  return definite;
}
