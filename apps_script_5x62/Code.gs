/**
 * Revisión humana ciega con cinco revisores y 270 artículos únicos.
 *
 * Configuración requerida en Propiedades del script:
 * - R5X62_ASSIGNMENTS_CSV_FILE_ID
 * - R5X62_PDF_FOLDER_ID
 *
 * setup_inicial() crea la hoja de cálculo, importa las 310 asignaciones,
 * resuelve los 270 PDF y genera la credencial privada del administrador.
 * Los candidatos se autorregistran, crean su clave personal y solo reciben un
 * lote después de la aprobación administrativa. Las decisiones IA no se importan.
 */

const R5X62 = Object.freeze({
  REVIEWERS: ['REVISOR-1', 'REVISOR-2', 'REVISOR-3', 'REVISOR-4', 'REVISOR-5'],
  SHEET_PROP: 'R5X62_SHEET_ID',
  CSV_PROP: 'R5X62_ASSIGNMENTS_CSV_FILE_ID',
  FOLDER_PROP: 'R5X62_PDF_FOLDER_ID',
  LOT_ROOT_FOLDER_PROP: 'R5X62_LOT_ROOT_FOLDER_ID',
  REVIEWER_FOLDER_PROP_PREFIX: 'R5X62_REVIEWER_FOLDER_',
  ADMIN_HASH_PROP: 'R5X62_ADMIN_HASH',
  PRIVATE_CREDENTIALS: 'credenciales_privadas',
  PRIVATE_INVITATIONS: 'invitaciones_privadas',
  ACCESS_REQUESTS: 'solicitudes_acceso',
  ASSIGNMENTS: 'asignaciones',
  EVALUATIONS: 'evaluaciones',
  PARTICIPANTS: 'participantes',
  AUDIT: 'auditoria',
  TIMEZONE: 'America/Asuncion',
});

const ASSIGNMENT_HEADERS = [
  'assignment_id', 'reviewer_id', 'review_order', 'case_code',
  'openalex_work_id', 'pdf_file_name', 'titulo', 'anio', 'macroarea',
  'revista', 'doi', 'es_comun', 'pdf_file_id', 'pdf_preview_url',
];

const EVALUATION_HEADERS = [
  'created_at', 'updated_at', 'assignment_id', 'reviewer_id', 'case_code',
  'identidad_pdf', 'estudio_sudamericano', 'pais_territorio',
  'estudio_muestral', 'unidad_observada', 'tamano_muestral',
  'mecanismo_seleccion', 'reconoce_limitaciones', 'extrapola',
  'paginas_evidencia', 'evidencia_breve', 'justificacion',
  'confianza', 'estado', 'version',
];

const AUDIT_HEADERS = [
  'timestamp', 'event', 'reviewer_id', 'assignment_id', 'case_code',
  'estado', 'version',
];

const PARTICIPANT_HEADERS = [
  'accepted_at', 'reviewer_id', 'reviewer_label', 'protocol_version',
  'nombre_completo', 'correo_google', 'institucion', 'pais',
  'especialidad', 'orcid', 'pdf_access_status', 'pdf_access_count',
];

const ACCESS_REQUEST_HEADERS = [
  'requested_at', 'request_id', 'status', 'nombre_completo',
  'correo_google', 'institucion', 'pais', 'especialidad', 'orcid',
  'protocol_version', 'personal_code_hash', 'decision_at',
  'reviewer_id', 'reviewer_label', 'pdf_access_status', 'pdf_access_count',
];

const VALID_VALUES = Object.freeze({
  identidad_pdf: ['SI', 'NO', 'INCIERTO'],
  estudio_sudamericano: ['SI', 'NO', 'INCIERTO'],
  estudio_muestral: ['SI', 'NO', 'INCIERTO'],
  mecanismo_seleccion: [
    'PROBABILISTICO', 'NO_PROBABILISTICO', 'CENSO',
    'NO_REPORTADO', 'NO_APLICA', 'INCIERTO',
  ],
  reconoce_limitaciones: ['SI', 'NO', 'INCIERTO', 'NO_APLICA'],
  extrapola: ['SI', 'NO', 'INCIERTO', 'NO_APLICA'],
  confianza: ['ALTA', 'MEDIA', 'BAJA'],
  estado: ['BORRADOR', 'FINAL'],
});


function doGet(e) {
  const view = String((e && e.parameter && e.parameter.view) || '').toLowerCase();
  const template = HtmlService.createTemplateFromFile(view === 'admin' ? 'Admin' : 'Index');
  template.appUrl = ScriptApp.getService().getUrl() || '';
  return template.evaluate()
    .setTitle(view === 'admin' ? 'Control de revisión de 270 artículos' : 'Revisión estadística de artículos')
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.DEFAULT);
}


function include(filename) {
  return HtmlService.createHtmlOutputFromFile(filename).getContent();
}


function setup_inicial() {
  const props = PropertiesService.getScriptProperties();
  const csvId = _requiredProperty_(props, R5X62.CSV_PROP);
  const folderId = _requiredProperty_(props, R5X62.FOLDER_PROP);
  if (props.getProperty(R5X62.SHEET_PROP)) {
    throw new Error('El proyecto ya tiene R5X62_SHEET_ID. No se sobrescribió nada.');
  }

  const rows = Utilities.parseCsv(
    DriveApp.getFileById(csvId).getBlob().getDataAsString('UTF-8')
      .replace(/^\uFEFF/, '')
  );
  if (rows.length !== 311) {
    throw new Error('El CSV debe contener encabezado y 310 asignaciones; filas=' + rows.length);
  }
  const sourceHeaders = rows[0].map(String);
  const sourceIndex = _headerIndex_(sourceHeaders);
  ASSIGNMENT_HEADERS.slice(0, 12).forEach(function (header) {
    if (sourceIndex[header] == null) throw new Error('Falta columna en CSV: ' + header);
  });

  const folder = DriveApp.getFolderById(folderId);
  const fileCache = {};
  const assignments = rows.slice(1).map(function (row) {
    const record = {};
    sourceHeaders.forEach(function (header, index) { record[header] = row[index]; });
    const fileName = String(record.pdf_file_name || '').trim();
    if (!fileCache[fileName]) {
      const matches = folder.getFilesByName(fileName);
      if (!matches.hasNext()) throw new Error('PDF no encontrado en carpeta: ' + fileName);
      const file = matches.next();
      if (matches.hasNext()) throw new Error('Nombre de PDF duplicado en carpeta: ' + fileName);
      fileCache[fileName] = {
        id: file.getId(),
        preview: 'https://drive.google.com/file/d/' + file.getId() + '/preview',
      };
    }
    return ASSIGNMENT_HEADERS.map(function (header) {
      if (header === 'pdf_file_id') return fileCache[fileName].id;
      if (header === 'pdf_preview_url') return fileCache[fileName].preview;
      return record[header] == null ? '' : record[header];
    });
  });
  if (Object.keys(fileCache).length !== 270) {
    throw new Error('Se esperaban 270 PDF únicos; encontrados=' + Object.keys(fileCache).length);
  }
  _validateImportedAssignments_(assignments);

  const ss = SpreadsheetApp.create('Revisión humana ciega de 270 artículos');
  const assignmentsSheet = ss.getSheets()[0].setName(R5X62.ASSIGNMENTS);
  _writeNewSheet_(assignmentsSheet, ASSIGNMENT_HEADERS, assignments);
  _writeNewSheet_(ss.insertSheet(R5X62.EVALUATIONS), EVALUATION_HEADERS, []);
  _writeNewSheet_(ss.insertSheet(R5X62.PARTICIPANTS), PARTICIPANT_HEADERS, []);
  _writeNewSheet_(ss.insertSheet(R5X62.ACCESS_REQUESTS), ACCESS_REQUEST_HEADERS, []);
  ss.getSheetByName(R5X62.ACCESS_REQUESTS).hideSheet();
  _writeNewSheet_(ss.insertSheet(R5X62.AUDIT), AUDIT_HEADERS, []);
  props.setProperty(R5X62.SHEET_PROP, ss.getId());

  const credentials = _rotateCredentials_();
  const privateSheets = _storePrivateAccessSheets_(credentials);
  const result = {
    sheet_id: ss.getId(),
    assignments: assignments.length,
    unique_pdfs: Object.keys(fileCache).length,
    private_credentials_sheet: privateSheets.credentials_sheet,
    private_invitations_sheet: privateSheets.invitations_sheet,
    warning: 'Las credenciales se guardaron en hojas ocultas de la planilla privada.',
  };
  Logger.log(JSON.stringify(result));
  return result;
}


function rotarCredenciales(adminCode) {
  _authenticateAdmin_(adminCode);
  return _rotateAndStoreCredentials_();
}


function rotarCredencialesDesdeEditor() {
  _assertOwnerEditor_();
  return _rotateAndStoreCredentials_();
}


function prepararLotesDesdeEditor() {
  _assertOwnerEditor_();
  const result = _prepareReviewerFolders_();
  Logger.log(JSON.stringify(result));
  return result;
}


function inicializarFlujoSolicitudesDesdeEditor() {
  _assertOwnerEditor_();
  const props = PropertiesService.getScriptProperties();
  R5X62.REVIEWERS.forEach(function (reviewer) {
    props.deleteProperty('R5X62_REVIEWER_HASH_' + reviewer);
  });
  const ss = _spreadsheet_();
  const requestSheet = _ensureAccessRequestSheet_(ss);
  const appUrl = ScriptApp.getService().getUrl() || '';
  _writePrivateSheet_(ss, R5X62.PRIVATE_INVITATIONS,
    ['generated_at', 'purpose', 'whatsapp_message'],
    [[new Date().toISOString(), 'SOLICITUD_PUBLICA', _publicInvitationMessage_(appUrl)]]);
  const result = {
    ok: true,
    access_request_sheet: R5X62.ACCESS_REQUESTS,
    access_request_sheet_hidden: requestSheet.isSheetHidden(),
    existing_requests: Math.max(0, requestSheet.getLastRow() - 1),
    invitation_sheet: R5X62.PRIVATE_INVITATIONS,
  };
  Logger.log(JSON.stringify(result));
  return result;
}


function validarDespliegueDesdeEditor() {
  _assertOwnerEditor_();
  const ss = _spreadsheet_();
  _ensureParticipantSchema_(ss.getSheetByName(R5X62.PARTICIPANTS));
  const accessRequestSheet = _ensureAccessRequestSheet_(ss);
  const credentialSheet = ss.getSheetByName(R5X62.PRIVATE_CREDENTIALS);
  const invitationSheet = ss.getSheetByName(R5X62.PRIVATE_INVITATIONS);
  if (!credentialSheet || !invitationSheet) {
    throw new Error('Faltan las hojas privadas de credenciales o invitaciones.');
  }
  const credentials = _readObjects_(credentialSheet);
  const admin = credentials.find(function (row) {
    return String(row.role) === 'ADMIN';
  });
  if (!admin) throw new Error('No se encontró la credencial administrativa privada.');
  _authenticateAdmin_(String(admin.access_code || ''));

  const assignments = _readObjects_(ss.getSheetByName(R5X62.ASSIGNMENTS));
  const reviewerChecks = R5X62.REVIEWERS.map(function (reviewer) {
    const assigned = assignments.filter(function (row) {
      return String(row.reviewer_id) === reviewer;
    }).length;
    if (assigned !== 62) {
      throw new Error(reviewer + ' tiene ' + assigned + ' asignaciones, se esperaban 62.');
    }
    return { reviewer_id: reviewer, assignments: assigned };
  });
  const uniqueCases = new Set(assignments.map(function (row) {
    return String(row.case_code);
  })).size;
  const commonCases = new Set(assignments.filter(function (row) {
    return _asBool_(row.es_comun);
  }).map(function (row) {
    return String(row.case_code);
  })).size;
  if (assignments.length !== 310 || uniqueCases !== 270 || commonCases !== 10) {
    throw new Error('El diseño cargado no coincide con 310 asignaciones, 270 casos y 10 comunes.');
  }
  const result = {
    ok: true,
    admin_authenticated: true,
    reviewer_slots_validated: reviewerChecks.length,
    reviewers: reviewerChecks,
    total_assignments: assignments.length,
    unique_cases: uniqueCases,
    common_cases: commonCases,
    private_sheets_hidden: credentialSheet.isSheetHidden() && invitationSheet.isSheetHidden(),
    access_request_sheet_hidden: accessRequestSheet.isSheetHidden(),
    access_requests: Math.max(0, accessRequestSheet.getLastRow() - 1),
    reviewer_folders: _reviewerFolderStatus_(),
  };
  Logger.log(JSON.stringify(result));
  return result;
}


function _assertOwnerEditor_() {
  const active = String(Session.getActiveUser().getEmail() || '').toLowerCase();
  const owner = String(Session.getEffectiveUser().getEmail() || '').toLowerCase();
  if (!active || active !== owner) {
    throw new Error('Esta función solo puede ejecutarla el propietario desde el editor.');
  }
}


function _rotateAndStoreCredentials_() {
  const privateSheets = _storePrivateAccessSheets_(_rotateCredentials_());
  const result = {
    rotated: true,
    private_credentials_sheet: privateSheets.credentials_sheet,
    private_invitations_sheet: privateSheets.invitations_sheet,
  };
  Logger.log(JSON.stringify(result));
  return result;
}


function _rotateCredentials_() {
  const props = PropertiesService.getScriptProperties();
  const credentials = { admin: _newAccessCode_() };
  props.setProperty(R5X62.ADMIN_HASH_PROP, _hash_(credentials.admin));
  R5X62.REVIEWERS.forEach(function (reviewer) {
    props.deleteProperty('R5X62_REVIEWER_HASH_' + reviewer);
  });
  return credentials;
}


function _storePrivateAccessSheets_(credentials) {
  const generatedAt = new Date().toISOString();
  const appUrl = ScriptApp.getService().getUrl() || '';
  const credentialRows = [[
    generatedAt, 'ADMIN', '', 'Administrador', credentials.admin,
    appUrl + '?view=admin',
  ]];
  const invitationRows = [[generatedAt, 'SOLICITUD_PUBLICA', _publicInvitationMessage_(appUrl)]];
  const ss = _spreadsheet_();
  _writePrivateSheet_(ss, R5X62.PRIVATE_CREDENTIALS,
    ['generated_at', 'role', 'reviewer_id', 'reviewer_label', 'access_code', 'url'],
    credentialRows);
  _writePrivateSheet_(ss, R5X62.PRIVATE_INVITATIONS,
    ['generated_at', 'purpose', 'whatsapp_message'], invitationRows);
  return {
    credentials_sheet: R5X62.PRIVATE_CREDENTIALS,
    invitations_sheet: R5X62.PRIVATE_INVITATIONS,
  };
}


function _publicInvitationMessage_(appUrl) {
  return [
    'FECHA LÍMITE: [AAAA-MM-DD]',
    '',
    'Hola. Le invito a solicitar su participación como revisor/a estadístico/a',
    'independiente de artículos científicos sobre estudios sudamericanos basados en muestras.',
    '',
    'Aplicación: ' + appUrl,
    '',
    'Abra el enlace, inicie sesión en Google y pulse “Solicitar participación”.',
    'Complete sus datos, cree su clave personal y acepte el protocolo.',
    'Su solicitud quedará pendiente de aprobación. No necesita un código previo.',
    'Cuando sea aprobada, podrá ingresar con su correo y su clave personal.',
    '',
    'Cada persona aprobada evaluará de manera independiente un lote de 62 artículos.',
    'Muchas gracias por su colaboración.',
    'Diego Meza',
  ].join('\n');
}


function _writePrivateSheet_(ss, sheetName, headers, rows) {
  let sheet = ss.getSheetByName(sheetName);
  if (!sheet) sheet = ss.insertSheet(sheetName);
  if (sheet.isSheetHidden()) sheet.showSheet();
  sheet.clear();
  sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
  if (rows.length) sheet.getRange(2, 1, rows.length, headers.length).setValues(rows);
  sheet.setFrozenRows(1);
  sheet.autoResizeColumns(1, headers.length);
  sheet.hideSheet();
}


function _prepareReviewerFolders_() {
  const props = PropertiesService.getScriptProperties();
  const master = DriveApp.getFolderById(_requiredProperty_(props, R5X62.FOLDER_PROP));
  const lotRoot = _getOrCreateChildFolder_(master, 'LOTES_REVISORES');
  const commonMasters = _getOrCreateChildFolder_(master, 'COMUNES_MAESTROS_PRIVADOS');
  props.setProperty(R5X62.LOT_ROOT_FOLDER_PROP, lotRoot.getId());
  const folders = {};
  R5X62.REVIEWERS.forEach(function (reviewer) {
    const folder = _getOrCreateChildFolder_(lotRoot, reviewer);
    folders[reviewer] = folder;
    props.setProperty(R5X62.REVIEWER_FOLDER_PROP_PREFIX + reviewer, folder.getId());
  });

  const ss = _spreadsheet_();
  const sheet = ss.getSheetByName(R5X62.ASSIGNMENTS);
  const values = sheet.getDataRange().getValues();
  const headers = values[0].map(String);
  const index = _headerIndex_(headers);
  const originalCommonIds = {};
  let updatedLinks = 0;
  let movedExclusive = 0;
  let copiedCommon = 0;

  values.slice(1).forEach(function (row) {
    const reviewer = String(row[index.reviewer_id]);
    const target = folders[reviewer];
    if (!target) throw new Error('No existe carpeta para ' + reviewer + '.');
    const fileId = String(row[index.pdf_file_id]);
    const fileName = String(row[index.pdf_file_name]);
    const file = DriveApp.getFileById(fileId);
    if (_asBool_(row[index.es_comun])) {
      if (_fileIsInFolder_(file, target.getId())) return;
      originalCommonIds[fileId] = true;
      const matches = target.getFilesByName(fileName);
      let assignedFile;
      if (matches.hasNext()) {
        assignedFile = matches.next();
        if (matches.hasNext()) throw new Error('PDF común duplicado en ' + reviewer + ': ' + fileName);
      } else {
        assignedFile = file.makeCopy(fileName, target);
        copiedCommon += 1;
      }
      row[index.pdf_file_id] = assignedFile.getId();
      row[index.pdf_preview_url] = 'https://drive.google.com/file/d/' + assignedFile.getId() + '/preview';
      updatedLinks += 1;
    } else if (!_fileIsInFolder_(file, target.getId())) {
      file.moveTo(target);
      movedExclusive += 1;
    }
  });

  Object.keys(originalCommonIds).forEach(function (fileId) {
    const file = DriveApp.getFileById(fileId);
    if (!_fileIsInFolder_(file, commonMasters.getId())) file.moveTo(commonMasters);
  });
  if (updatedLinks) {
    sheet.getRange(2, 1, values.length - 1, headers.length).setValues(values.slice(1));
  }
  const status = _reviewerFolderStatus_();
  status.forEach(function (item) {
    if (!item.ready) throw new Error(item.reviewer_id + ' no contiene exactamente 62 PDF.');
  });
  return {
    ok: true,
    lot_root_folder_id: lotRoot.getId(),
    moved_exclusive: movedExclusive,
    copied_common: copiedCommon,
    updated_common_links: updatedLinks,
    reviewer_folders: status,
  };
}


function _reviewerFolderStatus_() {
  const props = PropertiesService.getScriptProperties();
  return R5X62.REVIEWERS.map(function (reviewer) {
    const folderId = String(props.getProperty(R5X62.REVIEWER_FOLDER_PROP_PREFIX + reviewer) || '');
    if (!folderId) return { reviewer_id: reviewer, folder_configured: false, pdf_count: 0, ready: false };
    const count = _countFiles_(DriveApp.getFolderById(folderId));
    return { reviewer_id: reviewer, folder_configured: true, pdf_count: count, ready: count === 62 };
  });
}


function _grantReviewerFolderAccess_(reviewerId, email) {
  const props = PropertiesService.getScriptProperties();
  const folderId = _requiredProperty_(props, R5X62.REVIEWER_FOLDER_PROP_PREFIX + reviewerId);
  const folder = DriveApp.getFolderById(folderId);
  const count = _countFiles_(folder);
  if (count !== 62) throw new Error('El lote de PDF no está preparado: ' + count + '/62.');
  folder.addViewer(email);
  return count;
}


function _getOrCreateChildFolder_(parent, name) {
  const matches = parent.getFoldersByName(name);
  if (!matches.hasNext()) return parent.createFolder(name);
  const folder = matches.next();
  if (matches.hasNext()) throw new Error('Carpeta duplicada: ' + name);
  return folder;
}


function _fileIsInFolder_(file, folderId) {
  const parents = file.getParents();
  while (parents.hasNext()) {
    if (parents.next().getId() === folderId) return true;
  }
  return false;
}


function _countFiles_(folder) {
  let count = 0;
  const files = folder.getFiles();
  while (files.hasNext()) {
    files.next();
    count += 1;
  }
  return count;
}


function submitAccessRequest(profile, personalCode, personalCodeConfirmation, accepted) {
  if (accepted !== true) {
    throw new Error('Debe confirmar que acepta participar bajo el protocolo de revisión.');
  }
  const clean = _validateParticipantProfile_(profile);
  const code = _validatePersonalCode_(personalCode, personalCodeConfirmation);
  const lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    const ss = _spreadsheet_();
    const sheet = _ensureAccessRequestSheet_(ss);
    if (_participantByEmail_(ss, clean.correo_google) || _requestByEmail_(ss, clean.correo_google)) {
      throw new Error('Este correo ya tiene una solicitud. Use “Consultar o ingresar” con su clave personal.');
    }
    const now = new Date();
    const requestId = 'SOL-' + Utilities.getUuid().replace(/-/g, '').slice(0, 12).toUpperCase();
    const record = {
      requested_at: now,
      request_id: requestId,
      status: 'PENDING',
      nombre_completo: clean.nombre_completo,
      correo_google: clean.correo_google,
      institucion: clean.institucion,
      pais: clean.pais,
      especialidad: clean.especialidad,
      orcid: clean.orcid,
      protocol_version: 'REVISION_MUESTRAL_270_V3',
      personal_code_hash: _hash_(requestId + '|' + code),
      decision_at: '',
      reviewer_id: '',
      reviewer_label: '',
      pdf_access_status: 'NOT_GRANTED',
      pdf_access_count: 0,
    };
    sheet.appendRow(ACCESS_REQUEST_HEADERS.map(function (header) { return record[header]; }));
    ss.getSheetByName(R5X62.AUDIT).appendRow([
      now, 'REQUEST_ACCESS', '', requestId, '', 'PENDING', 3,
    ]);
    return {
      ok: true,
      request_id: requestId,
      status: 'PENDING',
      correo_google: clean.correo_google,
    };
  } finally {
    lock.releaseLock();
  }
}


function _participantByReviewer_(ss, reviewerId) {
  return _readObjects_(ss.getSheetByName(R5X62.PARTICIPANTS)).find(function (row) {
    return String(row.reviewer_id) === reviewerId;
  }) || null;
}


function _participantByEmail_(ss, email) {
  return _readObjects_(ss.getSheetByName(R5X62.PARTICIPANTS)).find(function (row) {
    return String(row.correo_google || '').toLowerCase() === email;
  }) || null;
}


function _requestByEmail_(ss, email) {
  return _readObjects_(_ensureAccessRequestSheet_(ss)).find(function (row) {
    return String(row.correo_google || '').toLowerCase() === email;
  }) || null;
}


function _requestRowById_(sheet, requestId) {
  const rows = _readObjects_(sheet);
  for (let index = rows.length - 1; index >= 0; index -= 1) {
    if (String(rows[index].request_id) === requestId) {
      return { record: rows[index], rowNumber: index + 2 };
    }
  }
  return null;
}


function _ensureParticipantSchema_(sheet) {
  const current = sheet.getRange(1, 1, 1, Math.max(1, sheet.getLastColumn()))
    .getValues()[0].map(String).filter(Boolean);
  PARTICIPANT_HEADERS.forEach(function (header, index) {
    if (current[index] && current[index] !== header) {
      throw new Error('Esquema inesperado en participantes, columna ' + (index + 1) + '.');
    }
  });
  sheet.getRange(1, 1, 1, PARTICIPANT_HEADERS.length).setValues([PARTICIPANT_HEADERS]);
  sheet.setFrozenRows(1);
}


function _ensureAccessRequestSheet_(ss) {
  let sheet = ss.getSheetByName(R5X62.ACCESS_REQUESTS);
  if (!sheet) {
    sheet = ss.insertSheet(R5X62.ACCESS_REQUESTS);
  }
  const current = sheet.getRange(1, 1, 1, Math.max(1, sheet.getLastColumn()))
    .getValues()[0].map(String);
  ACCESS_REQUEST_HEADERS.forEach(function (header, index) {
    if (current[index] && current[index] !== header) {
      throw new Error('Esquema inesperado en solicitudes, columna ' + (index + 1) + '.');
    }
  });
  sheet.getRange(1, 1, 1, ACCESS_REQUEST_HEADERS.length).setValues([ACCESS_REQUEST_HEADERS]);
  sheet.setFrozenRows(1);
  if (!sheet.isSheetHidden()) sheet.hideSheet();
  return sheet;
}


function getApplicantAccess(email, personalCode) {
  const ss = _spreadsheet_();
  const request = _authenticateApplicantRequest_(ss, email, personalCode);
  const status = String(request.status || 'PENDING');
  const response = {
    request_id: String(request.request_id),
    status: status,
    reviewer_id: String(request.reviewer_id || ''),
    reviewer_label: String(request.reviewer_label || ''),
  };
  if (status === 'APPROVED') {
    if (!response.reviewer_id) throw new Error('La aprobación no tiene lote asignado. Contacte al coordinador.');
    response.data = _reviewerState_(ss, response.reviewer_id);
  }
  return response;
}


function decideAccessRequest(adminCode, requestId, decision) {
  _authenticateAdmin_(adminCode);
  requestId = String(requestId || '').trim().toUpperCase();
  decision = String(decision || '').trim().toUpperCase();
  if (['APPROVE', 'REJECT'].indexOf(decision) === -1) throw new Error('Decisión administrativa inválida.');
  const lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    const ss = _spreadsheet_();
    const requestSheet = _ensureAccessRequestSheet_(ss);
    const found = _requestRowById_(requestSheet, requestId);
    if (!found) throw new Error('Solicitud no encontrada.');
    if (String(found.record.status) !== 'PENDING') {
      throw new Error('La solicitud ya fue resuelta: ' + found.record.status + '.');
    }
    const now = new Date();
    const record = found.record;
    let auditEvent = '';
    let auditReviewer = '';
    if (decision === 'REJECT') {
      record.status = 'REJECTED';
      record.decision_at = now;
      record.pdf_access_status = 'NOT_GRANTED';
      auditEvent = 'REJECT_ACCESS_REQUEST';
    } else {
      const participants = _readObjects_(ss.getSheetByName(R5X62.PARTICIPANTS));
      const occupied = {};
      participants.forEach(function (row) { occupied[String(row.reviewer_id)] = true; });
      const reviewerId = R5X62.REVIEWERS.find(function (candidate) { return !occupied[candidate]; });
      if (!reviewerId) throw new Error('Los cinco cupos ya están ocupados.');
      const email = String(record.correo_google || '').toLowerCase();
      if (_participantByEmail_(ss, email)) throw new Error('El correo ya pertenece a un participante aprobado.');
      const granted = _grantReviewerFolderAccess_(reviewerId, email);
      const participant = {
        accepted_at: now,
        reviewer_id: reviewerId,
        reviewer_label: _reviewerLabel_(reviewerId),
        protocol_version: 'REVISION_MUESTRAL_270_V3',
        nombre_completo: record.nombre_completo,
        correo_google: email,
        institucion: record.institucion,
        pais: record.pais,
        especialidad: record.especialidad,
        orcid: record.orcid,
        pdf_access_status: 'GRANTED',
        pdf_access_count: granted,
      };
      const participantSheet = ss.getSheetByName(R5X62.PARTICIPANTS);
      _ensureParticipantSchema_(participantSheet);
      participantSheet.appendRow(PARTICIPANT_HEADERS.map(function (header) { return participant[header]; }));
      record.status = 'APPROVED';
      record.decision_at = now;
      record.reviewer_id = reviewerId;
      record.reviewer_label = _reviewerLabel_(reviewerId);
      record.pdf_access_status = 'GRANTED';
      record.pdf_access_count = granted;
      auditEvent = 'APPROVE_ACCESS_REQUEST';
      auditReviewer = reviewerId;
    }
    requestSheet.getRange(found.rowNumber, 1, 1, ACCESS_REQUEST_HEADERS.length)
      .setValues([ACCESS_REQUEST_HEADERS.map(function (header) { return record[header]; })]);
    ss.getSheetByName(R5X62.AUDIT).appendRow([
      now, auditEvent, auditReviewer, requestId, '', record.status, 3,
    ]);
  } finally {
    lock.releaseLock();
  }
  return getAdminDashboard(adminCode);
}


function _reviewerState_(ss, reviewerId) {
  const assignments = _readObjects_(ss.getSheetByName(R5X62.ASSIGNMENTS))
    .filter(function (row) { return String(row.reviewer_id) === reviewerId; })
    .sort(function (a, b) { return Number(a.review_order) - Number(b.review_order); });
  const mine = _readObjects_(ss.getSheetByName(R5X62.EVALUATIONS))
    .filter(function (row) { return String(row.reviewer_id) === reviewerId; });
  const evaluations = {};
  mine.forEach(function (row) { evaluations[String(row.assignment_id)] = _publicEvaluation_(row); });
  const items = assignments.map(function (row) {
    return {
      assignment_id: String(row.assignment_id),
      review_order: Number(row.review_order),
      case_code: String(row.case_code),
      titulo: String(row.titulo || ''),
      anio: String(row.anio || ''),
      macroarea: String(row.macroarea || ''),
      revista: String(row.revista || ''),
      doi: String(row.doi || ''),
      pdf_file_name: String(row.pdf_file_name || ''),
      pdf_preview_url: String(row.pdf_preview_url || ''),
      evaluation: evaluations[String(row.assignment_id)] || null,
    };
  });
  return {
    reviewer_id: reviewerId,
    reviewer_label: _reviewerLabel_(reviewerId),
    total: items.length,
    finalizados: items.filter(function (item) {
      return item.evaluation && item.evaluation.estado === 'FINAL';
    }).length,
    borradores: items.filter(function (item) {
      return item.evaluation && item.evaluation.estado === 'BORRADOR';
    }).length,
    items: items,
  };
}


function saveApplicantEvaluation(email, personalCode, payload) {
  const ss = _spreadsheet_();
  const request = _authenticateApplicantRequest_(ss, email, personalCode);
  if (String(request.status) !== 'APPROVED' || !request.reviewer_id) {
    throw new Error('Su solicitud todavía no está aprobada.');
  }
  return _saveEvaluationForReviewer_(String(request.reviewer_id), payload);
}


function _saveEvaluationForReviewer_(reviewerId, payload) {
  const clean = _validateEvaluation_(payload);
  const lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    const ss = _spreadsheet_();
    const assignment = _findAssignment_(ss, reviewerId, clean.assignment_id);
    if (!assignment) throw new Error('La asignación no pertenece a este revisor.');
    if (String(assignment.case_code) !== clean.case_code) {
      throw new Error('El código de caso no coincide con la asignación.');
    }

    const sheet = ss.getSheetByName(R5X62.EVALUATIONS);
    const existing = _findEvaluationRow_(sheet, reviewerId, clean.assignment_id);
    if (existing && String(existing.record.estado) === 'FINAL') {
      throw new Error('La evaluación final está bloqueada. Contacte al administrador para corregirla.');
    }
    const now = new Date();
    const version = existing ? Number(existing.record.version || 0) + 1 : 1;
    const record = {
      created_at: existing ? existing.record.created_at : now,
      updated_at: now,
      assignment_id: clean.assignment_id,
      reviewer_id: reviewerId,
      case_code: clean.case_code,
      identidad_pdf: clean.identidad_pdf,
      estudio_sudamericano: clean.estudio_sudamericano,
      pais_territorio: clean.pais_territorio,
      estudio_muestral: clean.estudio_muestral,
      unidad_observada: clean.unidad_observada,
      tamano_muestral: clean.tamano_muestral,
      mecanismo_seleccion: clean.mecanismo_seleccion,
      reconoce_limitaciones: clean.reconoce_limitaciones,
      extrapola: clean.extrapola,
      paginas_evidencia: clean.paginas_evidencia,
      evidencia_breve: clean.evidencia_breve,
      justificacion: clean.justificacion,
      confianza: clean.confianza,
      estado: clean.estado,
      version: version,
    };
    const values = EVALUATION_HEADERS.map(function (header) { return record[header]; });
    if (existing) sheet.getRange(existing.rowNumber, 1, 1, values.length).setValues([values]);
    else sheet.appendRow(values);
    ss.getSheetByName(R5X62.AUDIT).appendRow([
      now, existing ? 'UPDATE' : 'CREATE', reviewerId, clean.assignment_id,
      clean.case_code, clean.estado, version,
    ]);
    return {
      ok: true,
      assignment_id: clean.assignment_id,
      estado: clean.estado,
      version: version,
      updated_at: now.toISOString(),
    };
  } finally {
    lock.releaseLock();
  }
}


function getAdminDashboard(adminCode) {
  _authenticateAdmin_(adminCode);
  const ss = _spreadsheet_();
  const assignments = _readObjects_(ss.getSheetByName(R5X62.ASSIGNMENTS));
  const evaluations = _readObjects_(ss.getSheetByName(R5X62.EVALUATIONS));
  const participants = {};
  _readObjects_(ss.getSheetByName(R5X62.PARTICIPANTS)).forEach(function (row) {
    participants[String(row.reviewer_id)] = row;
  });
  const accessRequests = _readObjects_(_ensureAccessRequestSheet_(ss)).map(function (row) {
    return {
      requested_at: row.requested_at instanceof Date ? row.requested_at.toISOString() : String(row.requested_at || ''),
      request_id: String(row.request_id || ''),
      status: String(row.status || ''),
      nombre_completo: String(row.nombre_completo || ''),
      correo_google: String(row.correo_google || ''),
      institucion: String(row.institucion || ''),
      pais: String(row.pais || ''),
      especialidad: String(row.especialidad || ''),
      orcid: String(row.orcid || ''),
      decision_at: row.decision_at instanceof Date ? row.decision_at.toISOString() : String(row.decision_at || ''),
      reviewer_id: String(row.reviewer_id || ''),
      reviewer_label: String(row.reviewer_label || ''),
      pdf_access_status: String(row.pdf_access_status || ''),
    };
  }).sort(function (a, b) { return b.requested_at.localeCompare(a.requested_at); });
  const latest = {};
  evaluations.forEach(function (row) {
    latest[String(row.assignment_id)] = row;
  });
  const progress = R5X62.REVIEWERS.map(function (reviewer) {
    const assigned = assignments.filter(function (row) { return String(row.reviewer_id) === reviewer; });
    const rows = assigned.map(function (row) { return latest[String(row.assignment_id)] || null; });
    return {
      reviewer_id: reviewer,
      reviewer_label: _reviewerLabel_(reviewer),
      participacion_aceptada: Boolean(participants[reviewer]),
      nombre_completo: String((participants[reviewer] && participants[reviewer].nombre_completo) || ''),
      correo_google: String((participants[reviewer] && participants[reviewer].correo_google) || ''),
      institucion: String((participants[reviewer] && participants[reviewer].institucion) || ''),
      pais: String((participants[reviewer] && participants[reviewer].pais) || ''),
      especialidad: String((participants[reviewer] && participants[reviewer].especialidad) || ''),
      pdf_access_status: String((participants[reviewer] && participants[reviewer].pdf_access_status) || ''),
      aceptada_en: participants[reviewer] && participants[reviewer].accepted_at instanceof Date
        ? participants[reviewer].accepted_at.toISOString()
        : '',
      asignados: assigned.length,
      finalizados: rows.filter(function (row) { return row && String(row.estado) === 'FINAL'; }).length,
      borradores: rows.filter(function (row) { return row && String(row.estado) === 'BORRADOR'; }).length,
      pendientes: rows.filter(function (row) { return !row; }).length,
    };
  });

  const commonCodes = {};
  assignments.forEach(function (row) {
    if (_asBool_(row.es_comun)) commonCodes[String(row.case_code)] = true;
  });
  const commonGroups = {};
  evaluations.forEach(function (row) {
    const code = String(row.case_code);
    if (!commonCodes[code] || String(row.estado) !== 'FINAL') return;
    if (!commonGroups[code]) commonGroups[code] = [];
    commonGroups[code].push(row);
  });
  const completeGroups = Object.keys(commonGroups)
    .map(function (code) { return commonGroups[code]; })
    .filter(function (group) {
      return new Set(group.map(function (row) { return String(row.reviewer_id); })).size === R5X62.REVIEWERS.length;
    });
  const agreementFields = [
    ['identidad_pdf', 'Identidad del PDF'],
    ['estudio_sudamericano', 'Estudio sudamericano'],
    ['estudio_muestral', 'Estudio basado en muestra'],
    ['mecanismo_seleccion', 'Mecanismo de selección'],
    ['reconoce_limitaciones', 'Reconoce limitaciones'],
    ['extrapola', 'Extrapola'],
  ];
  const agreement = agreementFields.map(function (definition) {
    const stats = _fleissKappa_(completeGroups, definition[0]);
    return {
      field: definition[0],
      label: definition[1],
      complete_cases: completeGroups.length,
      pairwise_agreement: stats.pairwiseAgreement,
      fleiss_kappa: stats.kappa,
    };
  });
  return {
    progress: progress,
    access_requests: accessRequests,
    access_request_summary: {
      pending: accessRequests.filter(function (row) { return row.status === 'PENDING'; }).length,
      approved: accessRequests.filter(function (row) { return row.status === 'APPROVED'; }).length,
      rejected: accessRequests.filter(function (row) { return row.status === 'REJECTED'; }).length,
      available_slots: R5X62.REVIEWERS.length - Object.keys(participants).length,
    },
    total_assignments: assignments.length,
    unique_cases: new Set(assignments.map(function (row) { return String(row.case_code); })).size,
    common_cases: Object.keys(commonCodes).length,
    common_complete_by_all: completeGroups.length,
    agreement: agreement,
    app_url: ScriptApp.getService().getUrl() || '',
  };
}


function getAdminExport(adminCode) {
  _authenticateAdmin_(adminCode);
  const ss = _spreadsheet_();
  const assignments = _readObjects_(ss.getSheetByName(R5X62.ASSIGNMENTS));
  const evaluations = _readObjects_(ss.getSheetByName(R5X62.EVALUATIONS));
  const byEvaluation = {};
  evaluations.forEach(function (row) { byEvaluation[String(row.assignment_id)] = row; });
  const participants = {};
  _readObjects_(ss.getSheetByName(R5X62.PARTICIPANTS)).forEach(function (row) {
    participants[String(row.reviewer_id)] = row;
  });
  const fields = [
    'assignment_id', 'reviewer_id', 'reviewer_label', 'participacion_aceptada',
    'aceptada_en', 'nombre_completo', 'correo_google', 'institucion', 'pais_revisor',
    'especialidad', 'orcid', 'pdf_access_status', 'review_order', 'case_code', 'openalex_work_id',
    'titulo', 'anio', 'macroarea', 'revista', 'doi', 'es_comun',
  ].concat(EVALUATION_HEADERS.filter(function (header) {
    return ['assignment_id', 'reviewer_id', 'case_code'].indexOf(header) === -1;
  }));
  const rows = assignments.map(function (assignment) {
    const evaluation = byEvaluation[String(assignment.assignment_id)] || {};
    const merged = {};
    fields.forEach(function (field) {
      const value = evaluation[field] != null ? evaluation[field] : assignment[field];
      merged[field] = value instanceof Date ? value.toISOString() : value;
    });
    const participant = participants[String(assignment.reviewer_id)];
    merged.reviewer_label = _reviewerLabel_(assignment.reviewer_id);
    merged.participacion_aceptada = Boolean(participant);
    merged.aceptada_en = participant && participant.accepted_at instanceof Date
      ? participant.accepted_at.toISOString()
      : '';
    merged.nombre_completo = participant ? String(participant.nombre_completo || '') : '';
    merged.correo_google = participant ? String(participant.correo_google || '') : '';
    merged.institucion = participant ? String(participant.institucion || '') : '';
    merged.pais_revisor = participant ? String(participant.pais || '') : '';
    merged.especialidad = participant ? String(participant.especialidad || '') : '';
    merged.orcid = participant ? String(participant.orcid || '') : '';
    merged.pdf_access_status = participant ? String(participant.pdf_access_status || '') : '';
    return merged;
  });
  return { fields: fields, rows: rows };
}


function _validateImportedAssignments_(rows) {
  const reviewerCounts = {};
  const assignmentIds = {};
  const caseReviewers = {};
  const commonFlags = {};
  rows.forEach(function (row) {
    const record = {};
    ASSIGNMENT_HEADERS.forEach(function (header, index) { record[header] = row[index]; });
    const reviewer = String(record.reviewer_id);
    if (R5X62.REVIEWERS.indexOf(reviewer) === -1) throw new Error('Revisor inválido: ' + reviewer);
    reviewerCounts[reviewer] = (reviewerCounts[reviewer] || 0) + 1;
    const assignmentId = String(record.assignment_id);
    if (assignmentIds[assignmentId]) throw new Error('assignment_id duplicado: ' + assignmentId);
    assignmentIds[assignmentId] = true;
    const code = String(record.case_code);
    if (!caseReviewers[code]) caseReviewers[code] = {};
    caseReviewers[code][reviewer] = true;
    const isCommon = _asBool_(record.es_comun);
    if (commonFlags[code] != null && commonFlags[code] !== isCommon) {
      throw new Error('Marca es_comun inconsistente para ' + code);
    }
    commonFlags[code] = isCommon;
  });
  R5X62.REVIEWERS.forEach(function (reviewer) {
    if (reviewerCounts[reviewer] !== 62) {
      throw new Error(reviewer + ' debe tener 62 asignaciones; tiene ' + reviewerCounts[reviewer]);
    }
  });
  const uniqueCases = Object.keys(caseReviewers);
  const shared = uniqueCases.filter(function (code) {
    return Object.keys(caseReviewers[code]).length === R5X62.REVIEWERS.length;
  });
  uniqueCases.forEach(function (code) {
    const reviewerCount = Object.keys(caseReviewers[code]).length;
    const expected = commonFlags[code] ? R5X62.REVIEWERS.length : 1;
    if (reviewerCount !== expected) {
      throw new Error('Asignación inconsistente para ' + code + ': ' + reviewerCount + '/' + expected);
    }
  });
  const expectedUnique = rows.length - (R5X62.REVIEWERS.length - 1) * shared.length;
  if (uniqueCases.length !== expectedUnique) {
    throw new Error('Conteo de artículos únicos inconsistente.');
  }
  if (uniqueCases.length !== 270 || shared.length !== 10) {
    throw new Error('El diseño debe contener 270 artículos únicos y 10 comunes; observados=' +
      uniqueCases.length + ' y ' + shared.length + '.');
  }
}


function _validateEvaluation_(payload) {
  if (!payload || typeof payload !== 'object') throw new Error('Falta la evaluación.');
  const clean = {
    assignment_id: _cleanText_(payload.assignment_id, 40),
    case_code: _cleanText_(payload.case_code, 40),
    identidad_pdf: _cleanChoice_(payload.identidad_pdf, 'identidad_pdf'),
    estudio_sudamericano: _cleanChoice_(payload.estudio_sudamericano, 'estudio_sudamericano'),
    pais_territorio: _cleanText_(payload.pais_territorio, 250),
    estudio_muestral: _cleanChoice_(payload.estudio_muestral, 'estudio_muestral'),
    unidad_observada: _cleanText_(payload.unidad_observada, 500),
    tamano_muestral: _cleanText_(payload.tamano_muestral, 250),
    mecanismo_seleccion: _cleanChoice_(payload.mecanismo_seleccion, 'mecanismo_seleccion'),
    reconoce_limitaciones: _cleanChoice_(payload.reconoce_limitaciones, 'reconoce_limitaciones'),
    extrapola: _cleanChoice_(payload.extrapola, 'extrapola'),
    paginas_evidencia: _cleanText_(payload.paginas_evidencia, 250),
    evidencia_breve: _cleanText_(payload.evidencia_breve, 2000),
    justificacion: _cleanText_(payload.justificacion, 3000),
    confianza: _cleanChoice_(payload.confianza, 'confianza'),
    estado: _cleanChoice_(payload.estado, 'estado'),
  };
  if (!clean.assignment_id || !clean.case_code) throw new Error('Falta identificar la asignación.');
  if (clean.estado === 'FINAL') {
    const required = [
      'identidad_pdf', 'estudio_sudamericano', 'estudio_muestral',
      'mecanismo_seleccion', 'reconoce_limitaciones', 'extrapola',
      'paginas_evidencia', 'evidencia_breve', 'justificacion', 'confianza',
    ];
    required.forEach(function (field) {
      if (!clean[field]) throw new Error('Falta completar: ' + field);
    });
    if (clean.estudio_muestral === 'SI' && (!clean.unidad_observada || !clean.tamano_muestral)) {
      throw new Error('Para un estudio muestral indique unidad observada y tamaño muestral o "No reportado".');
    }
  }
  return clean;
}


function _validateParticipantProfile_(profile) {
  if (!profile || typeof profile !== 'object') throw new Error('Faltan los datos del participante.');
  const email = _cleanText_(profile.correo_google, 254).toLowerCase();
  const confirmation = _cleanText_(profile.confirmar_correo, 254).toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    throw new Error('Ingrese un correo Google válido.');
  }
  if (email !== confirmation) throw new Error('La confirmación del correo no coincide.');
  const clean = {
    nombre_completo: _cleanText_(profile.nombre_completo, 200),
    correo_google: email,
    institucion: _cleanText_(profile.institucion, 250),
    pais: _cleanText_(profile.pais, 120),
    especialidad: _cleanText_(profile.especialidad, 250),
    orcid: _cleanText_(profile.orcid, 40),
  };
  ['nombre_completo', 'institucion', 'especialidad'].forEach(function (field) {
    if (!clean[field]) throw new Error('Falta completar: ' + field + '.');
  });
  if (clean.orcid && !/^\d{4}-\d{4}-\d{4}-\d{3}[\dX]$/i.test(clean.orcid)) {
    throw new Error('El ORCID debe tener el formato 0000-0000-0000-0000.');
  }
  return clean;
}


function _validatePersonalCode_(personalCode, confirmation) {
  const code = String(personalCode || '').trim();
  const repeated = String(confirmation || '').trim();
  if (code !== repeated) throw new Error('La confirmación de la clave personal no coincide.');
  if (code.length < 8 || code.length > 64 || /\s/.test(code) ||
      !/[A-Za-z]/.test(code) || !/\d/.test(code)) {
    throw new Error('La clave personal debe tener entre 8 y 64 caracteres, incluir una letra y un número, y no contener espacios.');
  }
  return code;
}


function _fleissKappa_(groups, field) {
  if (!groups.length) return { pairwiseAgreement: null, kappa: null };
  const categoryTotals = {};
  let pObserved = 0;
  let ratings = 0;
  groups.forEach(function (group) {
    const counts = {};
    group.forEach(function (row) {
      const value = String(row[field] || '');
      counts[value] = (counts[value] || 0) + 1;
      categoryTotals[value] = (categoryTotals[value] || 0) + 1;
      ratings += 1;
    });
    const n = group.length;
    const samePairsTwice = Object.keys(counts).reduce(function (sum, key) {
      return sum + counts[key] * (counts[key] - 1);
    }, 0);
    pObserved += samePairsTwice / (n * (n - 1));
  });
  pObserved /= groups.length;
  const pExpected = Object.keys(categoryTotals).reduce(function (sum, key) {
    const proportion = categoryTotals[key] / ratings;
    return sum + proportion * proportion;
  }, 0);
  const kappa = pExpected === 1 ? null : (pObserved - pExpected) / (1 - pExpected);
  return { pairwiseAgreement: pObserved, kappa: kappa };
}


function _authenticateApplicantRequest_(ss, email, personalCode) {
  const normalizedEmail = String(email || '').trim().toLowerCase();
  const code = String(personalCode || '').trim();
  const request = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizedEmail)
    ? _requestByEmail_(ss, normalizedEmail)
    : null;
  const expected = request ? String(request.personal_code_hash || '') : '';
  const supplied = _hash_(String((request && request.request_id) || '') + '|' + code);
  if (!expected || !_constantTimeEqual_(expected, supplied)) {
    throw new Error('Correo o clave personal incorrectos.');
  }
  return request;
}


function _authenticateAdmin_(accessCode) {
  const expected = PropertiesService.getScriptProperties().getProperty(R5X62.ADMIN_HASH_PROP);
  const normalizedCode = String(accessCode || '').trim().toUpperCase();
  if (!expected || !_constantTimeEqual_(expected, _hash_(normalizedCode))) {
    throw new Error('Código de administrador incorrecto.');
  }
}


function _findAssignment_(ss, reviewerId, assignmentId) {
  return _readObjects_(ss.getSheetByName(R5X62.ASSIGNMENTS)).find(function (row) {
    return String(row.reviewer_id) === reviewerId && String(row.assignment_id) === assignmentId;
  }) || null;
}


function _findEvaluationRow_(sheet, reviewerId, assignmentId) {
  if (sheet.getLastRow() < 2) return null;
  const rows = _readObjects_(sheet);
  for (let index = rows.length - 1; index >= 0; index -= 1) {
    if (String(rows[index].reviewer_id) === reviewerId &&
        String(rows[index].assignment_id) === assignmentId) {
      return { record: rows[index], rowNumber: index + 2 };
    }
  }
  return null;
}


function _publicEvaluation_(row) {
  const output = {};
  EVALUATION_HEADERS.forEach(function (header) {
    if (['reviewer_id', 'created_at'].indexOf(header) === -1) output[header] = row[header];
  });
  if (output.updated_at instanceof Date) output.updated_at = output.updated_at.toISOString();
  return output;
}


function _spreadsheet_() {
  const id = _requiredProperty_(PropertiesService.getScriptProperties(), R5X62.SHEET_PROP);
  return SpreadsheetApp.openById(id);
}


function _requiredProperty_(props, key) {
  const value = String(props.getProperty(key) || '').trim();
  if (!value) throw new Error('Falta la propiedad del script: ' + key);
  return value;
}


function _writeNewSheet_(sheet, headers, rows) {
  sheet.clear();
  sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
  if (rows.length) sheet.getRange(2, 1, rows.length, headers.length).setValues(rows);
  sheet.setFrozenRows(1);
  sheet.autoResizeColumns(1, headers.length);
}


function _readObjects_(sheet) {
  if (!sheet || sheet.getLastRow() < 2) return [];
  const values = sheet.getDataRange().getValues();
  const headers = values.shift().map(String);
  return values.map(function (row) {
    const output = {};
    headers.forEach(function (header, index) { output[header] = row[index]; });
    return output;
  });
}


function _headerIndex_(headers) {
  const output = {};
  headers.forEach(function (header, index) { output[String(header)] = index; });
  return output;
}


function _newAccessCode_() {
  return Utilities.getUuid().replace(/-/g, '').slice(0, 12).toUpperCase();
}


function _reviewerLabel_(reviewerId) {
  const match = String(reviewerId || '').match(/(\d+)$/);
  return match ? 'Revisor ' + match[1] : String(reviewerId || '');
}


function _hash_(value) {
  const bytes = Utilities.computeDigest(
    Utilities.DigestAlgorithm.SHA_256,
    String(value),
    Utilities.Charset.UTF_8
  );
  return bytes.map(function (byte) {
    const normalized = byte < 0 ? byte + 256 : byte;
    return ('0' + normalized.toString(16)).slice(-2);
  }).join('');
}


function _constantTimeEqual_(left, right) {
  left = String(left || '');
  right = String(right || '');
  let mismatch = left.length ^ right.length;
  const length = Math.max(left.length, right.length);
  for (let index = 0; index < length; index += 1) {
    mismatch |= (left.charCodeAt(index) || 0) ^ (right.charCodeAt(index) || 0);
  }
  return mismatch === 0;
}


function _cleanChoice_(value, field) {
  const clean = String(value || '').trim().toUpperCase();
  if (!clean) return '';
  if (VALID_VALUES[field].indexOf(clean) === -1) {
    throw new Error('Valor inválido para ' + field + ': ' + clean);
  }
  return clean;
}


function _cleanText_(value, maxLength) {
  let clean = String(value || '').trim();
  if (clean.length > maxLength) throw new Error('Texto demasiado largo; máximo ' + maxLength + ' caracteres.');
  if (/^[=+\-@]/.test(clean)) clean = "'" + clean;
  return clean;
}


function _asBool_(value) {
  return ['true', '1', 'si', 'sí', 's'].indexOf(String(value || '').trim().toLowerCase()) !== -1;
}
