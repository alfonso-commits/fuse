// ============================================================
// sheet.gs — Google Sheet writing logic
// ============================================================

// Standard cell dimensions
var COL_WIDTH_DEFAULT  = 150;  // px for most columns
var COL_WIDTH_NAME     = 220;  // px for name/description/address columns
var ROW_HEIGHT_HEADER  = 30;
var ROW_HEIGHT_DATA    = 21;

/**
 * Returns true if a column label should get a wider width.
 * @param {string} label
 * @returns {boolean}
 */
function isWideColumn(label) {
  var lower = label.toLowerCase();
  return lower.indexOf('name') !== -1 ||
         lower.indexOf('description') !== -1 ||
         lower.indexOf('notes') !== -1 ||
         lower.indexOf('address') !== -1 ||
         lower.indexOf('domain') !== -1 ||
         lower.indexOf('url') !== -1;
}

/**
 * Clears the target sheet and writes the deals table.
 * Column order matches the DEAL_COLUMNS / COMPANY_COLUMNS lists in Code.gs.
 *
 * @param {object[]} deals
 * @param {{ name, label }[]} dealPropDefs      filtered & ordered deal props
 * @param {{ name, label }[]} companyPropDefs   filtered & ordered company props
 * @param {Object} dealToCompanyMap             dealId -> [{id, typeId}]
 * @param {Object} companyDataMap               companyId -> {propName: value}
 * @param {Object} stageMap                     stageId -> stageLabel
 * @param {Object} pipelineMap                  pipelineId -> pipelineLabel
 * @param {Object} ownerMap                     ownerId -> "First Last"
 */
function writeToSheet(targetSheetName, deals, dealPropDefs, companyPropDefs, dealToCompanyMap, companyDataMap, stageMap, pipelineMap, ownerMap) {
  var ss = SpreadsheetApp.getActiveSpreadsheet();

  var sheet = ss.getSheetByName(targetSheetName);
  if (!sheet) {
    sheet = ss.insertSheet(targetSheetName);
  }
  sheet.clearContents();
  sheet.clearFormats();

  // Build headers — deal columns first, then "Company: " prefixed company columns
  var headers = dealPropDefs.map(function(d) { return d.label; })
    .concat(companyPropDefs.map(function(d) { return 'Company: ' + d.label; }));
  var totalCols    = headers.length;
  var dealColCount = dealPropDefs.length;

  // Expand sheet columns if needed
  if (sheet.getMaxColumns() < totalCols) {
    sheet.insertColumnsAfter(sheet.getMaxColumns(), totalCols - sheet.getMaxColumns());
  }

  // ── Build data rows ──────────────────────────────────────
  var allRows = [headers];

  deals.forEach(function(deal) {
    var dealProps = deal.properties || {};

    var dealRow = dealPropDefs.map(function(d) {
      var val = dealProps[d.name];
      if (val === null || val === undefined) return '';
      if (d.name === 'dealstage')        return stageMap[val]          || val;
      if (d.name === 'pipeline')         return pipelineMap[val]       || val;
      if (d.name === 'hubspot_owner_id') return ownerMap[String(val)]  || val;
      return val;
    });

    var associations = dealToCompanyMap[deal.id] || [];

    if (MULTI_COMPANY_STRATEGY === 'ALL_ROWS' && associations.length > 1) {
      associations.forEach(function(assoc) {
        var cProps = companyDataMap[assoc.id] || {};
        var cRow = companyPropDefs.map(function(d) {
          var val = cProps[d.name];
          return val !== null && val !== undefined ? val : '';
        });
        allRows.push(dealRow.concat(cRow));
      });
    } else {
      var primaryAssoc = associations.length > 0 ? associations[0] : null;
      var companyProps = primaryAssoc ? (companyDataMap[primaryAssoc.id] || {}) : {};
      var cRow = companyPropDefs.map(function(d) {
        var val = companyProps[d.name];
        return val !== null && val !== undefined ? val : '';
      });
      allRows.push(dealRow.concat(cRow));
    }
  });

  // ── Write in batches ─────────────────────────────────────
  var totalRows = allRows.length;
  var startRow  = 1;

  for (var i = 0; i < totalRows; i += WRITE_BATCH_SIZE) {
    var batch = allRows.slice(i, i + WRITE_BATCH_SIZE);
    if (sheet.getMaxRows() < startRow + batch.length - 1) {
      sheet.insertRowsAfter(sheet.getMaxRows(), startRow + batch.length - 1 - sheet.getMaxRows());
    }
    sheet.getRange(startRow, 1, batch.length, totalCols).setValues(batch);
    startRow += batch.length;
    if (i > 0) {
      ss.toast('Writing rows ' + i + '–' + Math.min(i + WRITE_BATCH_SIZE, totalRows) + '...', 'HubSpot Sync');
    }
  }

  // ── Header formatting: blue for deal cols, teal for company cols ──
  if (dealColCount > 0) {
    var dealHeaderRange = sheet.getRange(1, 1, 1, dealColCount);
    dealHeaderRange.setFontWeight('bold').setBackground('#1a73e8').setFontColor('#ffffff').setWrap(false);
  }
  if (companyPropDefs.length > 0) {
    var coHeaderRange = sheet.getRange(1, dealColCount + 1, 1, companyPropDefs.length);
    coHeaderRange.setFontWeight('bold').setBackground('#0f9d58').setFontColor('#ffffff').setWrap(false);
  }

  // ── Standard cell sizing ─────────────────────────────────
  for (var c = 1; c <= totalCols; c++) {
    sheet.setColumnWidth(c, isWideColumn(headers[c - 1]) ? COL_WIDTH_NAME : COL_WIDTH_DEFAULT);
  }
  sheet.setRowHeight(1, ROW_HEIGHT_HEADER);
  var dataRows = allRows.length - 1;
  if (dataRows > 0) {
    sheet.setRowHeightsForced(2, dataRows, ROW_HEIGHT_DATA);
    sheet.getRange(2, 1, dataRows, totalCols).setWrap(false);
  }

  // ── Freeze and activate ───────────────────────────────────
  sheet.setFrozenRows(1);
  sheet.setFrozenColumns(2);
  ss.setActiveSheet(sheet);
}
