/**
 * CVQ Hub — API Router
 * Handles all HTTP requests from the PWA.
 * Every request must include a valid Google ID token and an `action`.
 *
 * Deploy as Web App:
 *   Execute as:  Me (your-email@gmail.com)
 *   Access:      Anyone
 */

// ============================================================================
// HTTP ENTRY POINTS
// ============================================================================

function doGet(e) {
  return handleRequest_(e);
}

function doPost(e) {
  return handleRequest_(e);
}

// ============================================================================
// MAIN HANDLER
// ============================================================================

function handleRequest_(e) {
  try {
    // ----- Parse request -----
    const body = e.postData ? JSON.parse(e.postData.contents) : e.parameter || {};

    const action = body.action || e.parameter.action;
    if (!action) throw new Error('Missing action');

    // ----- Authenticate -----
    const user = verifyUser_(body.idToken);
    const role = getUserRole_(user.email);

    // ----- Route -----
    let result;
    if (action === 'bulkSync') {
      result = bulkSync_(body.items, user, role);
    } else {
      result = route_(action, body, user, role);
    }

    // ----- Audit log writes -----
    if (/^(create|update|delete|upload)/.test(action)) {
      logAudit_(user, role, action, body);
    }

    return json_({ ok: true, data: result, role: role });
  } catch (err) {
    console.error('API error:', err.message, err.stack);
    return json_({ ok: false, error: err.message });
  }
}

// ============================================================================
// AUTH
// ============================================================================

function verifyUser_(idToken) {
  if (!idToken) throw new Error('Missing idToken');
  if (String(idToken).startsWith('demo-token-')) {
    // Allow demo-mode tokens for local testing
    return {
      uid: 'demo-user',
      email: 'demo@cvq.local',
      name: 'Demo Teacher',
    };
  }

  const res = UrlFetchApp.fetch(
    'https://oauth2.googleapis.com/tokeninfo?id_token=' + encodeURIComponent(idToken),
    { muteHttpExceptions: true }
  );
  const info = JSON.parse(res.getContentText());

  if (info.error_description || !info.email) {
    throw new Error('Invalid ID token: ' + (info.error_description || 'no email'));
  }

  // Upsert user
  const existing = findRow_('Users', (r) => r.email === info.email);
  if (!existing) {
    appendRow_('Users', {
      id: info.sub,
      email: info.email,
      name: info.name || '',
      picture: info.picture || '',
      role: 'teacher',
      active: true,
      createdAt: new Date().toISOString(),
      lastSeenAt: new Date().toISOString(),
    });
  } else {
    updateRow_('Users', existing.id, { lastSeenAt: new Date().toISOString() });
  }

  return { uid: info.sub, email: info.email, name: info.name };
}

function getUserRole_(email) {
  const u = findRow_('Users', (r) => r.email === email);
  return (u && u.role) || 'teacher';
}

// ============================================================================
// ROUTER
// ============================================================================

function route_(action, body, user, role) {
  const isCoordinator = role === 'coordinator';

  // Helper: filter rows by current teacher's ownership
  const mine = (sheetName) => {
    const all = readSheet_(sheetName);
    if (isCoordinator) return all;
    return all.filter((r) => r.teacherId === user.uid);
  };

  switch (action) {
    // ---------- LIST ----------
    case 'listClasses':
      return mine('Classes');
    case 'listStudents':
      return mine('Students');
    case 'listWorklogs':
      return mine('Worklogs');
    case 'listMarks':
      return mine('Marks');
    case 'listAttendance':
      return mine('Attendance');
    case 'listMedia':
      return mine('Media');
    case 'listSemesters':
      return mine('Semesters');

    // ---------- CREATE ----------
    case 'createClass':
    case 'createStudent':
    case 'createWorklog':
    case 'createMark':
    case 'createAttendance':
    case 'createSemester':
      return handleCreate_(action, body, user);

    // ---------- UPDATE ----------
    case 'updateClass':
    case 'updateStudent':
    case 'updateWorklog':
    case 'updateMark':
    case 'updateAttendance':
    case 'updateSemester':
      return handleUpdate_(action, body, user, isCoordinator);

    // ---------- DELETE ----------
    case 'deleteClass':
    case 'deleteStudent':
    case 'deleteWorklog':
    case 'deleteMark':
    case 'deleteAttendance':
    case 'deleteSemester':
      return handleDelete_(action, body, user, isCoordinator);

    // ---------- MEDIA ----------
    case 'uploadMedia':
      return handleUpload_(body, user);
    case 'deleteMedia':
      return handleDeleteMedia_(body, user, isCoordinator);

    // ---------- COORDINATOR ONLY ----------
    case 'listUsers':
      if (!isCoordinator) throw new Error('Forbidden: coordinator only');
      return readSheet_('Users');
    case 'setUserRole':
      if (!isCoordinator) throw new Error('Forbidden: coordinator only');
      return updateRow_('Users', body.id, { role: body.role });

    // ---------- COORDINATOR STATS ----------
    case 'getCoordinatorStats':
      if (!isCoordinator) throw new Error('Forbidden: coordinator only');
      return getCoordinatorStats_();

    case 'listAuditLog':
      if (!isCoordinator) throw new Error('Forbidden: coordinator only');
      return readSheet_('AuditLog');

    case 'updateUser':
      if (!isCoordinator) throw new Error('Forbidden: coordinator only');
      return updateRow_('Users', body.id, body.patch || {});

    default:
      throw new Error('Unknown action: ' + action);
  }
}

// ============================================================================
// CRUD HANDLERS
// ============================================================================

// ---------- Sheet name mapping (action suffix → sheet name) ----------

function actionToSheet_(action) {
  const key = action.replace(/^(create|update|delete)/, '');
  const map = {
    Class: 'Classes',
    Student: 'Students',
    Worklog: 'Worklogs',
    Mark: 'Marks',
    Attendance: 'Attendance',
    Semester: 'Semesters',
    Media: 'Media',
  };
  const sheetName = map[key];
  if (!sheetName) throw new Error('Unknown sheet for action: ' + action);
  return sheetName;
}

// ---------- CRUD HANDLERS ----------

function handleCreate_(action, body, user) {
  const sheetName = actionToSheet_(action);
  const payload = { ...body, teacherId: user.uid };
  delete payload.action;
  delete payload.idToken;

  if (!payload.id) payload.id = Utilities.getUuid();
  if (!payload.createdAt) payload.createdAt = new Date().toISOString();

  return appendRow_(sheetName, payload);
}

function handleUpdate_(action, body, user, isCoordinator) {
  const sheetName = actionToSheet_(action);
  const existing = findRow_(sheetName, (r) => String(r.id) === String(body.id));

  if (!existing) throw new Error('Not found: ' + body.id);
  if (!isCoordinator && existing.teacherId !== user.uid) {
    throw new Error('Forbidden: not your record');
  }

  return updateRow_(sheetName, body.id, body.patch || {});
}

function handleDelete_(action, body, user, isCoordinator) {
  const sheetName = actionToSheet_(action);
  const existing = findRow_(sheetName, (r) => String(r.id) === String(body.id));

  if (!existing) throw new Error('Not found: ' + body.id);
  if (!isCoordinator && existing.teacherId !== user.uid) {
    throw new Error('Forbidden: not your record');
  }

  deleteRow_(sheetName, body.id);
  return true;
}

function handleUpload_(body, user) {
  const folderId = getEvidenceFolderId_();
  const folder = DriveApp.getFolderById(folderId);

  const blob = Utilities.newBlob(Utilities.base64Decode(body.base64), body.mimeType, body.fileName);
  const file = folder.createFile(blob);
  file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);

  const record = {
    id: body.id || Utilities.getUuid(),
    classId: body.classId || '',
    teacherId: user.uid,
    refType: body.refType || 'worklog',
    refId: body.refId || '',
    fileId: file.getId(),
    fileName: body.fileName,
    mimeType: body.mimeType,
    size: body.size || 0,
    url: file.getUrl(),
    thumbnail: file.getThumbnailUrl ? file.getThumbnailUrl() : '',
    capturedAt: body.capturedAt || new Date().toISOString(),
    createdAt: new Date().toISOString(),
  };

  appendRow_('Media', record);
  return record;
}

function handleDeleteMedia_(body, user, isCoordinator) {
  const existing = findRow_('Media', (r) => String(r.id) === String(body.id));
  if (!existing) return true;
  if (!isCoordinator && existing.teacherId !== user.uid) {
    throw new Error('Forbidden');
  }
  if (existing.fileId) {
    try {
      DriveApp.getFileById(existing.fileId).setTrashed(true);
    } catch (e) {}
  }
  deleteRow_('Media', body.id);
  return true;
}

// ============================================================================
// BULK SYNC (for offline queue)
// ============================================================================

function bulkSync_(items, user, role) {
  if (!Array.isArray(items)) return [];
  return items.map((item) => {
    try {
      const data = route_(item.action, item.body, user, role);
      return { id: item.id, ok: true, data: data };
    } catch (err) {
      return { id: item.id, ok: false, error: err.message };
    }
  });
}

// ============================================================================
// LOW-LEVEL SHEET HELPERS
// ============================================================================

function getSheet_(name) {
  const sheet = getSpreadsheet_().getSheetByName(name);
  if (!sheet) throw new Error('Sheet not found: ' + name);
  return sheet;
}

function readSheet_(name) {
  const sheet = getSheet_(name);
  const values = sheet.getDataRange().getValues();
  if (values.length < 2) return [];

  const headers = values[0];
  const idCol = headers.indexOf('id');

  return values
    .slice(1)
    .filter((row) => {
      // Require the `id` column to have a real value.
      // This filters out phantom rows that have formatted cells or default false checkboxes.
      if (idCol === -1) {
        return row.some((c) => c !== '' && c !== null && c !== undefined);
      }
      const id = row[idCol];
      return id !== '' && id !== null && id !== undefined;
    })
    .map((row) => Object.fromEntries(headers.map((h, i) => [h, row[i]])));
}

function findRow_(name, predicate) {
  return readSheet_(name).find(predicate);
}

function appendRow_(name, obj) {
  const sheet = getSheet_(name);
  const headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
  const row = headers.map((h) => (obj[h] !== undefined ? obj[h] : ''));

  // Find the first truly empty data row (starting from row 2),
  // ignoring rows that only have formulas or formatting.
  const dataRange = sheet.getRange(2, 1, sheet.getMaxRows() - 1, 1).getValues();
  let targetRow = sheet.getLastRow() + 1; // fallback
  for (let i = 0; i < dataRange.length; i++) {
    if (!dataRange[i][0]) {
      targetRow = i + 2;
      break;
    }
  }

  sheet.getRange(targetRow, 1, 1, row.length).setValues([row]);
  return obj;
}

function updateRow_(name, id, patch) {
  const sheet = getSheet_(name);
  const values = sheet.getDataRange().getValues();
  const headers = values[0];
  const idCol = headers.indexOf('id');

  for (let i = 1; i < values.length; i++) {
    if (String(values[i][idCol]) === String(id)) {
      headers.forEach((h, c) => {
        if (h in patch) sheet.getRange(i + 1, c + 1).setValue(patch[h]);
      });
      const merged = Object.fromEntries(headers.map((h, c) => [h, values[i][c]]));
      return { ...merged, ...patch };
    }
  }
  throw new Error('Not found: ' + id);
}

function deleteRow_(name, id) {
  const sheet = getSheet_(name);
  const values = sheet.getDataRange().getValues();
  const idCol = values[0].indexOf('id');

  for (let i = 1; i < values.length; i++) {
    if (String(values[i][idCol]) === String(id)) {
      sheet.deleteRow(i + 1);
      return true;
    }
  }
  return false;
}

// ============================================================================
// AUDIT LOG
// ============================================================================

function logAudit_(user, role, action, body) {
  try {
    const targetSheet = action
      .replace(/^(create|update|delete|upload)/, '')
      .replace(/Media$/, 'Media');

    appendRow_('AuditLog', {
      id: Utilities.getUuid(),
      userId: user.uid,
      email: user.email,
      role: role,
      action: action,
      targetSheet: targetSheet,
      targetId: body.id || '',
      timestamp: new Date().toISOString(),
    });
  } catch (e) {
    console.error('Audit log failed:', e.message);
  }
}

// ============================================================================
// DRIVE FOLDER FOR EVIDENCE
// ============================================================================

function getEvidenceFolderId_() {
  const props = PropertiesService.getScriptProperties();
  let folderId = props.getProperty('EVIDENCE_FOLDER_ID');

  if (!folderId) {
    // Create folder on first call
    const folder = DriveApp.createFolder('CVQ Hub Evidence');
    folder.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
    folderId = folder.getId();
    props.setProperty('EVIDENCE_FOLDER_ID', folderId);
    console.log('Created evidence folder:', folderId);
  }

  return folderId;
}

// ============================================================================
// COORDINATOR STATS
// ============================================================================

function getCoordinatorStats_() {
  const users = readSheet_('Users');
  const classes = readSheet_('Classes');
  const students = readSheet_('Students');
  const worklogs = readSheet_('Worklogs');
  const marks = readSheet_('Marks');
  const attendance = readSheet_('Attendance');
  const media = readSheet_('Media');

  // Helper: count by teacherId
  function countByTeacher(rows) {
    const map = {};
    rows.forEach((r) => {
      const id = r.teacherId || '';
      if (!id) return;
      map[id] = (map[id] || 0) + 1;
    });
    return map;
  }

  // Helper: sum hours by teacherId
  function hoursByTeacher(rows) {
    const map = {};
    rows.forEach((r) => {
      const id = r.teacherId || '';
      if (!id) return;
      const hours = (parseFloat(r.duration) || 0) * (parseInt(r.sessions, 10) || 1);
      map[id] = (map[id] || 0) + hours;
    });
    return map;
  }

  const classesByTeacher = countByTeacher(classes);
  const studentsByTeacher = countByTeacher(students);
  const worklogsByTeacher = countByTeacher(worklogs);
  const marksByTeacher = countByTeacher(marks);
  const attendanceByTeacher = countByTeacher(attendance);
  const mediaByTeacher = countByTeacher(media);
  const hoursByTeacherMap = hoursByTeacher(worklogs);

  // Per-teacher summary
  const teachers = users.map((u) => ({
    uid: u.id,
    email: u.email,
    name: u.name || '',
    picture: u.picture || '',
    role: u.role || 'teacher',
    active: u.active === true || String(u.active).toLowerCase() === 'true',
    lastSeenAt: u.lastSeenAt || '',
    createdAt: u.createdAt || '',
    stats: {
      classes: classesByTeacher[u.id] || 0,
      students: studentsByTeacher[u.id] || 0,
      worklogs: worklogsByTeacher[u.id] || 0,
      marks: marksByTeacher[u.id] || 0,
      attendance: attendanceByTeacher[u.id] || 0,
      media: mediaByTeacher[u.id] || 0,
      hours: Math.round((hoursByTeacherMap[u.id] || 0) * 10) / 10,
    },
  }));

  // Totals across the whole system
  const totalHours = worklogs.reduce((sum, w) => {
    return sum + (parseFloat(w.duration) || 0) * (parseInt(w.sessions, 10) || 1);
  }, 0);

  return {
    totals: {
      teachers: users.length,
      coordinators: users.filter((u) => u.role === 'coordinator').length,
      activeTeachers: users.filter(
        (u) => u.active === true || String(u.active).toLowerCase() === 'true'
      ).length,
      classes: classes.length,
      students: students.length,
      worklogs: worklogs.length,
      marks: marks.length,
      attendance: attendance.length,
      media: media.length,
      hours: Math.round(totalHours * 10) / 10,
    },
    teachers,
    generatedAt: new Date().toISOString(),
  };
}

// ============================================================================
// JSON RESPONSE
// ============================================================================

function json_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(
    ContentService.MimeType.JSON
  );
}

// ============================================================================
// DIAGNOSTIC
// ============================================================================

/**
 * Test the API without a browser.
 * Run this from the Apps Script editor to verify the router works.
 */
function testApi() {
  const testUser = { uid: 'test-user', email: 'test@example.com', name: 'Test' };
  const students = route_('listStudents', {}, testUser, 'teacher');
  console.log('listStudents returned', students.length, 'rows');
  console.log(JSON.stringify(students.slice(0, 3), null, 2));
}
