// ============================================================
// utils.gs — Shared helpers
// ============================================================

/**
 * Reads the HubSpot private app token from Script Properties.
 * @returns {string}
 */
function getToken() {
  var token = PropertiesService.getScriptProperties().getProperty(HUBSPOT_TOKEN_KEY);
  if (!token) {
    throw new Error(
      'HubSpot token not set. Go to Extensions > Apps Script > Project Settings > ' +
      'Script Properties and add key "' + HUBSPOT_TOKEN_KEY + '" with your private app token.'
    );
  }
  return token;
}

/**
 * Splits an array into chunks of at most `size` elements.
 * @param {any[]} arr
 * @param {number} size
 * @returns {any[][]}
 */
function chunkArray(arr, size) {
  var chunks = [];
  for (var i = 0; i < arr.length; i += size) {
    chunks.push(arr.slice(i, i + size));
  }
  return chunks;
}

/**
 * Filters and reorders a property definitions array to match wantedLabels (case-insensitive).
 * Preserves the order of wantedLabels. Silently skips labels not found in propDefs.
 * @param {{ name: string, label: string }[]} propDefs
 * @param {string[]} wantedLabels
 * @returns {{ name: string, label: string }[]}
 */
function filterToWantedColumns(propDefs, wantedLabels) {
  var labelMap = {};
  propDefs.forEach(function(d) {
    labelMap[d.label.toLowerCase()] = d;
  });
  var result = [];
  wantedLabels.forEach(function(label) {
    var def = labelMap[label.toLowerCase()];
    if (def) {
      result.push(def);
    } else {
      console.warn('HubSpot column not found (skipped): ' + label);
    }
  });
  return result;
}

/**
 * Returns unique values from an array.
 * @param {any[]} arr
 * @returns {any[]}
 */
function uniqueArray(arr) {
  var seen = {};
  var result = [];
  for (var i = 0; i < arr.length; i++) {
    if (!seen[arr[i]]) {
      seen[arr[i]] = true;
      result.push(arr[i]);
    }
  }
  return result;
}
