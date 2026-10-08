// =============================================================================
// backend/Bootstrap.gs
//
// MIRROR FILE — Creates all CVQ Hub sheets with headers, formats, validations.
// Runs once in Google Apps Script. Keep in sync with the live version.
//
// Usage in Apps Script:
//   1. Paste this file into a script called "Bootstrap"
//   2. Run setupCVQHub() once
//   3. Verify 9 sheets are created with correct headers
// =============================================================================

const SPREADSHEET_ID = '';

const BRAND = {
  primary: '#0f766e',
  primaryDark: '#0b5a54',
  surface: '#ffffff',
  surfaceAlt: '#f8fafb',
  border: '#e2e8ed',
  text: '#0f172a',
  textLight: '#64748b',
};

const SHEETS = {
  Users: {
    headers: ['id', 'email', 'name', 'picture', 'role', 'active', 'createdAt', 'lastSeenAt'],
    widths: [260, 240, 200, 260, 120, 80, 170, 170],
    formats: { 7: 'yyyy-mm-dd hh:mm', 8: 'yyyy-mm-dd hh:mm' },
    validations: {
      5: { type: 'list', values: ['teacher', 'coordinator'] },
      6: { type: 'boolean' },
    },
    frozen: 1,
  },

  Classes: {
    headers: [
      'id',
      'teacherId',
      'name',
      'subject',
      'description',
      'semesterId',
      'archived',
      'createdAt',
    ],
    widths: [260, 260, 220, 160, 300, 260, 90, 170],
    formats: { 8: 'yyyy-mm-dd hh:mm' },
    validations: { 7: { type: 'boolean' } },
    frozen: 1,
  },

  Semesters: {
    headers: ['id', 'teacherId', 'name', 'startDate', 'endDate', 'active', 'createdAt'],
    widths: [260, 260, 200, 120, 120, 90, 170],
    formats: { 4: 'yyyy-mm-dd', 5: 'yyyy-mm-dd', 7: 'yyyy-mm-dd hh:mm' },
    validations: { 6: { type: 'boolean' } },
    frozen: 1,
  },

  Students: {
    headers: [
      'id',
      'classId',
      'teacherId',
      'name',
      'studentId',
      'gender',
      'email',
      'phone',
      'notes',
      'createdAt',
    ],
    widths: [260, 260, 260, 200, 140, 110, 220, 150, 260, 170],
    formats: { 10: 'yyyy-mm-dd hh:mm' },
    validations: {
      6: { type: 'list', values: ['Male', 'Female', 'Other'] },
    },
    frozen: 1,
  },

  Worklogs: {
    headers: [
      'id',
      'classId',
      'teacherId',
      'type',
      'entityId',
      'entityName',
      'date',
      'subject',
      'topic',
      'duration',
      'sessions',
      'traineesCount',
      'description',
      'outcomes',
      'nextSteps',
      'notes',
      'createdAt',
    ],
    widths: [260, 260, 260, 130, 260, 200, 110, 160, 200, 110, 90, 130, 340, 300, 300, 300, 170],
    formats: { 7: 'yyyy-mm-dd', 10: '0.00', 11: '0', 12: '0', 17: 'yyyy-mm-dd hh:mm' },
    validations: {
      4: { type: 'list', values: ['trainee', 'group', 'admin'] },
      10: { type: 'number', min: 0.25, max: 24 },
      11: { type: 'number', min: 1, max: 20 },
    },
    frozen: 1,
  },

  Marks: {
    headers: [
      'id',
      'classId',
      'teacherId',
      'studentId',
      'subject',
      'topic',
      'date',
      'score',
      'maxScore',
      'percentage',
      'grade',
      'notes',
      'createdAt',
    ],
    widths: [260, 260, 260, 260, 160, 200, 110, 90, 110, 110, 90, 300, 170],
    formats: { 7: 'yyyy-mm-dd', 8: '0.00', 9: '0.00', 10: '0.0"%"', 13: 'yyyy-mm-dd hh:mm' },
    frozen: 1,
  },

  Attendance: {
    headers: [
      'id',
      'classId',
      'teacherId',
      'studentId',
      'studentName',
      'date',
      'status',
      'subject',
      'topic',
      'notes',
      'createdAt',
    ],
    widths: [260, 260, 260, 260, 200, 110, 110, 160, 200, 300, 170],
    formats: { 6: 'yyyy-mm-dd', 11: 'yyyy-mm-dd hh:mm' },
    validations: {
      7: { type: 'list', values: ['present', 'late', 'absent', 'excused'] },
    },
    frozen: 1,
  },

  Media: {
    headers: [
      'id',
      'classId',
      'teacherId',
      'refType',
      'refId',
      'fileId',
      'fileName',
      'mimeType',
      'size',
      'url',
      'thumbnail',
      'capturedAt',
      'createdAt',
    ],
    widths: [260, 260, 260, 140, 260, 300, 240, 160, 110, 380, 380, 170, 170],
    formats: { 9: '#,##0', 12: 'yyyy-mm-dd hh:mm', 13: 'yyyy-mm-dd hh:mm' },
    frozen: 1,
  },

  AuditLog: {
    headers: ['id', 'userId', 'email', 'role', 'action', 'targetSheet', 'targetId', 'timestamp'],
    widths: [260, 260, 240, 120, 200, 140, 260, 170],
    formats: { 8: 'yyyy-mm-dd hh:mm:ss' },
    frozen: 1,
  },
};

function setupCVQHub() {
  const ss = getSpreadsheet_();
  const log = [];
  try {
    ss.setSpreadsheetLocale('en_US');
  } catch (e) {}

  Object.keys(SHEETS).forEach((name) => {
    const def = SHEETS[name];
    const sheet = ensureSheet_(ss, name);
    buildSheet_(sheet, def, name);
    log.push('✔ ' + name);
  });

  const sheet1 = ss.getSheetByName('Sheet1');
  if (sheet1 && sheet1.getLastRow() === 0 && sheet1.getLastColumn() === 0) {
    try {
      ss.deleteSheet(sheet1);
      log.push('✔ removed Sheet1');
    } catch (e) {}
  }

  const order = [
    'Users',
    'Classes',
    'Semesters',
    'Students',
    'Worklogs',
    'Marks',
    'Attendance',
    'Media',
    'AuditLog',
  ];
  order.forEach((name, i) => {
    const s = ss.getSheetByName(name);
    if (s) {
      ss.setActiveSheet(s);
      ss.moveActiveSheet(i + 1);
    }
  });

  SpreadsheetApp.getActive().toast('CVQ Hub schema ready!', 'Setup complete', 8);
  console.log('Setup complete:\n' + log.join('\n'));
  return 'OK';
}

function getSpreadsheet_() {
  if (SPREADSHEET_ID) return SpreadsheetApp.openById(SPREADSHEET_ID);
  const active = SpreadsheetApp.getActive();
  if (!active) throw new Error('No spreadsheet ID and not bound to a sheet.');
  return active;
}

function ensureSheet_(ss, name) {
  let sheet = ss.getSheetByName(name);
  if (!sheet) sheet = ss.insertSheet(name);
  return sheet;
}

function buildSheet_(sheet, def, name) {
  sheet.clear();
  sheet.clearConditionalFormatRules();
  sheet.getBandings().forEach((b) => b.remove());

  const headers = def.headers;
  const headerRange = sheet.getRange(1, 1, 1, headers.length);
  headerRange.setValues([headers]);
  headerRange
    .setBackground(BRAND.primary)
    .setFontColor(BRAND.surface)
    .setFontWeight('bold')
    .setFontSize(11);
  sheet.setRowHeight(1, 36);

  if (def.frozen) sheet.setFrozenRows(def.frozen);
  if (def.widths) def.widths.forEach((w, i) => sheet.setColumnWidth(i + 1, w));

  if (def.formats) {
    Object.entries(def.formats).forEach(([colIdx, fmt]) => {
      const col = Number(colIdx);
      sheet.getRange(2, col, sheet.getMaxRows() - 1, 1).setNumberFormat(fmt);
    });
  }

  if (def.validations) {
    Object.entries(def.validations).forEach(([colIdx, rule]) => {
      const col = Number(colIdx);
      const range = sheet.getRange(2, col, sheet.getMaxRows() - 1, 1);
      const builder = SpreadsheetApp.newDataValidation().setAllowInvalid(false);
      if (rule.type === 'list') builder.requireValueInList(rule.values, true);
      else if (rule.type === 'number') builder.requireNumberBetween(rule.min, rule.max);
      else if (rule.type === 'boolean') builder.requireCheckbox();
      range.setDataValidation(builder.build());
    });
  }

  const dataRange = sheet.getRange(1, 1, Math.max(sheet.getMaxRows(), 2), headers.length);
  dataRange.applyRowBanding(SpreadsheetApp.BandingTheme.LIGHT_GREY, true, false);

  try {
    const protection = headerRange.protect().setDescription(name + ' header');
    protection.removeEditors(protection.getEditors());
    if (protection.canDomainEdit()) protection.setDomainEdit(false);
  } catch (e) {}
}
