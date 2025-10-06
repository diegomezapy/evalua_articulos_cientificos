// Configuración de PDF.js
pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/2.11.338/pdf.worker.min.js';

// Clase principal del analizador
class ScientificArticleAnalyzer {
    constructor() {
        this.results = [];
        this.currentFileIndex = 0;
        this.filesToProcess = [];
        this.initializeEventListeners();
    }

    initializeEventListeners() {
        document.getElementById('analyzeBtn').addEventListener('click', () => this.startAnalysis());
        document.getElementById('exportBtn').addEventListener('click', () => this.exportResults());
    }

    async startAnalysis() {
        const fileInput = document.getElementById('pdfFiles');
        
        if (fileInput.files.length === 0) {
            alert('Por favor, seleccione al menos un archivo PDF.');
            return;
        }

        this.filesToProcess = Array.from(fileInput.files);
        this.currentFileIndex = 0;
        this.results = [];

        document.getElementById('progressContainer').style.display = 'block';
        document.getElementById('resultsContainer').style.display = 'none';

        await this.processFiles();
    }

    async processFiles() {
        for (let i = 0; i < this.filesToProcess.length; i++) {
            this.currentFileIndex = i;
            const file = this.filesToProcess[i];
            
            document.getElementById('currentFile').textContent = file.name;
            const progress = ((i + 1) / this.filesToProcess.length) * 100;
            document.getElementById('progressBar').style.width = `${progress}%`;

            try {
                console.log(`\n=== Procesando archivo: ${file.name} ===`);
                const result = await this.analyzePDF(file);
                this.results.push(result);
                console.log(`✓ Análisis completado para: ${file.name}`);
            } catch (error) {
                console.error(`✗ Error al procesar ${file.name}:`, error);
                this.results.push({
                    filename: file.name,
                    error: `No se pudo procesar el archivo: ${error.message}`
                });
            }
        }

        this.displayResults();
    }

    async analyzePDF(file) {
        try {
            console.log(`1. Leyendo archivo: ${file.name} (${file.size} bytes)`);
            
            // Verificar si el archivo es un PDF
            if (file.type !== 'application/pdf') {
                throw new Error('El archivo no es un PDF válido');
            }

            const arrayBuffer = await file.arrayBuffer();
            console.log(`2. Buffer leído: ${arrayBuffer.byteLength} bytes`);
            
            if (arrayBuffer.byteLength === 0) {
                throw new Error('El archivo está vacío');
            }

            // Cargar el PDF con PDF.js
            const loadingTask = pdfjsLib.getDocument({
                data: arrayBuffer,
                cMapUrl: 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/2.11.338/cmaps/',
                cMapPacked: true
            });
            
            console.log('3. Iniciando carga del PDF...');
            const pdf = await loadingTask.promise;
            console.log(`4. PDF cargado: ${pdf.numPages} páginas`);
            
            if (pdf.numPages === 0) {
                throw new Error('El PDF no tiene páginas');
            }

            let fullText = '';
            let pagesProcessed = 0;

            // Extraer texto de cada página
            for (let i = 1; i <= pdf.numPages; i++) {
                try {
                    const page = await pdf.getPage(i);
                    const textContent = await page.getTextContent({
                        normalizeWhitespace: true,
                        disableCombineTextItems: false
                    });
                    
                    const pageText = textContent.items
                        .map(item => item.str)
                        .join(' ')
                        .replace(/\s+/g, ' ')
                        .trim();
                    
                    fullText += pageText + ' ';
                    pagesProcessed++;
                    
                    if (i % 5 === 0 || i === pdf.numPages) {
                        console.log(`   Página ${i}/${pdf.numPages} procesada (${pageText.length} caracteres)`);
                    }
                } catch (pageError) {
                    console.warn(`   ⚠ Error al procesar página ${i}:`, pageError);
                    // Continuar con la siguiente página
                }
            }

            console.log(`5. Texto completo extraído: ${fullText.length} caracteres`);
            console.log(`   Páginas procesadas: ${pagesProcessed}/${pdf.numPages}`);
            
            // Verificar si se extrajo suficiente texto
            if (fullText.length < 50) {
                throw new Error(`No se pudo extraer suficiente texto (${fullText.length} caracteres)`);
            }

            // Realizar análisis del texto extraído
            const analysis = this.performTextAnalysis(fullText);
            
            return {
                filename: file.name,
                totalPages: pdf.numPages,
                textLength: fullText.length,
                ...analysis
            };
        } catch (error) {
            console.error('Error en analyzePDF:', error);
            throw error;
        }
    }

    performTextAnalysis(text) {
        console.log('6. Iniciando análisis de texto');
        
        // Implementación simplificada del análisis
        const analysis = {
            methodology: this.analyzeMethodology(text),
            reportingQuality: this.analyzeReportingQuality(text),
            transparency: this.analyzeTransparency(text),
            rigor: this.analyzeRigor(text),
            relevance: this.analyzeRelevance(text),
            presentation: this.analyzePresentation(text),
            accessibility: this.analyzeAccessibility(text)
        };

        // Calcular puntuación global
        const globalScore = this.calculateGlobalScore(analysis);
        const verdict = this.determineVerdict(globalScore);

        console.log('7. Análisis completado:', { 
            globalScore, 
            verdict,
            methodology: analysis.methodology,
            reportingQuality: analysis.reportingQuality
        });
        
        return {
            ...analysis,
            globalScore,
            verdict
        };
    }

    analyzeMethodology(text) {
        const hasSample = /\b(muestra|sample|participantes|patients|subjects)\b/i.test(text);
        const sampleSize = text.match(/\bn\s*=\s*(\d+)/i);
        const hasVariables = /\b(variables?|predictors?|outcomes?)\b/i.test(text);
        const hasStats = /\b(statistics?|regression|anova|t-test|p-value)\b/i.test(text);
        
        console.log(`   Metodología: hasSample=${hasSample}, sampleSize=${sampleSize?.[1]}, hasVariables=${hasVariables}, hasStats=${hasStats}`);
        
        return {
            hasSample,
            sampleSize: sampleSize ? parseInt(sampleSize[1]) : null,
            hasVariables,
            hasStats
        };
    }

    analyzeReportingQuality(text) {
        const hasIMRaD = /\b(introduction|methods|results|discussion)\b/i.test(text);
        const hasAbstract = /\b(abstract|resumen)\b/i.test(text);
        const hasObjectives = /\b(objectives?|aims?|goals?)\b/i.test(text);
        const hasConclusions = /\b(conclusions?|conclusion)\b/i.test(text);
        
        console.log(`   Reporte: IMRaD=${hasIMRaD}, Abstract=${hasAbstract}, Objectives=${hasObjectives}, Conclusions=${hasConclusions}`);
        
        return {
            hasIMRaD,
            hasAbstract,
            hasObjectives,
            hasConclusions
        };
    }

    analyzeTransparency(text) {
        const hasDataAvailability = /\b(data\s*availability|supplementary\s*material)\b/i.test(text);
        const hasCodeAvailability = /\b(code\s*availability|github|gitlab)\b/i.test(text);
        const hasSoftwareMention = /\b(software|tool|package)\b/i.test(text);
        
        return {
            hasDataAvailability,
            hasCodeAvailability,
            hasSoftwareMention
        };
    }

    analyzeRigor(text) {
        const hasBiasDiscussion = /\b(bias|limitation|weakness)\b/i.test(text);
        const hasSensitivityAnalysis = /\b(sensitivity\s*analysis|robustness)\b/i.test(text);
        const hasStatisticalSignificance = /\b(statistically\s*significant|p\s*<\s*0\.05)\b/i.test(text);
        
        return {
            hasBiasDiscussion,
            hasSensitivityAnalysis,
            hasStatisticalSignificance
        };
    }

    analyzeRelevance(text) {
        const hasNovelty = /\b(novel|new|innovative|first\s*report)\b/i.test(text);
        const hasImpact = /\b(impact|important|significant\s*contribution)\b/i.test(text);
        const hasApplications = /\b(applications?|implications?|practical)\b/i.test(text);
        
        return {
            hasNovelty,
            hasImpact,
            hasApplications
        };
    }

    analyzePresentation(text) {
        const hasFigures = /\b(figures?|tables?|graphs?)\b/i.test(text);
        const hasClearResults = /\b(results\s*show|we\s*found|demonstrated)\b/i.test(text);
        
        return {
            hasFigures,
            hasClearResults
        };
    }

    analyzeAccessibility(text) {
        const hasOpenAccess = /\b(open\s*access|creative\s*commons)\b/i.test(text);
        const hasEthicsApproval = /\b(ethics\s*approval|informed\s*consent)\b/i.test(text);
        const hasConflicts = /\b(conflicts?\s*of\s*interest|disclosure)\b/i.test(text);
        
        return {
            hasOpenAccess,
            hasEthicsApproval,
            hasConflicts
        };
    }

    calculateGlobalScore(analysis) {
        // Pesos para cada dimensión
        const weights = {
            methodology: 0.25,
            reportingQuality: 0.20,
            transparency: 0.15,
            rigor: 0.15,
            relevance: 0.15,
            presentation: 0.05,
            accessibility: 0.05
        };

        let totalScore = 0;

        // Calcular puntuación por dimensión
        const methodologyScore = (analysis.methodology.hasSample ? 25 : 0) + 
                                 (analysis.methodology.sampleSize ? 25 : 0) + 
                                 (analysis.methodology.hasVariables ? 25 : 0) + 
                                 (analysis.methodology.hasStats ? 25 : 0);
        
        const reportingScore = (analysis.reportingQuality.hasIMRaD ? 25 : 0) + 
                              (analysis.reportingQuality.hasAbstract ? 25 : 0) + 
                              (analysis.reportingQuality.hasObjectives ? 25 : 0) + 
                              (analysis.reportingQuality.hasConclusions ? 25 : 0);
        
        const transparencyScore = (analysis.transparency.hasDataAvailability ? 33 : 0) + 
                                (analysis.transparency.hasCodeAvailability ? 33 : 0) + 
                                (analysis.transparency.hasSoftwareMention ? 34 : 0);
        
        const rigorScore = (analysis.rigor.hasBiasDiscussion ? 33 : 0) + 
                          (analysis.rigor.hasSensitivityAnalysis ? 33 : 0) + 
                          (analysis.rigor.hasStatisticalSignificance ? 34 : 0);
        
        const relevanceScore = (analysis.relevance.hasNovelty ? 33 : 0) + 
                             (analysis.relevance.hasImpact ? 34 : 0) + 
                             (analysis.relevance.hasApplications ? 33 : 0);
        
        const presentationScore = (analysis.presentation.hasFigures ? 50 : 0) + 
                                (analysis.presentation.hasClearResults ? 50 : 0);
        
        const accessibilityScore = (analysis.accessibility.hasOpenAccess ? 33 : 0) + 
                                 (analysis.accessibility.hasEthicsApproval ? 34 : 0) + 
                                 (analysis.accessibility.hasConflicts ? 33 : 0);

        // Calcular puntuación global ponderada
        totalScore = (methodologyScore * weights.methodology) +
                     (reportingScore * weights.reportingQuality) +
                     (transparencyScore * weights.transparency) +
                     (rigorScore * weights.rigor) +
                     (relevanceScore * weights.relevance) +
                     (presentationScore * weights.presentation) +
                     (accessibilityScore * weights.accessibility);

        return Math.round(totalScore);
    }

    determineVerdict(score) {
        if (score >= 80) return 'Aprobado';
        if (score >= 60) return 'Revisión Requerida';
        return 'Rechazar';
    }

    displayResults() {
        document.getElementById('progressContainer').style.display = 'none';
        document.getElementById('resultsContainer').style.display = 'block';

        const resultsBody = document.getElementById('resultsBody');
        resultsBody.innerHTML = '';

        this.results.forEach((result, index) => {
            if (result.error) {
                resultsBody.innerHTML += `
                    <tr>
                        <td>${result.filename}</td>
                        <td colspan="9" class="text-danger">${result.error}</td>
                        <td>-</td>
                    </tr>
                `;
                return;
            }

            const row = `
                <tr>
                    <td>${result.filename}</td>
                    <td class="score-cell ${this.getScoreClass(result.globalScore)}">${result.globalScore}</td>
                    <td class="${this.getVerdictClass(result.verdict)}">${result.verdict}</td>
                    <td>${this.calculateDimensionScore(result.methodology)}</td>
                    <td>${this.calculateDimensionScore(result.reportingQuality)}</td>
                    <td>${this.calculateDimensionScore(result.transparency)}</td>
                    <td>${this.calculateDimensionScore(result.rigor)}</td>
                    <td>${this.calculateDimensionScore(result.relevance)}</td>
                    <td>${this.calculateDimensionScore(result.presentation)}</td>
                    <td>${this.calculateDimensionScore(result.accessibility)}</td>
                    <td>
                        <button class="btn btn-sm btn-info" onclick="analyzer.showDetails(${index})">Detalles</button>
                    </td>
                </tr>
            `;
            resultsBody.innerHTML += row;
        });

        this.createCharts();
    }

    calculateDimensionScore(dimension) {
        const values = Object.values(dimension);
        const trueCount = values.filter(v => v === true || typeof v === 'number').length;
        const score = Math.round((trueCount / values.length) * 100);
        return `<span class="score-cell ${this.getScoreClass(score)}">${score}</span>`;
    }

    getScoreClass(score) {
        if (score >= 80) return 'score-high';
        if (score >= 60) return 'score-medium';
        return 'score-low';
    }

    getVerdictClass(verdict) {
        switch (verdict) {
            case 'Aprobado': return 'verdict-approved';
            case 'Revisión Requerida': return 'verdict-review';
            case 'Rechazar': return 'verdict-reject';
            default: return '';
        }
    }

    createCharts() {
        // Filtrar resultados con errores
        const validResults = this.results.filter(r => !r.error);
        
        if (validResults.length === 0) {
            console.log('No hay resultados válidos para mostrar en los gráficos');
            return;
        }

        // Gráfico de puntuaciones
        const scoresCtx = document.getElementById('scoresChart').getContext('2d');
        new Chart(scoresCtx, {
            type: 'bar',
            data: {
                labels: validResults.map(r => r.filename),
                datasets: [{
                    label: 'Puntuación Global',
                    data: validResults.map(r => r.globalScore),
                    backgroundColor: validResults.map(r => {
                        if (r.verdict === 'Aprobado') return 'rgba(40, 167, 69, 0.7)';
                        if (r.verdict === 'Revisión Requerida') return 'rgba(255, 193, 7, 0.7)';
                        return 'rgba(220, 53, 69, 0.7)';
                    })
                }]
            },
            options: {
                responsive: true,
                plugins: {
                    legend: {
                        display: false
                    },
                    title: {
                        display: true,
                        text: 'Puntuaciones Globales'
                    }
                },
                scales: {
                    y: {
                        beginAtZero: true,
                        max: 100
                    }
                }
            }
        });

        // Gráfico de veredictos
        const verdictCounts = validResults.reduce((acc, result) => {
            acc[result.verdict] = (acc[result.verdict] || 0) + 1;
            return acc;
        }, {});

        const verdictCtx = document.getElementById('verdictChart').getContext('2d');
        new Chart(verdictCtx, {
            type: 'doughnut',
            data: {
                labels: Object.keys(verdictCounts),
                datasets: [{
                    data: Object.values(verdictCounts),
                    backgroundColor: [
                        'rgba(40, 167, 69, 0.7)',
                        'rgba(255, 193, 7, 0.7)',
                        'rgba(220, 53, 69, 0.7)'
                    ]
                }]
            },
            options: {
                responsive: true,
                plugins: {
                    legend: {
                        position: 'bottom'
                    },
                    title: {
                        display: true,
                        text: 'Distribución de Veredictos'
                    }
                }
            }
        });
    }

    showDetails(index) {
        const result = this.results[index];
        const detailsContainer = document.getElementById('detailsContainer');
        
        if (result.error) {
            detailsContainer.innerHTML = `<p class="text-danger">${result.error}</p>`;
            return;
        }
        
        let detailsHTML = `
            <h6>${result.filename}</h6>
            <p><strong>Información del PDF:</strong> ${result.totalPages} páginas, ${result.textLength} caracteres extraídos</p>
            <div class="detail-section">
                <div class="detail-title">Metodología</div>
                <ul>
                    <li>Basado en muestra: ${result.methodology.hasSample ? 'Sí' : 'No'}</li>
                    <li>Tamaño muestral: ${result.methodology.sampleSize || 'No especificado'}</li>
                    <li>Variables definidas: ${result.methodology.hasVariables ? 'Sí' : 'No'}</li>
                    <li>Técnicas estadísticas: ${result.methodology.hasStats ? 'Sí' : 'No'}</li>
                </ul>
            </div>
            <div class="detail-section">
                <div class="detail-title">Calidad del Reporte</div>
                <ul>
                    <li>Estructura IMRaD: ${result.reportingQuality.hasIMRaD ? 'Sí' : 'No'}</li>
                    <li>Resumen/Abstract: ${result.reportingQuality.hasAbstract ? 'Sí' : 'No'}</li>
                    <li>Objetivos claros: ${result.reportingQuality.hasObjectives ? 'Sí' : 'No'}</li>
                    <li>Conclusiones: ${result.reportingQuality.hasConclusions ? 'Sí' : 'No'}</li>
                </ul>
            </div>
            <div class="detail-section">
                <div class="detail-title">Transparencia y Reproducibilidad</div>
                <ul>
                    <li>Disponibilidad de datos: ${result.transparency.hasDataAvailability ? 'Sí' : 'No'}</li>
                    <li>Disponibilidad de código: ${result.transparency.hasCodeAvailability ? 'Sí' : 'No'}</li>
                    <li>Software mencionado: ${result.transparency.hasSoftwareMention ? 'Sí' : 'No'}</li>
                </ul>
            </div>
            <div class="detail-section">
                <div class="detail-title">Rigor Científico</div>
                <ul>
                    <li>Discusión de sesgos: ${result.rigor.hasBiasDiscussion ? 'Sí' : 'No'}</li>
                    <li>Análisis de sensibilidad: ${result.rigor.hasSensitivityAnalysis ? 'Sí' : 'No'}</li>
                    <li>Significancia estadística: ${result.rigor.hasStatisticalSignificance ? 'Sí' : 'No'}</li>
                </ul>
            </div>
            <div class="detail-section">
                <div class="detail-title">Relevancia y Originalidad</div>
                <ul>
                    <li>Novedad: ${result.relevance.hasNovelty ? 'Sí' : 'No'}</li>
                    <li>Impacto: ${result.relevance.hasImpact ? 'Sí' : 'No'}</li>
                    <li>Aplicaciones: ${result.relevance.hasApplications ? 'Sí' : 'No'}</li>
                </ul>
            </div>
            <div class="detail-section">
                <div class="detail-title">Presentación de Resultados</div>
                <ul>
                    <li>Figuras/Tablas: ${result.presentation.hasFigures ? 'Sí' : 'No'}</li>
                    <li>Resultados claros: ${result.presentation.hasClearResults ? 'Sí' : 'No'}</li>
                </ul>
            </div>
            <div class="detail-section">
                <div class="detail-title">Accesibilidad y Ética</div>
                <ul>
                    <li>Acceso abierto: ${result.accessibility.hasOpenAccess ? 'Sí' : 'No'}</li>
                    <li>Aprobación ética: ${result.accessibility.hasEthicsApproval ? 'Sí' : 'No'}</li>
                    <li>Conflictos de interés: ${result.accessibility.hasConflicts ? 'Sí' : 'No'}</li>
                </ul>
            </div>
        `;
        
        detailsContainer.innerHTML = detailsHTML;
    }

    exportResults() {
        // Preparar datos para exportación
        const exportData = this.results.map(result => ({
            'Archivo': result.filename,
            'Puntuación Global': result.globalScore || 'Error',
            'Veredicto': result.verdict || 'Error',
            'Metodología': result.globalScore ? this.calculateDimensionScore(result.methodology).replace(/<[^>]*>/g, '') : 'Error',
            'Calidad Reporte': result.globalScore ? this.calculateDimensionScore(result.reportingQuality).replace(/<[^>]*>/g, '') : 'Error',
            'Transparencia': result.globalScore ? this.calculateDimensionScore(result.transparency).replace(/<[^>]*>/g, '') : 'Error',
            'Rigor Científico': result.globalScore ? this.calculateDimensionScore(result.rigor).replace(/<[^>]*>/g, '') : 'Error',
            'Relevancia': result.globalScore ? this.calculateDimensionScore(result.relevance).replace(/<[^>]*>/g, '') : 'Error',
            'Presentación': result.globalScore ? this.calculateDimensionScore(result.presentation).replace(/<[^>]*>/g, '') : 'Error',
            'Accesibilidad': result.globalScore ? this.calculateDimensionScore(result.accessibility).replace(/<[^>]*>/g, '') : 'Error'
        }));

        // Crear libro de Excel
        const wb = XLSX.utils.book_new();
        const ws = XLSX.utils.json_to_sheet(exportData);
        XLSX.utils.book_append_sheet(wb, ws, "Resultados");

        // Guardar archivo
        XLSX.writeFile(wb, "resultados_analisis.xlsx");
    }
}

// Inicializar la aplicación cuando el DOM esté cargado
document.addEventListener('DOMContentLoaded', () => {
    console.log('DOM cargado, inicializando aplicación');
    window.analyzer = new ScientificArticleAnalyzer();
});
