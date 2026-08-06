/**
 * Revisión humana ciega con cinco revisores y 270 artículos únicos.
 *
 * Configuración requerida en Propiedades del script:
 * - R5X62_ASSIGNMENTS_CSV_FILE_ID
 * - R5X62_PDF_FOLDER_ID
 *
 * setup_inicial() crea la hoja de cálculo, importa las 310 asignaciones,
 * resuelve los 270 PDF y genera credenciales de un solo uso para cinco revisores
 * y un administrador. Las decisiones IA no se importan a esta aplicación.
 */

const R5X62 = Object.freeze({
  REVIEWERS: ['REVISOR-1', 'REVISOR-2', 'REVISOR-3', 'REVISOR-4', 'REVISOR-5'],
  SHEET_PROP: 'R5X62_SHEET_ID',
  CSV_PROP: 'R5X62_ASSIGNMENTS_CSV_FILE_ID',
  FOLDER_PROP: 'R5X62_PDF_FOLDER_ID',
  ADMIN_HASH_PROP: 'R5X62_ADMIN_HASH',
  REVIEWER_HASH_PREFIX: 'R5X62_REVIEWER_HASH_',
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
  _writeNewSheet_(ss.insertSheet(R5X62.AUDIT), AUDIT_HEADERS, []);
  props.setProperty(R5X62.SHEET_PROP, ss.getId());

  const credentials = _rotateCredentials_();
  const result = {
    sheet_id: ss.getId(),
    assignments: assignments.length,
    unique_pdfs: Object.keys(fileCache).length,
    credentials: credentials,
    warning: 'Guarde estas credenciales ahora. Solo se almacenan sus hashes.',
  };
  Logger.log(JSON.stringify(result));
  return result;
}


function rotarCredenciales(adminCode) {
  _authenticateAdmin_(adminCode);
  return _rotateCredentials_();
}


function rotarCredencialesDesdeEditor() {
  const active = String(Session.getActiveUser().getEmail() || '').toLowerCase();
  const owner = String(Session.getEffectiveUser().getEmail() || '').toLowerCase();
  if (!active || active !== owner) {
    throw new Error('Esta función solo puede ejecutarla el propietario desde el editor.');
  }
  const credentials = _rotateCredentials_();
  Logger.log(JSON.stringify(credentials));
  return credentials;
}


function _rotateCredentials_() {
  const props = PropertiesService.getScriptProperties();
  const credentials = { admin: _newAccessCode_(), reviewers: {} };
  props.setProperty(R5X62.ADMIN_HASH_PROP, _hash_(credentials.admin));
  R5X62.REVIEWERS.forEach(function (reviewer) {
    const code = _newAccessCode_();
    credentials.reviewers[reviewer] = code;
    props.setProperty(R5X62.REVIEWER_HASH_PREFIX + reviewer, _hash_(code));
  });
  Logger.log(JSON.stringify(credentials));
  return credentials;
}


function startParticipation(reviewerId, accessCode, accepted) {
  reviewerId = String(reviewerId || '').trim().toUpperCase();
  _authenticateReviewer_(reviewerId, accessCode);
  if (accepted !== true) {
    throw new Error('Debe confirmar que acepta participar bajo el protocolo de revisión.');
  }
  const lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    const ss = _spreadsheet_();
    const sheet = ss.getSheetByName(R5X62.PARTICIPANTS);
    const alreadyAccepted = _readObjects_(sheet).some(function (row) {
      return String(row.reviewer_id) === reviewerId;
    });
    if (!alreadyAccepted) {
      const now = new Date();
      sheet.appendRow([now, reviewerId, _reviewerLabel_(reviewerId), 'REVISION_MUESTRAL_270_V1']);
      ss.getSheetByName(R5X62.AUDIT).appendRow([
        now, 'ACCEPT_PARTICIPATION', reviewerId, '', '', '', 1,
      ]);
    }
  } finally {
    lock.releaseLock();
  }
  return getReviewerState(reviewerId, accessCode);
}


function getReviewerState(reviewerId, accessCode) {
  reviewerId = String(reviewerId || '').trim().toUpperCase();
  _authenticateReviewer_(reviewerId, accessCode);
  const ss = _spreadsheet_();
  const participant = _readObjects_(ss.getSheetByName(R5X62.PARTICIPANTS)).find(function (row) {
    return String(row.reviewer_id) === reviewerId;
  });
  if (!participant) throw new Error('Primero debe aceptar la invitación de participación.');
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


function saveEvaluation(reviewerId, accessCode, payload) {
  reviewerId = String(reviewerId || '').trim().toUpperCase();
  _authenticateReviewer_(reviewerId, accessCode);
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
    'aceptada_en', 'review_order', 'case_code', 'openalex_work_id',
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


function _authenticateReviewer_(reviewerId, accessCode) {
  reviewerId = String(reviewerId || '').trim().toUpperCase();
  if (R5X62.REVIEWERS.indexOf(reviewerId) === -1) throw new Error('Revisor no autorizado.');
  const expected = PropertiesService.getScriptProperties()
    .getProperty(R5X62.REVIEWER_HASH_PREFIX + reviewerId);
  const normalizedCode = String(accessCode || '').trim().toUpperCase();
  if (!expected || !_constantTimeEqual_(expected, _hash_(normalizedCode))) {
    throw new Error('Código de acceso incorrecto.');
  }
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
  const clean = String(value || '').trim();
  if (clean.length > maxLength) throw new Error('Texto demasiado largo; máximo ' + maxLength + ' caracteres.');
  return clean;
}


function _asBool_(value) {
  return ['true', '1', 'si', 'sí', 's'].indexOf(String(value || '').trim().toLowerCase()) !== -1;
}
