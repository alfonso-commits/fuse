// ============================================================
// apollo.gs — Apollo.io contact enrichment
// ============================================================

var APOLLO_API_KEY     = PropertiesService.getScriptProperties().getProperty('APOLLO_API_KEY') || '';
var APOLLO_BASE        = 'https://api.apollo.io/v1';
var APOLLO_SHEET_NAME  = 'Contacts: Active Pipeline';
var APOLLO_PAGE_SIZE   = 100;
var APOLLO_MAX_PAGES   = 10;  // safety cap per batch to avoid timeouts
var APOLLO_DOMAIN_BATCH = 10; // domains per API call

// Apollo seniority levels to pull
var APOLLO_SENIORITIES = ['c_suite', 'vp'];

// Apollo standard departments (maps to Operations, Executive, Technology, Finance)
var APOLLO_DEPT_FILTER = [
  'executive',
  'finance',
  'operations',
  'engineering',
  'information_technology'
];

// Title/dept keywords for Lending & Innovation (not in Apollo's taxonomy)
var APOLLO_KW_FILTER = [
  'lend', 'loan', 'mortgage', 'underwr',      // Lending
  'innovat', 'digital', 'transform'            // Innovation
];

// ── Debug helper (run from Apps Script editor to diagnose issues) ─
function debugApollo() {
  var ui = SpreadsheetApp.getUi();

  // 1. Check domains from sheet
  var domains;
  try {
    domains = getActiveCompanyDomains();
  } catch (e) {
    ui.alert('Debug', 'getActiveCompanyDomains() failed:\n' + e.message, ui.ButtonSet.OK);
    return;
  }
  if (domains.length === 0) {
    ui.alert('Debug', 'No domains found in Active Pipeline sheet.\nCheck the "Associated Company Domain" column has data.', ui.ButtonSet.OK);
    return;
  }

  // 2. Try a single Apollo call with the first domain and log the raw response
  var testDomain = domains[0];
  var body = {
    page:        1,
    per_page:    5,
    person_seniorities: APOLLO_SENIORITIES,
    q_organization_domains: testDomain
  };

  var resp = UrlFetchApp.fetch(APOLLO_BASE + '/mixed_people/api_search', {
    method: 'post',
    contentType: 'application/json',
    headers: { 'X-Api-Key': APOLLO_API_KEY },
    payload: JSON.stringify(body),
    muteHttpExceptions: true
  });

  var code = resp.getResponseCode();
  var raw  = resp.getContentText();
  var preview = raw.substring(0, 600);

  // 3. Try alternate param name if first returned 0
  var data = JSON.parse(raw);
  var count = (data.people || []).length;

  // Show first person's raw keys so we can verify field names
  var firstPersonKeys = '';
  if (count > 0) {
    var first = data.people[0];
    firstPersonKeys = '\n\nFirst person raw JSON:\n' + JSON.stringify(first, null, 2).substring(0, 800);
  }

  // Also reveal the first person to see the enriched field structure
  var revealInfo = '';
  if (count > 0) {
    var firstId = data.people[0].id;
    var revResp = UrlFetchApp.fetch(APOLLO_BASE + '/people/bulk_match', {
      method: 'post',
      contentType: 'application/json',
      headers: { 'X-Api-Key': APOLLO_API_KEY },
      payload: JSON.stringify({ reveal_personal_emails: true, details: [{ id: firstId }] }),
      muteHttpExceptions: true
    });
    var revData = JSON.parse(revResp.getContentText());
    var revPerson = (revData.matches || revData.people || [])[0] || {};
    revealInfo = '\n\nRevealed person (organization fields):\n' +
      JSON.stringify(revPerson.organization || {}, null, 2).substring(0, 600) +
      '\n\nTop-level website fields: ' +
      JSON.stringify({
        organization_website_url: revPerson.organization_website_url,
        website_url: revPerson.website_url,
        email: revPerson.email,
        linkedin_url: revPerson.linkedin_url
      });
  }

  var msg = 'Domain tested: ' + testDomain +
            '\nTotal domains in sheet: ' + domains.length +
            '\nHTTP status: ' + code +
            '\nPeople returned: ' + count +
            firstPersonKeys +
            revealInfo;

  ui.alert('Apollo Debug', msg, ui.ButtonSet.OK);
}

// ── Entry point ───────────────────────────────────────────────
function syncApolloContacts() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var ui;
  try { ui = SpreadsheetApp.getUi(); } catch (e) { ui = null; }

  function showError(msg) {
    if (ui) ui.alert('Apollo Sync Error', msg, ui.ButtonSet.OK);
    else     console.error('Apollo Sync Error: ' + msg);
  }

  try {
    // 1. Read company domains from the Active Pipeline sheet
    ss.toast('Reading domains from Active Pipeline...', 'Apollo');
    var domains = getActiveCompanyDomains();

    if (domains.length === 0) {
      ss.toast('No domains found in Active Pipeline. Run that sync first.', 'Apollo', 8);
      return;
    }

    // 2. Search Apollo
    ss.toast('Searching Apollo for contacts across ' + domains.length + ' companies...', 'Apollo');
    var allPeople = fetchApolloPeople(domains);

    // 3. Exclude unwanted title categories (accounting, marketing, compliance, legal, branches, HR)
    var filtered = filterApolloPeople(allPeople);
    console.log('[Apollo] After title filter: ' + filtered.length + ' / ' + allPeople.length);

    // 4. Reveal emails + LinkedIn URLs using credits
    ss.toast('Revealing emails for ' + filtered.length + ' contacts (using credits)...', 'Apollo');
    var enriched = revealPeopleEmails(filtered);

    // 5. Write to sheet
    ss.toast('Writing ' + enriched.length + ' contacts to sheet...', 'Apollo');
    writeApolloSheet(enriched);

    ss.toast('Done! ' + enriched.length + ' contacts written.', 'Apollo', 10);

  } catch (e) {
    showError(e.message);
    console.error('Apollo sync error: ' + e.message + '\n' + e.stack);
  }
}

// ── Step 1: Read domains from the Active Pipeline sheet ───────
function getActiveCompanyDomains() {
  var ss    = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName(SHEET_NAME_ACTIVE);
  if (!sheet) {
    throw new Error('"' + SHEET_NAME_ACTIVE + '" sheet not found. Run Active Pipeline sync first.');
  }

  var lastCol = sheet.getLastColumn();
  var lastRow = sheet.getLastRow();
  if (lastRow < 2 || lastCol < 1) return [];

  var headers = sheet.getRange(1, 1, 1, lastCol).getValues()[0];

  // Find "Associated Company Domain" column (case-insensitive)
  var domainIdx = -1;
  headers.forEach(function(h, i) {
    if (String(h).toLowerCase().replace(/\s+/g, ' ').indexOf('associated company domain') !== -1) {
      domainIdx = i;
    }
  });
  if (domainIdx === -1) {
    throw new Error('Column "Associated Company Domain" not found in Active Pipeline sheet.');
  }

  var data  = sheet.getRange(2, 1, lastRow - 1, lastCol).getValues();
  var seen  = {};
  var domains = [];

  data.forEach(function(row) {
    var raw = String(row[domainIdx] || '').trim().toLowerCase();
    // Strip leading http(s):// if present
    raw = raw.replace(/^https?:\/\//, '').replace(/\/.*$/, '');
    if (raw && !seen[raw]) {
      seen[raw] = true;
      domains.push(raw);
    }
  });

  return domains;
}

// ── Step 2: Fetch people from Apollo ─────────────────────────
function fetchApolloPeople(domains) {
  var allPeople = [];
  var seenIds   = {};
  var chunks    = chunkArray(domains, APOLLO_DOMAIN_BATCH);

  chunks.forEach(function(chunk, ci) {
    SpreadsheetApp.getActiveSpreadsheet().toast(
      'Apollo: batch ' + (ci + 1) + '/' + chunks.length + ' (' + chunk.length + ' domains)...',
      'Apollo'
    );

    var page       = 1;
    var totalPages = 1;

    do {
      var body = {
        page:                        page,
        per_page:                    APOLLO_PAGE_SIZE,
        person_seniorities:       APOLLO_SENIORITIES,
        q_organization_domains:   chunk.join('\n')
      };

      var resp = UrlFetchApp.fetch(APOLLO_BASE + '/mixed_people/api_search', {
        method:          'post',
        contentType:     'application/json',
        headers:         { 'X-Api-Key': APOLLO_API_KEY },
        payload:         JSON.stringify(body),
        muteHttpExceptions: true
      });

      var code = resp.getResponseCode();
      if (code !== 200) {
        console.error('Apollo API error ' + code + ': ' + resp.getContentText().substring(0, 300));
        break;
      }

      var data   = JSON.parse(resp.getContentText());
      var people = data.people || [];

      people.forEach(function(p) {
        if (p.id && !seenIds[p.id]) {
          seenIds[p.id] = true;
          allPeople.push(p);
        }
      });

      // New endpoint returns total_entries at root, not inside pagination
      var totalEntries = data.total_entries || 0;
      totalPages = Math.min(Math.ceil(totalEntries / APOLLO_PAGE_SIZE) || 1, APOLLO_MAX_PAGES);
      page++;

      // Respect Apollo rate limits
      if (page <= totalPages) Utilities.sleep(600);

    } while (page <= totalPages);

    // Pause between domain batches
    if (ci < chunks.length - 1) Utilities.sleep(1200);
  });

  return allPeople;
}

// ── Step 3: Exclude unwanted titles ──────────────────────────
// Apollo already filtered by seniority (c_suite + vp).
// We just drop titles clearly outside the desired departments.
var TITLE_EXCLUSIONS = [
  // Accounting
  'accountant', 'accounting', 'controller', 'comptroller', 'bookkeep', 'payroll',
  // Marketing
  'marketing', 'advertis', 'brand manager', 'brand director',
  'public relation', 'communications director', 'communications officer',
  'content manager', 'content director',
  // Compliance
  'compliance', ' bsa ', 'cra officer',
  // Legal
  ' legal', 'counsel', 'attorney', 'paralegal',
  // Branches
  'branch',
  // Human Resources
  'human resource', ' hr ', '/hr/', 'talent acquisition',
  'talent management', 'recruit', 'workforce', 'benefits director',
  'benefits officer', 'people officer', 'people director'
];

function filterApolloPeople(people) {
  return people.filter(function(p) {
    return !isTitleExcluded(p.title || '');
  });
}

function isTitleExcluded(title) {
  // Pad with spaces so we can match whole-word fragments like " hr " or " bsa "
  var t = ' ' + title.toLowerCase() + ' ';
  return TITLE_EXCLUSIONS.some(function(kw) { return t.indexOf(kw) !== -1; });
}

// ── Step 4: Reveal emails + LinkedIn via credits ─────────────
// Calls /v1/people/bulk_match with person IDs — costs 1 credit per contact.
// Returns the same array with p.email and p.linkedin_url populated where available.
function revealPeopleEmails(people) {
  var REVEAL_BATCH = 10; // Apollo bulk_match limit
  var chunks = chunkArray(people, REVEAL_BATCH);

  chunks.forEach(function(chunk, ci) {
    SpreadsheetApp.getActiveSpreadsheet().toast(
      'Revealing: batch ' + (ci + 1) + '/' + chunks.length + '...',
      'Apollo'
    );

    var body = {
      reveal_personal_emails: true,
      details: chunk.map(function(p) { return { id: p.id }; })
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
      console.error('Reveal error ' + code + ': ' + resp.getContentText().substring(0, 200));
      Utilities.sleep(500);
      return; // keep originals without email for this batch
    }

    var data    = JSON.parse(resp.getContentText());
    var matches = data.matches || data.people || [];

    // Build id → enriched map
    var enrichedMap = {};
    matches.forEach(function(m) {
      if (m.id) enrichedMap[m.id] = m;
    });

    // Merge all enriched fields back into original person objects
    chunk.forEach(function(p) {
      var enriched = enrichedMap[p.id];
      if (enriched) {
        p.email        = enriched.email        || '';
        p.linkedin_url = enriched.linkedin_url || p.linkedin_url || '';
        p.city         = enriched.city         || p.city  || '';
        p.state        = enriched.state        || p.state || '';
        if (enriched.last_name) p.last_name = enriched.last_name;
        // Merge enriched organization (contains website_url, primary_domain, etc.)
        if (enriched.organization) p.organization = enriched.organization;
      }
    });

    Utilities.sleep(600);
  });

  return people;
}

// ── Step 5: Write to "Apollo" sheet ──────────────────────────
function writeApolloSheet(people) {
  var ss    = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName(APOLLO_SHEET_NAME);
  if (!sheet) {
    sheet = ss.insertSheet(APOLLO_SHEET_NAME);
  } else {
    sheet.clearContents();
    sheet.clearFormats();
  }

  var headers = [
    'First Name', 'Last Name', 'Title', 'Email',
    'Company', 'Company Website', 'LinkedIn URL', 'City', 'State'
  ];

  var rows = people.map(function(p) {
    var org = p.organization || {};
    var website = org.website_url || org.primary_domain
                  || p.organization_website_url || '';
    return [
      p.first_name                           || '',
      p.last_name || p.last_name_obfuscated  || '',
      p.title                                || '',
      p.email                                || '',
      org.name || p.organization_name        || '',
      website,
      p.linkedin_url                         || '',
      p.city                                 || '',
      p.state                                || ''
    ];
  });

  // Write all data in one shot
  var allData = [headers].concat(rows);
  sheet.getRange(1, 1, allData.length, headers.length).setValues(allData);

  // Header styling
  var hdr = sheet.getRange(1, 1, 1, headers.length);
  hdr.setBackground('#0f4c81');
  hdr.setFontColor('#ffffff');
  hdr.setFontWeight('bold');
  sheet.setFrozenRows(1);

  // Uniform cell sizing
  sheet.setColumnWidths(1, headers.length, 175);
  if (rows.length > 0) sheet.setRowHeights(2, rows.length, 21);

  // Wider title column
  sheet.setColumnWidth(3, 280);

  sheet.activate();
}
