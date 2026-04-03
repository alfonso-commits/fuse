// ============================================================
// poc.gs — POC (Point of Contact) enrichment from HubSpot
// ============================================================

var SHEET_NAME_POC      = 'POCs: Active Pipeline';
var CONTACT_BATCH_SIZE  = 100;
var CONTACT_PROPERTIES  = ['firstname', 'lastname', 'jobtitle', 'email', 'hs_linkedin_url'];

// ── Entry point ───────────────────────────────────────────────
function syncPocPipeline() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var ui;
  try { ui = SpreadsheetApp.getUi(); } catch (e) { ui = null; }

  function showError(msg) {
    if (ui) ui.alert('POC Sync Error', msg, ui.ButtonSet.OK);
    else     console.error('POC Sync Error: ' + msg);
  }

  try {
    getToken();

    // ── 1. Fetch active pipeline deals (same filters as syncActivePipeline) ──
    ss.toast('Fetching deal properties...', 'POC Sync');
    var dealPropDefs = filterToWantedColumns(fetchAllDealPropertyDefinitions(), DEAL_COLUMNS);
    var companyPropDefs = filterToWantedColumns(fetchAllCompanyPropertyDefinitions(), COMPANY_COLUMNS);
    var dealPropNames    = dealPropDefs.map(function(d) { return d.name; });
    var companyPropNames = companyPropDefs.map(function(d) { return d.name; });
    if (companyPropNames.indexOf('name')   === -1) companyPropNames.push('name');
    if (companyPropNames.indexOf('domain') === -1) companyPropNames.push('domain');

    ss.toast('Resolving pipeline stages...', 'POC Sync');
    var pipelineMaps = fetchPipelineMaps();

    // Build same filter groups as syncActivePipeline
    var salesPipelineId = null;
    Object.keys(pipelineMaps.pipelineMap).forEach(function(id) {
      if (pipelineMaps.pipelineMap[id].toLowerCase() === 'sales pipeline') {
        salesPipelineId = id;
      }
    });
    var closedStageIds = [];
    Object.keys(pipelineMaps.stageMap).forEach(function(id) {
      var label = pipelineMaps.stageMap[id].toLowerCase();
      if (label === 'closed won' || label === 'closed lost') {
        closedStageIds.push(id);
      }
    });
    var filters = [];
    if (salesPipelineId) {
      filters.push({ propertyName: 'pipeline', operator: 'EQ', value: salesPipelineId });
    }
    if (closedStageIds.length > 0) {
      filters.push({ propertyName: 'dealstage', operator: 'NOT_IN', values: closedStageIds });
    }
    var filterGroups = filters.length > 0 ? [{ filters: filters }] : null;

    ss.toast('Fetching deals...', 'POC Sync');
    var deals = fetchAllDeals(dealPropNames, filterGroups);

    if (deals.length === 0) {
      ss.toast('No active pipeline deals found.', 'POC Sync', 8);
      writePocSheet([]);
      return;
    }

    // ── 2. Fetch deal→company associations (for CU filter + company name) ──
    var dealIds = deals.map(function(d) { return d.id; });

    ss.toast('Fetching company associations...', 'POC Sync');
    var dealToCompanyMap = fetchDealToCompanyAssociations(dealIds);

    var allCompanyIds = [];
    Object.keys(dealToCompanyMap).forEach(function(dealId) {
      dealToCompanyMap[dealId].forEach(function(assoc) { allCompanyIds.push(assoc.id); });
    });
    var uniqueCompanyIds = uniqueArray(allCompanyIds);

    var companyDataMap = {};
    if (uniqueCompanyIds.length > 0) {
      companyDataMap = fetchCompaniesByIds(uniqueCompanyIds, companyPropNames);
    }

    // ── 3. Filter to Credit Union deals only ──
    ss.toast('Filtering Credit Union deals...', 'POC Sync');
    deals = filterCreditUnionDeals(deals, dealPropDefs, dealToCompanyMap, companyDataMap);

    if (deals.length === 0) {
      ss.toast('No Credit Union deals in active pipeline.', 'POC Sync', 8);
      writePocSheet([]);
      return;
    }

    // ── 4. Fetch deal→contact associations ──
    dealIds = deals.map(function(d) { return d.id; });

    ss.toast('Fetching contact associations for ' + dealIds.length + ' deals...', 'POC Sync');
    var dealToContactMap = fetchDealToContactAssociations(dealIds);

    // Build reverse map: contactId → dealIds (for company name resolution)
    var contactIdToDealIds = {};
    Object.keys(dealToContactMap).forEach(function(dealId) {
      dealToContactMap[dealId].forEach(function(contactId) {
        if (!contactIdToDealIds[contactId]) {
          contactIdToDealIds[contactId] = [];
        }
        contactIdToDealIds[contactId].push(dealId);
      });
    });

    var uniqueContactIds = Object.keys(contactIdToDealIds);
    if (uniqueContactIds.length === 0) {
      ss.toast('No contacts associated with active pipeline deals.', 'POC Sync', 8);
      writePocSheet([]);
      return;
    }

    // ── 5. Batch-fetch contact properties ──
    ss.toast('Fetching details for ' + uniqueContactIds.length + ' contacts...', 'POC Sync');
    var contactDataMap = fetchContactsByIds(uniqueContactIds, CONTACT_PROPERTIES);

    // ── 6. Build dealId→companyName lookup ──
    var dealIdToCompanyName = {};
    dealIds.forEach(function(dealId) {
      var assocs = dealToCompanyMap[dealId] || [];
      var primaryAssoc = assocs[0] || null;
      if (primaryAssoc && companyDataMap[primaryAssoc.id]) {
        dealIdToCompanyName[dealId] = companyDataMap[primaryAssoc.id].name || '';
      } else {
        dealIdToCompanyName[dealId] = '';
      }
    });

    // ── 7. Build output rows ──
    var rows = [];
    uniqueContactIds.forEach(function(contactId) {
      var contact = contactDataMap[contactId] || {};
      // Resolve company name from the first associated deal
      var associatedDealIds = contactIdToDealIds[contactId] || [];
      var companyName = '';
      for (var i = 0; i < associatedDealIds.length; i++) {
        var name = dealIdToCompanyName[associatedDealIds[i]];
        if (name) { companyName = name; break; }
      }

      rows.push([
        contact.firstname       || '',
        contact.lastname        || '',
        contact.jobtitle        || '',
        contact.email           || '',
        companyName,
        contact.hs_linkedin_url || ''
      ]);
    });

    // ── 8. Enrich missing LinkedIn URLs via Apollo ──
    ss.toast('Enriching ' + rows.length + ' contacts via Apollo...', 'POC Sync');
    rows = enrichPocWithApollo(rows);

    // ── 9. Write to sheet ──
    ss.toast('Writing ' + rows.length + ' contacts to sheet...', 'POC Sync');
    writePocSheet(rows);

    ss.toast('Done! ' + rows.length + ' POCs written.', 'POC Sync', 10);

  } catch (e) {
    showError(e.message);
    console.error('POC sync error: ' + e.message + '\n' + e.stack);
  }
}

// ── Fetch deal→contact associations ──────────────────────────
// Returns { dealId: [contactId, contactId, ...] }
function fetchDealToContactAssociations(dealIds) {
  var url = HUBSPOT_BASE + '/crm/v4/associations/deals/contacts/batch/read';
  var map = {};
  var chunks = chunkArray(dealIds, ASSOCIATION_BATCH_SIZE);

  for (var i = 0; i < chunks.length; i++) {
    SpreadsheetApp.getActiveSpreadsheet().toast(
      'Fetching contact associations — batch ' + (i + 1) + '/' + chunks.length + '...',
      'POC Sync'
    );
    var body = {
      inputs: chunks[i].map(function(id) { return { id: id }; })
    };
    var data = hubspotRequest(url, 'post', body);

    (data.results || []).forEach(function(entry) {
      var dealId = entry.from.id;
      var contactIds = (entry.to || []).map(function(t) {
        return String(t.toObjectId);
      });
      map[dealId] = contactIds;
    });
  }

  return map;
}

// ── Batch-fetch contact objects ─────────────────────────────
// Returns { contactId: { firstname, lastname, jobtitle, email, hs_linkedin_url } }
function fetchContactsByIds(contactIds, propertyNames) {
  var url = HUBSPOT_BASE + '/crm/v3/objects/contacts/batch/read';
  var map = {};
  var chunks = chunkArray(contactIds, CONTACT_BATCH_SIZE);

  for (var i = 0; i < chunks.length; i++) {
    SpreadsheetApp.getActiveSpreadsheet().toast(
      'Fetching contacts — batch ' + (i + 1) + '/' + chunks.length + '...',
      'POC Sync'
    );
    var body = {
      properties: propertyNames,
      inputs: chunks[i].map(function(id) { return { id: id }; })
    };
    var data = hubspotRequest(url, 'post', body);

    (data.results || []).forEach(function(contact) {
      map[String(contact.id)] = contact.properties || {};
    });
  }

  return map;
}

// ── Enrich POCs with Apollo (LinkedIn URLs + email) ─────────
// Matches contacts by email via Apollo bulk_match.
// Costs 1 Apollo credit per contact. Only enriches rows that have
// an email and are missing a LinkedIn URL.
// Row format: [First Name, Last Name, Title, Email, Company, LinkedIn URL]
function enrichPocWithApollo(rows) {
  var REVEAL_BATCH = 10; // Apollo bulk_match limit per call

  // Collect indices of rows that need enrichment (have email, missing LinkedIn)
  var needEnrich = [];
  rows.forEach(function(row, idx) {
    if (row[3] && !row[5]) { // has email, no LinkedIn URL
      needEnrich.push(idx);
    }
  });

  if (needEnrich.length === 0) {
    console.log('[POC Apollo] All contacts already have LinkedIn URLs or no emails to match.');
    return rows;
  }

  console.log('[POC Apollo] Enriching ' + needEnrich.length + ' contacts via Apollo...');
  var chunks = chunkArray(needEnrich, REVEAL_BATCH);

  chunks.forEach(function(chunk, ci) {
    SpreadsheetApp.getActiveSpreadsheet().toast(
      'Apollo enrichment: batch ' + (ci + 1) + '/' + chunks.length + '...',
      'POC Sync'
    );

    var body = {
      reveal_personal_emails: true,
      details: chunk.map(function(idx) {
        return { email: rows[idx][3] };
      })
    };

    var resp = UrlFetchApp.fetch(APOLLO_BASE + '/people/bulk_match', {
      method:          'post',
      contentType:     'application/json',
      headers:         { 'X-Api-Key': APOLLO_API_KEY },
      payload:         JSON.stringify(body),
      muteHttpExceptions: true
    });

    var code = resp.getResponseCode();
    if (code !== 200) {
      console.error('[POC Apollo] Error ' + code + ': ' + resp.getContentText().substring(0, 200));
      Utilities.sleep(500);
      return; // skip this batch, keep HubSpot data as-is
    }

    var data    = JSON.parse(resp.getContentText());
    var matches = data.matches || data.people || [];

    // matches array is in the same order as the details array
    chunk.forEach(function(rowIdx, i) {
      var match = matches[i];
      if (!match) return;

      // Fill LinkedIn URL if Apollo has it
      if (match.linkedin_url) {
        rows[rowIdx][5] = match.linkedin_url;
      }
      // Optionally fill title if HubSpot had it blank
      if (!rows[rowIdx][2] && match.title) {
        rows[rowIdx][2] = match.title;
      }
    });

    Utilities.sleep(600);
  });

  var enrichedCount = 0;
  needEnrich.forEach(function(idx) { if (rows[idx][5]) enrichedCount++; });
  console.log('[POC Apollo] Enriched ' + enrichedCount + '/' + needEnrich.length + ' with LinkedIn URLs.');

  return rows;
}

// ── Write to "POCs: Active Pipeline" sheet ──────────────────
function writePocSheet(rows) {
  var ss    = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName(SHEET_NAME_POC);
  if (!sheet) {
    sheet = ss.insertSheet(SHEET_NAME_POC);
  } else {
    sheet.clearContents();
    sheet.clearFormats();
  }

  var headers = [
    'First Name', 'Last Name', 'Title', 'Email', 'Company', 'LinkedIn URL'
  ];

  var allData = [headers].concat(rows);
  var totalCols = headers.length;

  // Expand columns if needed
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

  // Column widths
  sheet.setColumnWidths(1, totalCols, COL_WIDTH_DEFAULT);
  // Wider columns for name-like fields
  sheet.setColumnWidth(3, COL_WIDTH_NAME);   // Title
  sheet.setColumnWidth(4, COL_WIDTH_NAME);   // Email
  sheet.setColumnWidth(5, COL_WIDTH_NAME);   // Company
  sheet.setColumnWidth(6, COL_WIDTH_NAME);   // LinkedIn URL

  // Row heights
  sheet.setRowHeight(1, ROW_HEIGHT_HEADER);
  if (rows.length > 0) {
    sheet.setRowHeightsForced(2, rows.length, ROW_HEIGHT_DATA);
  }

  sheet.activate();
}
