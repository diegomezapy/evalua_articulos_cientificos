# Operativo de cinco revisores y 270 artículos únicos

## Diseño adoptado

La aplicación reutiliza la separación del repositorio original entre visor PDF,
formulario, backend de Apps Script y persistencia en Google Sheets. La nueva
variante se encuentra en `apps_script_5x62/` y no altera el ensayo anterior.

| Componente | Cantidad |
|---|---:|
| Seudónimos | Revisor 1 a Revisor 5 |
| Asignaciones por revisor | 62 |
| Casos exclusivos por revisor | 52 |
| Casos comunes a los cinco | 10 |
| Evaluaciones totales | 310 |
| Artículos únicos | 270 |

La identidad seudonimizada se maneja internamente como `REVISOR-1` a
`REVISOR-5`. Cada persona recibe su identificador, código privado y enlace
preconfigurado.

## Resolución del marco de 270 artículos

Las tres banderas del corpus producen 270 incidencias brutas:

- 241 casos de incertidumbre IA;
- 26 casos de identidad no congruente;
- 3 casos sin vínculo con la base de diseño.

El artículo `W7165046962` pertenece simultáneamente a las dos últimas
categorías. Por ello, la unión observada contiene 269 artículos únicos. Para
cumplir literalmente el mínimo de 270, el generador incorpora un control
adicional reproducible, con identidad automática congruente, presencia en el
diseño y PDF disponible. La reserva administrativa identifica ese control y no
lo revela a los revisores.

## Distribución

Los 260 casos no comunes se reparten en cinco lotes de 52, equilibrando gran
área y año. Los diez casos comunes se agregan a cada lote y se intercalan a lo
largo de la secuencia. País no se utiliza como segmento.

La identidad contable es:

```text
270 artículos únicos = (5 × 52 exclusivos) + 10 comunes
310 evaluaciones      = (5 × 52 exclusivos) + (5 × 10 comunes)
```

## Instrumento

Cada evaluación registra identidad del PDF, vínculo empírico con Sudamérica,
país o territorio estudiado, carácter muestral, unidad observada, tamaño de
muestra, mecanismo de selección, reconocimiento de limitaciones, extrapolación,
páginas de evidencia, evidencia textual breve, justificación y confianza.

## Controles de la aplicación

- acceso mediante seudónimo y código individual;
- autorregistro del estadístico en el primer acceso, con aceptación expresa y
  captura de nombre, correo Google, institución, país, especialidad y ORCID
  opcional;
- habilitación automática de una carpeta privada con los 62 PDF del lote una
  vez aceptada la participación;
- visualización exclusiva del lote asignado;
- decisiones IA y juicios ajenos fuera de la aplicación;
- guardado de borradores y bloqueo de registros finales;
- validación de pertenencia de cada asignación en el servidor;
- bloqueo de escritura concurrente y bitácora de versiones;
- panel administrativo de avance;
- acuerdo por pares y kappa de Fleiss sobre los diez casos comunes;
- exportación consolidada de las 310 asignaciones.
- credenciales recuperables e invitaciones en hojas ocultas de una planilla
  administrativa no compartida, con hashes de acceso en propiedades del script;
- autoprueba del administrador para verificar cinco accesos y la integridad del
  diseño sin exponer códigos en los registros de ejecución.

## Generación reproducible

```bash
python3 scripts/build_review_5x62.py \
  --results RUTA/resultados_prevalencia_ia_2262.csv \
  --inventory RUTA/inventario_auditabilidad_pdf_2262_final.csv \
  --design RUTA/base_diseno_minima_prevalencias_ia_2262.csv \
  --output RUTA_LOCAL/revision_humana_5x62_2026 \
  --copy-pdfs
```

La semilla predeterminada es `20260806`. Los PDF y el manifiesto que contiene
las decisiones IA deben mantenerse fuera de Git. La carpeta maestra permanece
privada. La preparación crea cinco lotes de 62 PDF, con copias independientes de
los diez casos comunes, y comparte el lote solamente después de que la persona
registre su correo Google y acepte participar.
