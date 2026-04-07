// ============================================================
// exclusion.gs — Exclusion List (non-CU companies + CSV input)
// ============================================================

var SHEET_NAME_EXCLUSION       = 'Exclusion List';
var SHEET_NAME_EXCLUSION_INPUT = 'Exclusion Input';

// ── Entry point ───────────────────────────────────────────────
function syncExclusionList() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var ui;
  try { ui = SpreadsheetApp.getUi(); } catch (e) { ui = null; }

  function showError(msg) {
    if (ui) ui.alert('Exclusion List Error', msg, ui.ButtonSet.OK);
    else     console.error('Exclusion List Error: ' + msg);
  }

  try {
    getToken();

    // ── 1. Fetch property definitions ──
    ss.toast('Discovering properties...', 'Exclusion List');
    var dealPropDefs    = filterToWantedColumns(fetchAllDealPropertyDefinitions(), DEAL_COLUMNS);
    var companyPropDefs = filterToWantedColumns(fetchAllCompanyPropertyDefinitions(), COMPANY_COLUMNS);
    var dealPropNames    = dealPropDefs.map(function(d) { return d.name; });
    var companyPropNames = companyPropDefs.map(function(d) { return d.name; });
    if (companyPropNames.indexOf('name')   === -1) companyPropNames.push('name');
    if (companyPropNames.indexOf('domain') === -1) companyPropNames.push('domain');

    // Resolve internal property name for "LinkedIn Company Page"
    var linkedinPropName = '';
    companyPropDefs.forEach(function(d) {
      if (d.label.toLowerCase() === 'linkedin company page') linkedinPropName = d.name;
    });

    // ── 2. Fetch ALL deals (all pipelines, all stages, all time) ──
    ss.toast('Fetching all deals...', 'Exclusion List');
    var allDeals = fetchAllDeals(dealPropNames, null);

    if (allDeals.length === 0) {
      ss.toast('No deals found in HubSpot.', 'Exclusion List', 8);
      // Still process CSV input
      var csvCompanies = readExclusionInput();
      var merged = mergeExclusionSources([], csvCompanies);
      ss.toast('Enriching via Apollo...', 'Exclusion List');
      enrichMissingLinkedIn(merged);
      writeExclusionSheet(merged);
      ss.toast('Done! ' + merged.length + ' companies in Exclusion List.', 'Exclusion List', 10);
      return;
    }

    // ── 3. Fetch deal→company associations ──
    var dealIds = allDeals.map(function(d) { return d.id; });

    ss.toast('Fetching company associations...', 'Exclusion List');
    var dealToCompanyMap = fetchDealToCompanyAssociations(dealIds);

    var allCompanyIds = [];
    Object.keys(dealToCompanyMap).forEach(function(dealId) {
      dealToCompanyMap[dealId].forEach(function(assoc) { allCompanyIds.push(assoc.id); });
    });
    var uniqueCompanyIds = uniqueArray(allCompanyIds);

    var companyDataMap = {};
    if (uniqueCompanyIds.length > 0) {
      ss.toast('Fetching company data...', 'Exclusion List');
      companyDataMap = fetchCompaniesByIds(uniqueCompanyIds, companyPropNames);
    }

    // ── 4. Run CU classifier, then compute inverse (non-CU deals) ──
    ss.toast('Classifying companies...', 'Exclusion List');
    var cuDeals = filterCreditUnionDeals(allDeals, dealPropDefs, dealToCompanyMap, companyDataMap);

    var cuDealIds = {};
    cuDeals.forEach(function(d) { cuDealIds[d.id] = true; });
    var nonCuDeals = allDeals.filter(function(d) { return !cuDealIds[d.id]; });

    console.log('[Exclusion] ' + nonCuDeals.length + ' non-CU deals out of ' + allDeals.length + ' total.');

    // ── 5. Extract unique non-CU companies from HubSpot ──
    var hubspotCompanies = extractNonCuCompanies(nonCuDeals, dealToCompanyMap, companyDataMap, linkedinPropName);
    console.log('[Exclusion] ' + hubspotCompanies.length + ' unique non-CU companies from HubSpot.');

    // ── 6. Read CSV input ──
    ss.toast('Reading Exclusion Input tab...', 'Exclusion List');
    var csvCompanies = readExclusionInput();
    console.log('[Exclusion] ' + csvCompanies.length + ' companies from Exclusion Input tab.');

    // ── 7. Merge and deduplicate ──
    var merged = mergeExclusionSources(hubspotCompanies, csvCompanies);
    console.log('[Exclusion] ' + merged.length + ' companies after merge/dedup.');

    // ── 8. Enrich missing LinkedIn URLs via Apollo ──
    var needLinkedin = merged.filter(function(c) { return c.domain && !c.linkedin; }).length;
    if (needLinkedin > 0) {
      ss.toast('Enriching ' + needLinkedin + ' companies via Apollo...', 'Exclusion List');
      enrichMissingLinkedIn(merged);
    }

    // ── 9. Write to sheet ──
    ss.toast('Writing ' + merged.length + ' companies to sheet...', 'Exclusion List');
    writeExclusionSheet(merged);

    ss.toast('Done! ' + merged.length + ' companies in Exclusion List.', 'Exclusion List', 10);

  } catch (e) {
    showError(e.message);
    console.error('Exclusion list error: ' + e.message + '\n' + e.stack);
  }
}

// ── Extract unique non-CU companies from deals ──────────────
function extractNonCuCompanies(deals, dealToCompanyMap, companyDataMap, linkedinPropName) {
  var seen = {};
  var companies = [];

  deals.forEach(function(deal) {
    var assocs = dealToCompanyMap[deal.id] || [];
    var primaryAssoc = assocs[0] || null;
    if (!primaryAssoc) return;

    var companyId = primaryAssoc.id;
    if (seen[companyId]) return;
    seen[companyId] = true;

    var props = companyDataMap[companyId] || {};
    companies.push({
      name:     props.name   || '',
      domain:   props.domain || '',
      linkedin: (linkedinPropName && props[linkedinPropName]) || ''
    });
  });

  return companies;
}

// ── Read "Exclusion Input" tab ──────────────────────────────
function readExclusionInput() {
  var ss    = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName(SHEET_NAME_EXCLUSION_INPUT);
  if (!sheet) {
    console.log('[Exclusion] "' + SHEET_NAME_EXCLUSION_INPUT + '" tab not found — skipping CSV input.');
    return [];
  }

  var lastCol = sheet.getLastColumn();
  var lastRow = sheet.getLastRow();
  if (lastRow < 2 || lastCol < 1) return [];

  var headers = sheet.getRange(1, 1, 1, lastCol).getValues()[0];

  // Find columns by header (case-insensitive)
  var nameIdx     = -1;
  var domainIdx   = -1;
  var linkedinIdx = -1;

  headers.forEach(function(h, i) {
    var lower = String(h).trim().toLowerCase();
    if (lower === 'company name')  nameIdx     = i;
    if (lower === 'domain')        domainIdx   = i;
    if (lower === 'linkedin')      linkedinIdx = i;
  });

  if (nameIdx === -1 && domainIdx === -1) {
    console.warn('[Exclusion] Exclusion Input tab missing "Company Name" and "Domain" columns.');
    return [];
  }

  var data = sheet.getRange(2, 1, lastRow - 1, lastCol).getValues();
  var companies = [];

  data.forEach(function(row) {
    var name     = nameIdx     !== -1 ? String(row[nameIdx]     || '').trim() : '';
    var domain   = domainIdx   !== -1 ? String(row[domainIdx]   || '').trim() : '';
    var linkedin = linkedinIdx !== -1 ? String(row[linkedinIdx] || '').trim() : '';
    if (name || domain) {
      companies.push({ name: name, domain: domain, linkedin: linkedin });
    }
  });

  return companies;
}

// ── Normalize domain for deduplication ──────────────────────
function normalizeDomain(raw) {
  if (!raw) return '';
  return String(raw).trim().toLowerCase()
    .replace(/^https?:\/\//, '')
    .replace(/^www\./, '')
    .replace(/\/.*$/, '');
}

// ── Merge HubSpot + CSV sources, dedup by domain ───────────
function mergeExclusionSources(hubspotCompanies, csvCompanies) {
  var byDomain   = {};  // normalized domain → company object
  var noDomain   = [];  // entries without a domain (can't dedup)

  // HubSpot companies first (higher priority)
  hubspotCompanies.forEach(function(c) {
    var key = normalizeDomain(c.domain);
    if (!key) { noDomain.push(c); return; }
    if (!byDomain[key]) {
      byDomain[key] = { name: c.name, domain: c.domain, linkedin: c.linkedin };
    }
  });

  // CSV companies fill gaps or add new
  csvCompanies.forEach(function(c) {
    var key = normalizeDomain(c.domain);
    if (!key) { noDomain.push(c); return; }
    if (!byDomain[key]) {
      byDomain[key] = { name: c.name, domain: c.domain, linkedin: c.linkedin };
    } else {
      // Merge: fill empty fields from CSV
      var existing = byDomain[key];
      if (!existing.name     && c.name)     existing.name     = c.name;
      if (!existing.linkedin && c.linkedin) existing.linkedin = c.linkedin;
    }
  });

  // Combine into array
  var result = [];
  Object.keys(byDomain).forEach(function(key) { result.push(byDomain[key]); });
  noDomain.forEach(function(c) { result.push(c); });

  // Sort by name
  result.sort(function(a, b) {
    return (a.name || '').toLowerCase().localeCompare((b.name || '').toLowerCase());
  });

  return result;
}

// ── Enrich missing LinkedIn via Apollo org enrichment ───────
function enrichMissingLinkedIn(companies) {
  var needEnrich = [];
  companies.forEach(function(c, idx) {
    if (c.domain && !c.linkedin) needEnrich.push(idx);
  });

  if (needEnrich.length === 0) {
    console.log('[Exclusion Apollo] All companies already have LinkedIn URLs or no domain to enrich.');
    return;
  }

  console.log('[Exclusion Apollo] Enriching ' + needEnrich.length + ' companies via Apollo...');
  var enriched = 0;

  needEnrich.forEach(function(idx, i) {
    if (i % 10 === 0) {
      SpreadsheetApp.getActiveSpreadsheet().toast(
        'Apollo org enrichment: ' + (i + 1) + '/' + needEnrich.length + '...',
        'Exclusion List'
      );
    }

    var domain = normalizeDomain(companies[idx].domain);
    if (!domain) return;

    var resp = UrlFetchApp.fetch(APOLLO_BASE + '/organizations/enrich', {
      method:          'post',
      contentType:     'application/json',
      headers:         { 'X-Api-Key': APOLLO_API_KEY },
      payload:         JSON.stringify({ domain: domain }),
      muteHttpExceptions: true
    });

    var code = resp.getResponseCode();
    if (code !== 200) {
      if (code !== 404) {
        console.error('[Exclusion Apollo] Error ' + code + ' for ' + domain + ': ' + resp.getContentText().substring(0, 150));
      }
      Utilities.sleep(400);
      return;
    }

    var data = JSON.parse(resp.getContentText());
    var org  = data.organization || data;

    if (org.linkedin_url) {
      companies[idx].linkedin = org.linkedin_url;
      enriched++;
    }
    // Also backfill name if missing
    if (!companies[idx].name && org.name) {
      companies[idx].name = org.name;
    }

    Utilities.sleep(600);
  });

  console.log('[Exclusion Apollo] Enriched ' + enriched + '/' + needEnrich.length + ' with LinkedIn URLs.');
}

// ── Write to "Exclusion List" sheet ─────────────────────────
function writeExclusionSheet(companies) {
  var ss    = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName(SHEET_NAME_EXCLUSION);
  if (!sheet) {
    sheet = ss.insertSheet(SHEET_NAME_EXCLUSION);
  } else {
    sheet.clearContents();
    sheet.clearFormats();
  }

  var headers = ['Name', 'Website', 'LinkedIn Page'];

  var rows = companies.map(function(c) {
    return [c.name || '', c.domain || '', c.linkedin || ''];
  });

  var allData   = [headers].concat(rows);
  var totalCols = headers.length;

  if (sheet.getMaxColumns() < totalCols) {
    sheet.insertColumnsAfter(sheet.getMaxColumns(), totalCols - sheet.getMaxColumns());
  }

  sheet.getRange(1, 1, allData.length, totalCols).setValues(allData);

  // Header styling
  var hdr = sheet.getRange(1, 1, 1, totalCols);
  hdr.setBackground('#0f4c81');
  hdr.setFontColor('#ffffff');
  hdr.setFontWeight('bold');
  sheet.setFrozenRows(1);

  // All columns are name/URL-like — use wider width
  sheet.setColumnWidths(1, totalCols, COL_WIDTH_NAME);

  // Row heights
  sheet.setRowHeight(1, ROW_HEIGHT_HEADER);
  if (rows.length > 0) {
    sheet.setRowHeightsForced(2, rows.length, ROW_HEIGHT_DATA);
  }

  sheet.activate();
}
