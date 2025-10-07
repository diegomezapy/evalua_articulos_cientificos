// ScientificArticleAnalyzer Pro (clasificación y evaluación multilingüe ES-EN-PT)
// Requisitos en el HTML: inputs con ids pdfFiles, analyzeBtn, exportBtn; contenedores progressContainer, resultsContainer; elementos
// progressBar, currentFile, resultsBody, detailsContainer; canvas con ids scoresChart, verdictChart, studyTypeChart. Chart.js, XLSX y PDF.js cargados.

/* ==========================
 *  Configuración de PDF.js
 * ========================== */
pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/4.5.136/pdf.worker.min.js';

/* ============================================
 *  Utilidades de texto y patrones multilingües
 * ============================================ */
const TextUtils = {
  /** Normaliza texto y genera versión sin diacríticos para búsqueda robusta en ES/EN/PT */
  normalize(raw) {
    if (!raw) return { raw: '', norm: '', fold: '' };
    const dehyphen = raw.replace(/-(\r?\n|\s{1,2})/g, '');
    const ligatures = dehyphen
      .replace(/[ﬁﬂﬀﬃﬄ]/g, m => ({ 'ﬁ': 'fi', 'ﬂ': 'fl', 'ﬀ': 'ff', 'ﬃ': 'ffi', 'ﬄ': 'ffl' }[m] || m));
    const cleaned = ligatures.replace(/\u00ad/g, '').replace(/\s+/g, ' ').trim();
    const lower = cleaned.toLowerCase();
    const fold = lower.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
    return { raw: cleaned, norm: lower, fold };
  },

  /** Elimina cabeceras y pies repetidos entre páginas */
  stripRepeatedLines(pages, minLen = 12, minFrac = 0.6) {
    const freq = new Map();
    const total = pages.length;
    for (const p of pages) {
      const lines = p.split(/\n| {2,}/g).map(s => s.trim()).filter(s => s.length >= minLen);
      for (const l of lines) freq.set(l, (freq.get(l) || 0) + 1);
    }
    const blacklist = new Set([...freq.entries()].filter(([l, c]) => c / total >= minFrac).map(([l]) => l));
    const cleanedPages = pages.map(p => p.split(/\n/g).filter(line => !blacklist.has(line.trim())).join('\n'));
    return cleanedPages.join('\n');
  },

  /** Segmentación de secciones para ES, EN, PT sobre texto plegado (sin acentos) */
  splitSections(rawText) {
    const { fold } = TextUtils.normalize(rawText);
    const labels = {
      abstract: ['abstract', 'resumen', 'summary', 'resumo'],
      keywords: ['keywords', 'palabras clave', 'palavras chave', 'palavras-chave'],
      introduction: ['introduction', 'introduccion', 'introducao', 'background'],
      methods: ['methods', 'metodos', 'metodologia', 'materials and methods', 'materiales y metodos', 'materiais e metodos'],
      results: ['results', 'resultados'],
      discussion: ['discussion', 'discusion', 'discussao'],
      conclusions: ['conclusions', 'conclusiones', 'conclusoes'],
      references: ['references', 'referencias', 'bibliografia', 'bibliography'],
    };

    // Construye mapa de apariciones de encabezados
    const hits = [];
    const headerRegexFrom = (arr) => new RegExp(`(?:^|\n\s*)(?:${arr.map(s => s.replace(/[-/\\^$*+?.()|[\]{}]/g, r => `\\${r}`)).join('|')})\\b[\s:]*`, 'gi');
    for (const [key, arr] of Object.entries(labels)) {
      const re = headerRegexFrom(arr);
      let m; while ((m = re.exec(fold)) !== null) hits.push({ key, start: m.index, end: m.index + m[0].length });
    }
    hits.sort((a, b) => a.start - b.start);
    const sections = {};
    for (let i = 0; i < hits.length; i++) {
      const cur = hits[i];
      const next = hits[i + 1];
      const slice = fold.slice(cur.end, next ? next.start : undefined).trim();
      sections[cur.key] = slice;
    }
    return sections;
  },

  /** Metadatos comunes con soporte multilingüe */
  extractMetadata(text) {
    const { fold } = TextUtils.normalize(text);
    const doiMatch = text.match(/\b10\.\d{4,9}\/[-._;()\/:A-Z0-9]+/i);
    const nctMatch = text.match(/\bNCT\d{8}\b/i);
    const prospero = text.match(/\bCRD\d{2,}\b/i);
    const orcid = text.match(/\b(?:\d{4}-){3}\d{3}[\dX]\b/);
    const ethics = /(ethics?\s*(committee|approval)|comite\s*de\s*etica|aprobacion\s*etica|aprovacao\s*etica)/i.test(fold);
    const openAccess = /(creative\s*commons|cc\s?by|open\s*access|acceso\s*abierto|acesso\s*aberto)/i.test(fold);
    return { doi: doiMatch ? doiMatch[0] : null, trialId: nctMatch ? nctMatch[0] : null, prospero: prospero ? prospero[0] : null, orcid: orcid ? orcid[0] : null, ethicsApproval: ethics, openAccess };
  },
};

/* ==================================
 *  Léxicos multilingües y BM25
 * ================================== */
const Lexicon = {
  studyTypes: {
    rct: {
      label: 'Ensayo clínico aleatorizado',
      hints: [
        // EN
        'randomized', 'randomised', 'double blind', 'single blind', 'placebo', 'trial', 'allocation', 'intention to treat', 'allocation concealment', 'arm', 'parallel group', 'crossover', 'cluster randomized',
        // ES
        'aleatoriz', 'doble ciego', 'placebo', 'ensayo', 'grupo paralelo', 'cruzado', 'intencion de tratar',
        // PT
        'randomizado', 'duplo cego', 'ensaio', 'grupo paralelo', 'cruzado', 'intencao de tratar'
      ],
      weight: 1.2,
    },
    cohort: {
      label: 'Cohorte',
      hints: [
        // EN
        'cohort', 'follow up', 'longitudinal', 'incidence', 'hazard ratio', 'cox model', 'risk ratio', 'exposed',
        // ES
        'cohorte', 'seguimiento', 'razon de riesgos', 'modelo de cox', 'riesgo relativo',
        // PT
        'coorte', 'acompanhamento', 'razao de risco', 'modelo de cox', 'risco relativo'
      ],
      weight: 1.0,
    },
    casecontrol: {
      label: 'Casos y controles',
      hints: [
        // EN
        'case control', 'matched controls', 'odds ratio', 'controls selected',
        // ES
        'casos y controles', 'apareamiento', 'pareados', 'razon de momios',
        // PT
        'caso controle', 'pareado', 'razao de chances'
      ],
      weight: 1.0,
    },
    crosssectional: {
      label: 'Transversal',
      hints: ['cross sectional', 'transversal', 'prevalence study', 'survey', 'baseline assessment', 'prevalencia', 'inquerito', 'estudo transversal'],
      weight: 0.9,
    },
    systematic: {
      label: 'Revisión sistemática',
      hints: ['systematic review', 'prisma', 'registered protocol', 'eligibility criteria', 'risk of bias tool', 'revisao sistematica', 'criterios de elegibilidad', 'criterios de elegibilidade'],
      weight: 1.1,
    },
    metaanalysis: {
      label: 'Meta-análisis',
      hints: ['meta analysis', 'meta analisis', 'meta analise', 'pooled effect', 'i^2', 'heterogeneity', 'forest plot', 'der simonian', 'random effects', 'efeito combinado', 'heterogeneidade', 'grafico de floresta'],
      weight: 1.2,
    },
    qualitative: {
      label: 'Cualitativo',
      hints: ['interviews', 'focus group', 'thematic analysis', 'grounded theory', 'saturation', 'coding scheme', 'entrevistas', 'grupos focales', 'analise tematica', 'grupo focal', 'teoria fundamentada'],
      weight: 0.9,
    },
    methods: {
      label: 'Artículo metodológico',
      hints: ['methodological paper', 'simulation study', 'monte carlo', 'algorithm', 'validation study', 'benchmark', 'estudio metodologico', 'estudo metodologico', 'estudo de simulacao'],
      weight: 0.9,
    },
    timeSeries: {
      label: 'Serie de tiempo',
      hints: ['time series', 'serie de tiempo', 'serie temporal', 'arima', 'sarima', 'var model', 'seasonal', 'diferenca em diferencas', 'difference in differences', 'painel', 'panel data', 'granger'],
      weight: 0.9,
    },
    economicEval: {
      label: 'Evaluación económica',
      hints: ['cost effectiveness', 'cost utility', 'markov model', 'qalys', 'incremental cost', 'icer', 'budget impact', 'costo efectividad', 'custo efetividade', 'custo utilidade', 'impacto orcamentario'],
      weight: 1.1,
    },
  },

  software: [
    ' r ', 'stata', 'spss', 'sas', 'python', 'matlab', 'julia', 'eviews', 'gretl', 'mplus', 'winbugs', 'jags', 'stan', 'epidat'
  ],

  stats: [
    // EN
    'regression', 'logistic', 'linear model', 'anova', 'ancova', 'mixed effects', 'multilevel', 'bayesian', 'bootstrap', 'propensity score', 'cox', 'poisson', 'negative binomial', 'gee', 'glm', 'iv instrumental', 'regression discontinuity', 'matching', 'kaplan meier',
    // ES
    'regresion', 'logistica', 'modelo lineal', 'efectos mixtos', 'multinivel', 'bayesiano', 'propension', 'discontinuidad de regresion', 'emparejamiento',
    // PT
    'regressao', 'logistica', 'modelo linear', 'efeitos mistos', 'multinivel', 'bayesiano', 'escore de propensao', 'descontinuidade de regressao', 'emparelhamento'
  ],
};

function bm25Score(textFold, terms, k1 = 1.2, b = 0.75) {
  const tokens = textFold.split(/[^a-z0-9]+/i).filter(Boolean);
  const N = 1e6;
  const avgdl = 2000;
  const dl = tokens.length;
  const tf = new Map();
  for (const t of tokens) tf.set(t, (tf.get(t) || 0) + 1);
  let score = 0;
  for (const term of terms) {
    const t = term.toLowerCase();
    const f = tf.get(t) || 0;
    if (!f) continue;
    const df = Math.max(1, Math.floor(Math.sqrt(N) / 50));
    const idf = Math.log((N - df + 0.5) / (df + 0.5) + 1);
    score += idf * ((f * (k1 + 1)) / (f + k1 * (1 - b + b * (dl / avgdl))));
  }
  return score;
}

/* ==========================
 *  Núcleo de clasificación
 * ========================== */
class ClassificationEngine {
  constructor() { this.lex = Lexicon; }

  detectStudyType(text) {
    const { fold } = TextUtils.normalize(text);
    const rawScores = {};
    for (const [key, cfg] of Object.entries(this.lex.studyTypes)) rawScores[key] = bm25Score(fold, cfg.hints.map(h => TextUtils.normalize(h).fold)) * cfg.weight;
    if (rawScores.metaanalysis > 0 && rawScores.systematic > 0) rawScores.metaanalysis *= 1.15;
    const max = Math.max(...Object.values(rawScores), 1e-6);
    const expScores = Object.fromEntries(Object.entries(rawScores).map(([k, v]) => [k, Math.exp((v / max) * 4)]));
    const sum = Object.values(expScores).reduce((a, b) => a + b, 0);
    const probs = Object.fromEntries(Object.entries(expScores).map(([k, v]) => [k, v / sum]));
    const bestKey = Object.entries(probs).sort((a, b) => b[1] - a[1])[0][0];
    return { key: bestKey, label: this.lex.studyTypes[bestKey].label, probability: +probs[bestKey].toFixed(3), distribution: probs };
  }

  extractQuantSignals(text) {
    const { fold } = TextUtils.normalize(text);
    const pvals = (fold.match(/p\s*[=<>]\s*0?\.\d+/gi) || []).length;
    const cis = (fold.match(/(95|90|99)\%\s*ci\s*[:\(\[]\s*-?\d+(?:\.\d+)?\s*[,;]\s*-?\d+(?:\.\d+)?/gi) || []).length;
    const effects = (fold.match(/\b(or|rr|hr)\s*[=:]\s*-?\d+(?:\.\d+)?/gi) || []).length;
    const sampleN = (() => {
      const m = fold.match(/\b[ns]\s*[=:]\s*(\d{2,7})\b/i) || fold.match(/\b(muestra|sample|participants?|amostra)\b\s*(de|of)?\s*(\d{2,7})\b/i);
      return m ? parseInt(m[1] || m[3], 10) : null;
    })();
    return { pvals, cis, effects, sampleN };
  }

  detectSoftware(text) {
    const { fold } = TextUtils.normalize(text);
    const found = new Set();
    for (const s of Lexicon.software) if (fold.includes(TextUtils.normalize(s).fold)) found.add(s.trim());
    return [...found];
  }

  detectStats(text) {
    const { fold } = TextUtils.normalize(text);
    const found = new Set();
    for (const s of Lexicon.stats) if (fold.includes(TextUtils.normalize(s).fold)) found.add(s.trim());
    return [...found];
  }
}

/* ==========================
 *  Clase principal multilingüe
 * ========================== */
class ScientificArticleAnalyzer {
  constructor() {
    this.results = [];
    this.currentFileIndex = 0;
    this.filesToProcess = [];
    this.engine = new ClassificationEngine();
    this.initializeEventListeners();
  }

  initializeEventListeners() {
    const analyzeBtn = document.getElementById('analyzeBtn');
    const exportBtn = document.getElementById('exportBtn');
    if (analyzeBtn) analyzeBtn.addEventListener('click', () => this.startAnalysis());
    if (exportBtn) exportBtn.addEventListener('click', () => this.exportResults());
  }

  async startAnalysis() {
    const fileInput = document.getElementById('pdfFiles');
    if (!fileInput || fileInput.files.length === 0) { alert('Seleccione al menos un archivo PDF.'); return; }
    this.filesToProcess = Array.from(fileInput.files);
    this.currentFileIndex = 0;
    this.results = [];
    const progressContainer = document.getElementById('progressContainer');
    const resultsContainer = document.getElementById('resultsContainer');
    if (progressContainer) progressContainer.style.display = 'block';
    if (resultsContainer) resultsContainer.style.display = 'none';
    await this.processFiles();
  }

  async processFiles() {
    for (let i = 0; i < this.filesToProcess.length; i++) {
      this.currentFileIndex = i;
      const file = this.filesToProcess[i];
      const currentFile = document.getElementById('currentFile');
      if (currentFile) currentFile.textContent = file.name;
      const progress = ((i + 1) / this.filesToProcess.length) * 100;
      const progressBar = document.getElementById('progressBar');
      if (progressBar) progressBar.style.width = `${progress}%`;
      try { this.results.push(await this.analyzePDF(file)); }
      catch (error) { this.results.push({ filename: file.name, error: `No se pudo procesar el archivo: ${error.message}` }); }
    }
    this.displayResults();
  }

  async analyzePDF(file) {
    if (file.type !== 'application/pdf') throw new Error('El archivo no es un PDF válido');
    const arrayBuffer = await file.arrayBuffer();
    if (arrayBuffer.byteLength === 0) throw new Error('El archivo está vacío');
    const loadingTask = pdfjsLib.getDocument({ data: arrayBuffer, cMapUrl: 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/4.5.136/cmaps/', cMapPacked: true });
    const pdf = await loadingTask.promise;
    if (pdf.numPages === 0) throw new Error('El PDF no tiene páginas');

    const pageTexts = [];
    for (let i = 1; i <= pdf.numPages; i++) {
      try {
        const page = await pdf.getPage(i);
        const textContent = await page.getTextContent({ normalizeWhitespace: true, disableCombineTextItems: false });
        const pageText = textContent.items.map(it => it.str).join(' ').replace(/\s+/g, ' ').trim();
        pageTexts.push(pageText);
      } catch (_) {}
    }

    const stripped = TextUtils.stripRepeatedLines(pageTexts);
    const { raw, fold } = TextUtils.normalize(stripped);
    if (raw.length < 80) throw new Error(`No se pudo extraer suficiente texto (${raw.length} caracteres)`);

    const sections = TextUtils.splitSections(raw);
    const meta = TextUtils.extractMetadata(raw);
    const quant = this.engine.extractQuantSignals(raw);

    const dominantScope = [sections.methods, sections.abstract, raw].find(Boolean);
    const studyType = this.engine.detectStudyType(dominantScope);

    const software = this.engine.detectSoftware(raw);
    const stats = this.engine.detectStats(raw);

    const hasIMRaD = (() => {
      const pos = (term) => fold.indexOf(term);
      const intro = ['introduction', 'introduccion', 'introducao'];
      const meth = ['methods', 'metodos', 'metodologia'];
      const resu = ['results', 'resultados'];
      const disc = ['discussion', 'discusion', 'discussao'];
      const i = intro.map(pos).filter(x => x >= 0).sort((a,b)=>a-b)[0];
      const m = meth.map(pos).filter(x => x >= 0).sort((a,b)=>a-b)[0];
      const r = resu.map(pos).filter(x => x >= 0).sort((a,b)=>a-b)[0];
      const d = disc.map(pos).filter(x => x >= 0).sort((a,b)=>a-b)[0];
      return [i,m,r,d].every(v => typeof v === 'number') && i < m && m < r && r < d;
    })();

    const hasAbstract = /(abstract|resumen|summary|resumo)\b/i.test(fold);
    const hasObjectives = /(objective|objetivo|objetivos)\b/i.test(fold);
    const hasConclusions = /(conclusion|conclusiones|conclusoes)\b/i.test(fold);

    const hasDataAvailability = /(data\s*availability|datos\s*disponibles|disponibilidade\s*de\s*dados|repositorio|doi:10\.)/i.test(fold);
    const hasCodeAvailability = /(code\s*availability|github|gitlab|bitbucket|osf\.io)/i.test(fold);
    const variables = /(variable(s)?\s*(dependiente|independiente)|variavel|covariates?|covariaveis|outcomes?|desfechos|predictors?|preditores)/i.test(fold);

    const hasBiasDiscussion = /(bias|sesgo|vi[ea]s|limitacion|limitacoes|limitacao|debilidad|fraqueza)\b/i.test(fold);
    const hasSensitivityAnalysis = /(sensitivity\s*analysis|analisis\s*de\s*sensibilidad|analise\s*de\s*sensibilidade|robust(ez|ezza)?)|robustez/i.test(fold);
    const hasStatisticalSignificance = /(statistically\s*significant|significativo\s*estadistico|significante\s*estatistico|p\s*[=<>]\s*0?\.\d+)/i.test(fold);

    const hasNovelty = /(novel|novedoso|inovador|first\s*report)/i.test(fold);
    const hasImpact = /(impact|importante|relevante|contribucion\s*significativa|contribuicao\s*significativa)/i.test(fold);
    const hasApplications = /(applications?|aplicaciones?|aplicacoes?|implicaciones?)\b/i.test(fold);

    const hasFigures = /(figure|figura|table|tabla|tabela|graph|grafico)\b/i.test(fold);
    const hasClearResults = /(results\s*show|encontramos|observamos|foi\s*observado|demonstrated|demonstramos|demostramos)/i.test(fold);

    const hasOpenAccess = meta.openAccess;
    const hasEthicsApproval = meta.ethicsApproval || /(informed\s*consent|consentimiento\s*informado|consentimento\s*informado)/i.test(fold);
    const hasConflicts = /(conflicts?\s*of\s*interest|declaracion\s*de\s*intereses|conflito(s)?\s*de\s*interesse(s)?|disclosure)/i.test(fold);

    const analysis = {
      methodology: { hasSample: quant.sampleN != null, sampleSize: quant.sampleN, hasVariables: variables, hasStats: stats.length > 0 },
      reportingQuality: { hasIMRaD, hasAbstract, hasObjectives, hasConclusions },
      transparency: { hasDataAvailability, hasCodeAvailability, hasSoftwareMention: software.length > 0 },
      rigor: { hasBiasDiscussion, hasSensitivityAnalysis, hasStatisticalSignificance },
      relevance: { hasNovelty, hasImpact, hasApplications },
      presentation: { hasFigures, hasClearResults },
      accessibility: { hasOpenAccess, hasEthicsApproval, hasConflicts },
    };

    const globalScore = this.calculateGlobalScore(analysis, studyType);
    const verdict = this.determineVerdict(globalScore);
    const contrib = this.topSignals(analysis, studyType, { pvals: quant.pvals, cis: quant.cis, effects: quant.effects, stats, software });

    return { filename: file.name, totalPages: pdf.numPages, textLength: raw.length, sectionsFound: Object.keys(sections), studyType, metadata: meta, quantSignals: quant, software, stats, ...analysis, globalScore, verdict, explanations: contrib };
  }

  topSignals(analysis, studyType, extras) {
    const signals = [];
    if (analysis.methodology.hasStats) signals.push('Menciona técnicas estadísticas');
    if (analysis.methodology.hasVariables) signals.push('Declara variables, covariables o desfechos');
    if (analysis.reportingQuality.hasIMRaD) signals.push('Estructura IMRaD detectada');
    if (analysis.transparency.hasDataAvailability) signals.push('Sección de datos disponibles');
    if (analysis.transparency.hasCodeAvailability) signals.push('Código o repositorio mencionado');
    if (analysis.rigor.hasSensitivityAnalysis) signals.push('Análisis de sensibilidad');
    if (extras.pvals > 0) signals.push(`P-valores detectados: ${extras.pvals}`);
    if (extras.cis > 0) signals.push(`Intervalos de confianza detectados: ${extras.cis}`);
    if (extras.effects > 0) signals.push(`Medidas de efecto detectadas: ${extras.effects}`);
    signals.push(`Tipo de estudio sugerido: ${studyType.label} (${Math.round(studyType.probability * 100)}%)`);
    return signals.slice(0, 8);
  }

  calculateGlobalScore(analysis, studyType) {
    const weights = { methodology: 0.27, reportingQuality: 0.18, transparency: 0.15, rigor: 0.17, relevance: 0.13, presentation: 0.05, accessibility: 0.05 };
    const key = studyType.key;
    if (key === 'rct' || key === 'cohort' || key === 'casecontrol') { weights.rigor += 0.03; weights.methodology += 0.02; }
    if (key === 'systematic' || key === 'metaanalysis') { weights.transparency += 0.03; weights.reportingQuality += 0.02; }

    const scoreDim = (obj) => { const vals = Object.values(obj); const num = vals.filter(v => v === true || typeof v === 'number').length; return Math.round((num / vals.length) * 100); };
    const methodologyScore = scoreDim(analysis.methodology);
    const reportingScore = scoreDim(analysis.reportingQuality);
    const transparencyScore = scoreDim(analysis.transparency);
    const rigorScore = scoreDim(analysis.rigor);
    const relevanceScore = scoreDim(analysis.relevance);
    const presentationScore = scoreDim(analysis.presentation);
    const accessibilityScore = scoreDim(analysis.accessibility);
    const total = methodologyScore * weights.methodology + reportingScore * weights.reportingQuality + transparencyScore * weights.transparency + rigorScore * weights.rigor + relevanceScore * weights.relevance + presentationScore * weights.presentation + accessibilityScore * weights.accessibility;
    return Math.round(total);
  }

  determineVerdict(score) { if (score >= 80) return 'Aprobado'; if (score >= 60) return 'Revisión Requerida'; return 'Rechazar'; }

  displayResults() {
    const progressContainer = document.getElementById('progressContainer');
    const resultsContainer = document.getElementById('resultsContainer');
    if (progressContainer) progressContainer.style.display = 'none';
    if (resultsContainer) resultsContainer.style.display = 'block';
    const resultsBody = document.getElementById('resultsBody');
    if (!resultsBody) return;
    resultsBody.innerHTML = '';

    this.results.forEach((r, index) => {
      if (r.error) { resultsBody.innerHTML += `\n        <tr>\n          <td>${r.filename}</td>\n          <td colspan=\"12\" class=\"text-danger\">${r.error}</td>\n        </tr>`; return; }
      const row = `\n        <tr>\n          <td>${r.filename}</td>\n          <td>${this.badgeScore(r.globalScore)}</td>\n          <td>${this.badgeVerdict(r.verdict)}</td>\n          <td>${this.badgeScore(this.dimScore(r.methodology))}</td>\n          <td>${this.badgeScore(this.dimScore(r.reportingQuality))}</td>\n          <td>${this.badgeScore(this.dimScore(r.transparency))}</td>\n          <td>${this.badgeScore(this.dimScore(r.rigor))}</td>\n          <td>${this.badgeScore(this.dimScore(r.relevance))}</td>\n          <td>${this.badgeScore(this.dimScore(r.presentation))}</td>\n          <td>${this.badgeScore(this.dimScore(r.accessibility))}</td>\n          <td>${r.studyType.label} (${Math.round(r.studyType.probability * 100)}%)</td>\n          <td><button class=\"btn btn-sm btn-info\" onclick=\"analyzer.showDetails(${index})\">Detalles</button></td>\n        </tr>`;
      resultsBody.innerHTML += row;
    });
    this.createCharts();
  }

  dimScore(dimension) { const vals = Object.values(dimension); const num = vals.filter(v => v === true || typeof v === 'number').length; return Math.round((num / vals.length) * 100); }
  badgeScore(score) { const cls = score >= 80 ? 'score-high' : score >= 60 ? 'score-medium' : 'score-low'; return `<span class=\"score-cell ${cls}\">${score}</span>`; }
  badgeVerdict(verdict) { const cls = verdict === 'Aprobado' ? 'verdict-approved' : verdict === 'Revisión Requerida' ? 'verdict-review' : 'verdict-reject'; return `<span class=\"${cls}\">${verdict}</span>`; }

  createCharts() {
    const valid = this.results.filter(r => !r.error);
    if (valid.length === 0) return;
    const scoresEl = document.getElementById('scoresChart');
    if (scoresEl) new Chart(scoresEl.getContext('2d'), { type: 'bar', data: { labels: valid.map(r => r.filename), datasets: [{ label: 'Puntuación Global', data: valid.map(r => r.globalScore), backgroundColor: valid.map(r => r.verdict === 'Aprobado' ? 'rgba(40,167,69,0.7)' : r.verdict === 'Revisión Requerida' ? 'rgba(255,193,7,0.7)' : 'rgba(220,53,69,0.7)') }] }, options: { responsive: true, plugins: { legend: { display: false }, title: { display: true, text: 'Puntuaciones Globales' } }, scales: { y: { beginAtZero: true, max: 100 } } } });
    const verdictCounts = valid.reduce((acc, r) => { acc[r.verdict] = (acc[r.verdict] || 0) + 1; return acc; }, {});
    const verdictEl = document.getElementById('verdictChart');
    if (verdictEl) new Chart(verdictEl.getContext('2d'), { type: 'doughnut', data: { labels: Object.keys(verdictCounts), datasets: [{ data: Object.values(verdictCounts), backgroundColor: ['rgba(40,167,69,0.7)','rgba(255,193,7,0.7)','rgba(220,53,69,0.7)'] }] }, options: { responsive: true, plugins: { legend: { position: 'bottom' }, title: { display: true, text: 'Distribución de Veredictos' } } } });
    const byType = valid.reduce((acc, r) => { const k = r.studyType.label; acc[k] = (acc[k] || 0) + 1; return acc; }, {});
    const studyEl = document.getElementById('studyTypeChart');
    if (studyEl) new Chart(studyEl.getContext('2d'), { type: 'bar', data: { labels: Object.keys(byType), datasets: [{ label: 'Número de artículos', data: Object.values(byType), backgroundColor: 'rgba(54,162,235,0.7)' }] }, options: { indexAxis: 'y', responsive: true, plugins: { legend: { display: false }, title: { display: true, text: 'Clasificación por tipo de estudio' } } } });
  }

  showDetails(index) {
    const r = this.results[index];
    const details = document.getElementById('detailsContainer');
    if (!details) return;
    if (r.error) { details.innerHTML = `<p class=\"text-danger\">${r.error}</p>`; return; }
    const md = r.metadata || {}; const q = r.quantSignals || {}; const secList = (r.sectionsFound || []).join(', ');
    details.innerHTML = `
      <h6>${r.filename}</h6>
      <p><strong>PDF:</strong> ${r.totalPages} páginas, ${r.textLength} caracteres extraídos</p>
      <p><strong>Secciones detectadas:</strong> ${secList || 'No detectadas'}</p>
      <p><strong>Tipo de estudio:</strong> ${r.studyType.label} (${Math.round(r.studyType.probability * 100)}%)</p>
      <p><strong>DOI:</strong> ${md.doi || 'No detectado'} | <strong>Registro:</strong> ${md.trialId || md.prospero || '—'} | <strong>ORCID:</strong> ${md.orcid || '—'}</p>
      <div class=\"detail-section\"><div class=\"detail-title\">Metodología</div><ul>
        <li>Basado en muestra: ${r.methodology.hasSample ? 'Sí' : 'No'}</li>
        <li>Tamaño muestral: ${r.methodology.sampleSize ?? 'No especificado'}</li>
        <li>Variables, desfechos o covariables: ${r.methodology.hasVariables ? 'Sí' : 'No'}</li>
        <li>Técnicas estadísticas: ${r.methodology.hasStats ? 'Sí' : 'No'}</li>
        <li>Software: ${(r.software || []).join(', ') || '—'}</li>
        <li>Métodos: ${(r.stats || []).join(', ') || '—'}</li>
      </ul></div>
      <div class=\"detail-section\"><div class=\"detail-title\">Señales cuantitativas</div><ul>
        <li>P-valores: ${q.pvals || 0}</li>
        <li>Intervalos de confianza: ${q.cis || 0}</li>
        <li>Medidas de efecto: ${q.effects || 0}</li>
      </ul></div>
      <div class=\"detail-section\"><div class=\"detail-title\">Calidad del Reporte</div><ul>
        <li>Estructura IMRaD: ${r.reportingQuality.hasIMRaD ? 'Sí' : 'No'}</li>
        <li>Resumen, Abstract o Resumo: ${r.reportingQuality.hasAbstract ? 'Sí' : 'No'}</li>
        <li>Objetivos claros: ${r.reportingQuality.hasObjectives ? 'Sí' : 'No'}</li>
        <li>Conclusiones: ${r.reportingQuality.hasConclusions ? 'Sí' : 'No'}</li>
      </ul></div>
      <div class=\"detail-section\"><div class=\"detail-title\">Transparencia y Reproducibilidad</div><ul>
        <li>Disponibilidad de datos: ${r.transparency.hasDataAvailability ? 'Sí' : 'No'}</li>
        <li>Disponibilidad de código: ${r.transparency.hasCodeAvailability ? 'Sí' : 'No'}</li>
        <li>Software mencionado: ${r.transparency.hasSoftwareMention ? 'Sí' : 'No'}</li>
      </ul></div>
      <div class=\"detail-section\"><div class=\"detail-title\">Rigor Científico</div><ul>
        <li>Discusión de sesgos, vieses o limitaciones: ${r.rigor.hasBiasDiscussion ? 'Sí' : 'No'}</li>
        <li>Análisis de sensibilidad, sensibilidade o robustez: ${r.rigor.hasSensitivityAnalysis ? 'Sí' : 'No'}</li>
        <li>Significancia estadística: ${r.rigor.hasStatisticalSignificance ? 'Sí' : 'No'}</li>
      </ul></div>
      <div class=\"detail-section\"><div class=\"detail-title\">Relevancia y Originalidad</div><ul>
        <li>Novedad o inovação: ${r.relevance.hasNovelty ? 'Sí' : 'No'}</li>
        <li>Impacto: ${r.relevance.hasImpact ? 'Sí' : 'No'}</li>
        <li>Aplicaciones: ${r.relevance.hasApplications ? 'Sí' : 'No'}</li>
      </ul></div>
      <div class=\"detail-section\"><div class=\"detail-title\">Presentación de Resultados</div><ul>
        <li>Figuras o tablas: ${r.presentation.hasFigures ? 'Sí' : 'No'}</li>
        <li>Resultados claros: ${r.presentation.hasClearResults ? 'Sí' : 'No'}</li>
      </ul></div>
      <div class=\"detail-section\"><div class=\"detail-title\">Accesibilidad y Ética</div><ul>
        <li>Acceso abierto: ${r.accessibility.hasOpenAccess ? 'Sí' : 'No'}</li>
        <li>Aprobación ética o aprovação ética: ${r.accessibility.hasEthicsApproval ? 'Sí' : 'No'}</li>
        <li>Conflictos de interés o conflitos de interesse: ${r.accessibility.hasConflicts ? 'Sí' : 'No'}</li>
      </ul></div>
      <div class=\"detail-section\"><div class=\"detail-title\">Principales señales</div><ul>${r.explanations.map(s => `<li>${s}</li>`).join('')}</ul></div>`;
  }

  exportResults() {
    const exportData = this.results.map(r => ({
      'Archivo': r.filename,
      'Puntuación Global': r.globalScore || 'Error',
      'Veredicto': r.verdict || 'Error',
      'Tipo de estudio': r.studyType ? r.studyType.label : '—',
      'Probabilidad tipo (%)': r.studyType ? Math.round(r.studyType.probability * 100) : '—',
      'DOI': r.metadata ? r.metadata.doi : '—',
      'Registro': r.metadata ? (r.metadata.trialId || r.metadata.prospero || '—') : '—',
      'Tamaño muestral': r.methodology ? (r.methodology.sampleSize ?? '—') : '—',
      'Software': (r.software || []).join(', '),
      'Métodos': (r.stats || []).join(', '),
      'IMRaD': r.reportingQuality ? (r.reportingQuality.hasIMRaD ? 'Sí' : 'No') : '—',
      'Datos disponibles': r.transparency ? (r.transparency.hasDataAvailability ? 'Sí' : 'No') : '—',
      'Código disponible': r.transparency ? (r.transparency.hasCodeAvailability ? 'Sí' : 'No') : '—',
      'Ética': r.accessibility ? (r.accessibility.hasEthicsApproval ? 'Sí' : 'No') : '—',
    }));
    const wb = XLSX.utils.book_new();
    const ws = XLSX.utils.json_to_sheet(exportData);
    XLSX.utils.book_append_sheet(wb, ws, 'Resultados');
    XLSX.writeFile(wb, 'resultados_analisis.xlsx');
  }
}

// Inicialización
window.addEventListener('DOMContentLoaded', () => { window.analyzer = new ScientificArticleAnalyzer(); });
