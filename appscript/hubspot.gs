// ============================================================
// hubspot.gs — All HubSpot API interactions
// ============================================================

var HUBSPOT_BASE = 'https://api.hubapi.com';

/**
 * Shared fetch helper with automatic 429 retry (exponential backoff, up to 3 retries).
 * @param {string} url
 * @param {string} method  'get' | 'post'
 * @param {object|null} payload  JSON body for POST requests
 * @returns {object}  parsed JSON response
 */
function hubspotRequest(url, method, payload) {
  var token = getToken();
  var options = {
    method: method,
    headers: {
      'Authorization': 'Bearer ' + token,
      'Content-Type': 'application/json'
    },
    muteHttpExceptions: true
  };
  if (payload) {
    options.payload = JSON.stringify(payload);
  }

  var maxRetries = 3;
  for (var attempt = 0; attempt <= maxRetries; attempt++) {
    var response = UrlFetchApp.fetch(url, options);
    var code = response.getResponseCode();

    if (code === 200 || code === 201 || code === 207) {
      return JSON.parse(response.getContentText());
    }

    if (code === 429 && attempt < maxRetries) {
      // Rate limited — wait with exponential backoff
      Utilities.sleep(Math.pow(2, attempt + 1) * 1000);
      continue;
    }

    if (code === 401) {
      throw new Error('HubSpot API: Invalid or expired token. Check your HUBSPOT_TOKEN Script Property.');
    }

    throw new Error(
      'HubSpot API error ' + code + ' on ' + method.toUpperCase() + ' ' + url +
      '\n' + response.getContentText().substring(0, 300)
    );
  }
}

/**
 * Returns all non-hidden deal property definitions, sorted alphabetically by label.
 * @returns {{ name: string, label: string }[]}
 */
function fetchAllDealPropertyDefinitions() {
  var data = hubspotRequest(HUBSPOT_BASE + '/crm/v3/properties/deals', 'get', null);
  return data.results
    .filter(function(p) { return !p.hidden; })
    .map(function(p) { return { name: p.name, label: p.label }; })
    .sort(function(a, b) { return a.label.localeCompare(b.label); });
}

/**
 * Returns all non-hidden company property definitions, sorted alphabetically by label.
 * @returns {{ name: string, label: string }[]}
 */
function fetchAllCompanyPropertyDefinitions() {
  var data = hubspotRequest(HUBSPOT_BASE + '/crm/v3/properties/companies', 'get', null);
  return data.results
    .filter(function(p) { return !p.hidden; })
    .map(function(p) { return { name: p.name, label: p.label }; })
    .sort(function(a, b) { return a.label.localeCompare(b.label); });
}


/**
 * Returns both pipeline and stage label maps in a single API call.
 * @returns {{ stageMap: Object.<string,string>, pipelineMap: Object.<string,string> }}
 */
function fetchPipelineMaps() {
  var data = hubspotRequest(HUBSPOT_BASE + '/crm/v3/pipelines/deals', 'get', null);
  var stageMap    = {};
  var pipelineMap = {};
  (data.results || []).forEach(function(pipeline) {
    pipelineMap[pipeline.id] = pipeline.label;
    (pipeline.stages || []).forEach(function(stage) {
      stageMap[stage.id] = stage.label;
    });
  });
  return { stageMap: stageMap, pipelineMap: pipelineMap };
}

/**
 * Returns a map of { ownerId: "First Last" } for all HubSpot owners.
 * @returns {Object.<string, string>}
 */
function fetchOwnerMap() {
  var map = {};
  var after = null;
  do {
    var url = HUBSPOT_BASE + '/crm/v3/owners?limit=100';
    if (after) url += '&after=' + encodeURIComponent(after);
    var data = hubspotRequest(url, 'get', null);
    (data.results || []).forEach(function(owner) {
      var name = [owner.firstName, owner.lastName].filter(Boolean).join(' ') || owner.email || String(owner.id);
      map[String(owner.id)] = name;
    });
    after = (data.paging && data.paging.next) ? data.paging.next.after : null;
  } while (after);
  return map;
}

/**
 * Paginates through deals and returns them all.
 * @param {string[]} propertyNames   list of deal property names to fetch
 * @param {object[]|null} filterGroups  optional HubSpot filterGroups array
 * @returns {object[]}  array of deal objects { id, properties: {...} }
 */
function fetchAllDeals(propertyNames, filterGroups) {
  var url = HUBSPOT_BASE + '/crm/v3/objects/deals/search';
  var deals = [];
  var after = null;
  var page = 0;

  do {
    page++;
    SpreadsheetApp.getActiveSpreadsheet().toast(
      'Fetching deals — page ' + page + ' (' + deals.length + ' so far)...',
      'HubSpot Sync'
    );

    var body = {
      properties: propertyNames,
      limit: DEAL_PAGE_SIZE
    };
    if (filterGroups && filterGroups.length > 0) {
      body.filterGroups = filterGroups;
    }
    if (after) {
      body.after = after;
    }

    var data = hubspotRequest(url, 'post', body);
    deals = deals.concat(data.results || []);

    after = (data.paging && data.paging.next) ? data.paging.next.after : null;
  } while (after);

  return deals;
}

/**
 * Batch-fetches deal-to-company associations for all given deal IDs.
 * Returns a map of dealId -> array of { id: companyId, typeId: number } sorted so primary (typeId=6) is first.
 * @param {string[]} dealIds
 * @returns {Object.<string, {id: string, typeId: number}[]>}
 */
function fetchDealToCompanyAssociations(dealIds) {
  var url = HUBSPOT_BASE + '/crm/v4/associations/deals/companies/batch/read';
  var map = {};
  var chunks = chunkArray(dealIds, ASSOCIATION_BATCH_SIZE);

  for (var i = 0; i < chunks.length; i++) {
    SpreadsheetApp.getActiveSpreadsheet().toast(
      'Fetching associations — batch ' + (i + 1) + '/' + chunks.length + '...',
      'HubSpot Sync'
    );
    var body = {
      inputs: chunks[i].map(function(id) { return { id: id }; })
    };
    var data = hubspotRequest(url, 'post', body);

    (data.results || []).forEach(function(entry) {
      var dealId = entry.from.id;
      var toList = (entry.to || []).map(function(t) {
        return { id: String(t.toObjectId), typeId: t.associationTypes ? t.associationTypes[0].typeId : 0 };
      });
      // Sort: typeId 6 (Primary) first
      toList.sort(function(a, b) {
        if (a.typeId === 6) return -1;
        if (b.typeId === 6) return 1;
        return 0;
      });
      map[dealId] = toList;
    });
  }

  return map;
}

/**
 * Batch-fetches company objects for the given company IDs.
 * Returns a map of companyId -> properties object.
 * @param {string[]} companyIds
 * @param {string[]} propertyNames
 * @returns {Object.<string, object>}
 */
function fetchCompaniesByIds(companyIds, propertyNames) {
  var url = HUBSPOT_BASE + '/crm/v3/objects/companies/batch/read';
  var map = {};
  var chunks = chunkArray(companyIds, COMPANY_BATCH_SIZE);

  for (var i = 0; i < chunks.length; i++) {
    SpreadsheetApp.getActiveSpreadsheet().toast(
      'Fetching companies — batch ' + (i + 1) + '/' + chunks.length + '...',
      'HubSpot Sync'
    );
    var body = {
      properties: propertyNames,
      inputs: chunks[i].map(function(id) { return { id: id }; })
    };
    var data = hubspotRequest(url, 'post', body);

    (data.results || []).forEach(function(company) {
      map[String(company.id)] = company.properties || {};
    });
  }

  return map;
}
