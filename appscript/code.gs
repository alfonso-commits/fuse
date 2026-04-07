// ============================================================
// Code.gs — Entry point, menu, configuration, orchestration
// ============================================================

// ── SETUP ────────────────────────────────────────────────────
// 1. In Google Sheets: Extensions > Apps Script
// 2. Project Settings > Script Properties > Add property:
//       Name:  HUBSPOT_TOKEN
//       Value: pat-na1-xxxx...  (your HubSpot Private App token)
// 3. Your Private App must have these scopes:
//       crm.objects.deals.read
//       crm.objects.companies.read
//       crm.schemas.deals.read
//       crm.schemas.companies.read
//       associations.read
// 4. Reload the spreadsheet → a "HubSpot" menu will appear
// 5. Click HubSpot > Sync Deals
// ─────────────────────────────────────────────────────────────

// ── CONFIGURATION ────────────────────────────────────────────
var HUBSPOT_TOKEN_KEY       = 'HUBSPOT_TOKEN';
var SHEET_NAME              = 'HubSpot Deals';
var SHEET_NAME_ACTIVE       = 'Companies: Active Pipeline';

// "PRIMARY" = one row per deal, using the primary (or first) associated company
// "ALL_ROWS" = one row per associated company (deal columns repeated)
var MULTI_COMPANY_STRATEGY  = 'PRIMARY';

var ASSOCIATION_BATCH_SIZE  = 100;
var COMPANY_BATCH_SIZE      = 100;
var DEAL_PAGE_SIZE          = 100;
var WRITE_BATCH_SIZE        = 1000;

// ── COLUMN SELECTION (edit here to add/remove/reorder columns) ──
// Matched case-insensitively against HubSpot property labels.
var DEAL_COLUMNS = [
  'Close Date',
  'Create Date',
  'Deal Name',
  'Deal Owner',
  'Deal Stage',
  'Pipeline',
  'Record ID',
  'Amount',
  'Associated Company Domain',
  'Associated Company RSSD',
  'Closed Won date',
  'Closed Won Reason',
  'Commercial LOS',
  'Company Type',
  'Conference',
  'Conference Name',
  'Consumer LOS',
  'Core System',
  'Institution type',
  'SDR Notes',
  "Total Loans Consumer ('000)"
];

// Company property labels — shown in sheet as "Company: <label>"
var COMPANY_COLUMNS = [
  'LinkedIn Company Page',
  'Postal Code',
  'State/Region',
  'Street Address',
  'Website URL',
  '100K Project Category',
  'Facebook Company Page',
  'Landing Domain'
];
// ─────────────────────────────────────────────────────────────

/**
 * Adds the "HubSpot" menu when the spreadsheet opens.
 * NOTE: This must be triggered by opening the spreadsheet — do NOT run it
 * manually from the Apps Script editor (that context has no spreadsheet UI).
 */
function onOpen() {
  try {
    SpreadsheetApp.getUi()
      .createMenu('Load lists')
      .addItem('Sync All Deals',              'syncHubSpotDealsToSheet')
      .addItem('Companies: Active Pipeline',  'syncActivePipeline')
      .addItem('POCs: Active Pipeline',       'syncPocPipeline')
      .addItem('Contacts: Active Pipeline',   'syncApolloContacts')
      .addItem('Exclusion List',              'syncExclusionList')
      .addItem('Debug',                       'debugApollo')
      .addToUi();
  } catch (e) {
    // Silently ignore — getUi() is unavailable when run from the script editor.
  }
}

/** Syncs all deals into the "HubSpot Deals" sheet. */
function syncHubSpotDealsToSheet() {
  doSync(SHEET_NAME, null);
}

/**
 * Syncs only active deals (Sales Pipeline, excluding Closed Won / Closed Lost)
 * into the "Active Pipeline" sheet.
 */
function syncActivePipeline() {
  // Resolve label-based filter criteria to HubSpot IDs at runtime
  var pipelineMaps = fetchPipelineMaps();

  // Find the "Sales Pipeline" ID
  var salesPipelineId = null;
  Object.keys(pipelineMaps.pipelineMap).forEach(function(id) {
    if (pipelineMaps.pipelineMap[id].toLowerCase() === 'sales pipeline') {
      salesPipelineId = id;
    }
  });

  // Find stage IDs for "Closed Won" and "Closed Lost"
  var closedStageIds = [];
  Object.keys(pipelineMaps.stageMap).forEach(function(id) {
    var label = pipelineMaps.stageMap[id].toLowerCase();
    if (label === 'closed won' || label === 'closed lost') {
      closedStageIds.push(id);
    }
  });

  // Build filter: pipeline = Sales Pipeline AND stage NOT IN [closed stages]
  var filters = [];
  if (salesPipelineId) {
    filters.push({ propertyName: 'pipeline', operator: 'EQ', value: salesPipelineId });
  }
  if (closedStageIds.length > 0) {
    filters.push({ propertyName: 'dealstage', operator: 'NOT_IN', values: closedStageIds });
  }

  var filterGroups = filters.length > 0 ? [{ filters: filters }] : null;
  doSync(SHEET_NAME_ACTIVE, filterGroups, pipelineMaps);
}

/**
 * Shared sync logic. Fetches deals (with optional filters) and writes to targetSheetName.
 * @param {string} targetSheetName
 * @param {object[]|null} filterGroups   HubSpot filterGroups, or null for no filter
 * @param {object|null} cachedPipelineMaps  pass if already fetched, to avoid a duplicate call
 */
function doSync(targetSheetName, filterGroups, cachedPipelineMaps) {
  var ss = SpreadsheetApp.getActiveSpreadsheet();

  var ui;
  try { ui = SpreadsheetApp.getUi(); } catch (e) { ui = null; }
  function showError(msg) {
    if (ui) { ui.alert('HubSpot Sync Error', msg, ui.ButtonSet.OK); }
    else     { console.error('HubSpot Sync Error: ' + msg); }
  }

  try {
    getToken();

    ss.toast('Discovering deal properties...', 'HubSpot Sync');
    var dealPropDefs = filterToWantedColumns(fetchAllDealPropertyDefinitions(), DEAL_COLUMNS);

    ss.toast('Discovering company properties...', 'HubSpot Sync');
    var companyPropDefs = filterToWantedColumns(fetchAllCompanyPropertyDefinitions(), COMPANY_COLUMNS);

    ss.toast('Fetching pipeline stages and owners...', 'HubSpot Sync');
    var maps        = cachedPipelineMaps || fetchPipelineMaps();
    var stageMap    = maps.stageMap;
    var pipelineMap = maps.pipelineMap;
    var ownerMap    = fetchOwnerMap();

    var dealPropNames    = dealPropDefs.map(function(d) { return d.name; });
    var companyPropNames = companyPropDefs.map(function(d) { return d.name; });
    // Always fetch name + domain for Credit Union classification (even if not in output columns)
    if (companyPropNames.indexOf('name')   === -1) companyPropNames.push('name');
    if (companyPropNames.indexOf('domain') === -1) companyPropNames.push('domain');

    var deals = fetchAllDeals(dealPropNames, filterGroups);

    if (deals.length === 0) {
      ss.toast('No deals found.', 'HubSpot Sync', 8);
      writeToSheet(targetSheetName, [], dealPropDefs, companyPropDefs, {}, {}, {}, {}, {});
      return;
    }

    var dealIds = deals.map(function(d) { return d.id; });
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

    // ── Credit Union filter (Active Pipeline only) ──────────────
    if (targetSheetName === SHEET_NAME_ACTIVE) {
      deals = filterCreditUnionDeals(deals, dealPropDefs, dealToCompanyMap, companyDataMap);
    }

    ss.toast('Writing ' + deals.length + ' deals to sheet...', 'HubSpot Sync');
    writeToSheet(targetSheetName, deals, dealPropDefs, companyPropDefs, dealToCompanyMap, companyDataMap, stageMap, pipelineMap, ownerMap);

    ss.toast(
      'Done! ' + deals.length + ' deals synced (' + uniqueCompanyIds.length + ' companies resolved).',
      'HubSpot Sync', 10
    );

  } catch (e) {
    showError(e.message);
    console.error('HubSpot sync error: ' + e.message + '\n' + e.stack);
  }
}
