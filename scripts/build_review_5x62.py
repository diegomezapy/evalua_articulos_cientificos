#!/usr/bin/env python3
"""Construye una revisión humana ciega de cinco revisores por 62 artículos.

El diseño predeterminado asigna 52 casos exclusivos y 10 casos comunes a cada
revisor. Esto produce 310 evaluaciones sobre 270 artículos únicos y permite
estimar acuerdo interevaluador en los diez casos comunes.
"""

from __future__ import annotations

import argparse
import csv
import hashlib
import json
import logging
import math
import random
import shutil
from collections import Counter, defaultdict
from datetime import date
from pathlib import Path
from typing import Iterable, Mapping, Sequence


LOGGER = logging.getLogger("revision_5x62")
TRUE_VALUES = {"1", "true", "si", "sí", "s", "yes"}
AREA_ES = {
    "Health Sciences": "Ciencias de la Salud",
    "Life Sciences": "Ciencias de la Vida",
    "Physical Sciences": "Ciencias Físicas",
    "Social Sciences": "Ciencias Sociales",
    "": "Área no disponible",
}


def read_csv(path: Path) -> list[dict[str, str]]:
    with path.open("r", encoding="utf-8-sig", newline="") as handle:
        return [dict(row) for row in csv.DictReader(handle)]


def write_csv(path: Path, rows: Sequence[Mapping[str, object]], fields: Sequence[str]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", encoding="utf-8-sig", newline="") as handle:
        writer = csv.DictWriter(handle, fieldnames=fields, extrasaction="ignore")
        writer.writeheader()
        writer.writerows(rows)


def as_bool(value: object) -> bool:
    return str(value or "").strip().lower() in TRUE_VALUES


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for block in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(block)
    return digest.hexdigest()


def stable_case_code(work_id: str, seed: int) -> str:
    raw = f"{seed}:{work_id}".encode("utf-8")
    return "CASO-" + hashlib.sha256(raw).hexdigest()[:10].upper()


def indexed(rows: Iterable[dict[str, str]]) -> dict[str, dict[str, str]]:
    output: dict[str, dict[str, str]] = {}
    for row in rows:
        work_id = row.get("openalex_work_id", "").strip()
        if not work_id:
            raise ValueError("Se encontró una fila sin openalex_work_id")
        if work_id in output:
            continue
        output[work_id] = row
    return output


def resolve_pdf(row: Mapping[str, str]) -> Path:
    for field in ("ruta_pdf_auditoria_efectiva", "ruta_pdf_materializada"):
        raw = str(row.get(field, "")).strip()
        if raw and Path(raw).is_file():
            return Path(raw)
    raise FileNotFoundError(f"No se localizó el PDF de {row.get('openalex_work_id')}")


def build_candidates(
    results_rows: Sequence[dict[str, str]],
    inventory_rows: Sequence[dict[str, str]],
    design_rows: Sequence[dict[str, str]],
    seed: int,
) -> list[dict[str, object]]:
    results = indexed(results_rows)
    inventory = indexed(inventory_rows)
    design_ids = set(indexed(design_rows))
    candidates: list[dict[str, object]] = []
    controls: list[dict[str, object]] = []

    def candidate_record(
        work_id: str,
        result: Mapping[str, str],
        inv: Mapping[str, str],
        flags: Sequence[str],
        special: bool,
        control: bool,
    ) -> dict[str, object]:
        return {
            "openalex_work_id": work_id,
            "titulo": inv.get("titulo", ""),
            "anio": inv.get("anio", ""),
            "dominio_articulo": inv.get("dominio_articulo", ""),
            "macroarea": AREA_ES.get(
                inv.get("dominio_articulo", ""),
                inv.get("dominio_articulo", "") or "Área no disponible",
            ),
            "revista": inv.get("revista", ""),
            "doi": inv.get("doi", ""),
            "licencia": inv.get("licencia_openalex", ""),
            "ruta_pdf_origen": str(resolve_pdf(inv)),
            "sha256_esperado": (
                inv.get("sha256_pdf_auditoria_efectiva", "")
                or inv.get("sha256_materializado", "")
            ),
            "motivos_prioridad": ";".join(flags),
            "caso_especial": special,
            "es_control": control,
            "elegibilidad_ia": result.get("elegibilidad_ia", ""),
            "mecanismo_ia": result.get("mecanismo_ia", ""),
            "limitaciones_ia": result.get("limitaciones_ia", ""),
            "extrapolacion_ia": result.get("extrapolacion_ia", ""),
            "confianza_ia": result.get("confianza_ia", ""),
            "version_protocolo_ia": result.get("version_protocolo", ""),
        }

    for work_id, result in results.items():
        inv = inventory.get(work_id)
        if inv is None:
            raise ValueError(f"Falta inventario para {work_id}")
        ia_uncertain = as_bool(result.get("requiere_revision_humana"))
        identity_issue = not as_bool(inv.get("identidad_congruente_automatica"))
        design_missing = work_id not in design_ids
        flags = []
        if ia_uncertain:
            flags.append("incertidumbre_ia")
        if identity_issue:
            flags.append("identidad")
        if design_missing:
            flags.append("sin_vinculo_diseno")
        if flags:
            candidates.append(
                candidate_record(
                    work_id, result, inv, flags,
                    identity_issue or design_missing, False,
                )
            )
        elif as_bool(inv.get("identidad_congruente_automatica")) and work_id in design_ids:
            controls.append(
                candidate_record(
                    work_id, result, inv, ["control_cumplimiento_n270"], True, True,
                )
            )

    if len(candidates) != 269:
        raise AssertionError(f"La unión prioritaria esperada es 269; observada={len(candidates)}")
    if not controls:
        raise AssertionError("No existen artículos elegibles para seleccionar el control adicional")
    controls.sort(
        key=lambda row: hashlib.sha256(
            f"{seed}:control:{row['openalex_work_id']}".encode("utf-8")
        ).hexdigest()
    )
    candidates.append(controls[0])
    return candidates


def proportional_allocations(
    grouped: Mapping[tuple[str, str], Sequence[dict[str, object]]], target: int
) -> dict[tuple[str, str], int]:
    total = sum(len(rows) for rows in grouped.values())
    if target > total:
        raise ValueError(f"No se pueden seleccionar {target} casos de {total}")
    raw = {key: target * len(rows) / total for key, rows in grouped.items()}
    allocation = {key: min(len(grouped[key]), math.floor(value)) for key, value in raw.items()}
    remaining = target - sum(allocation.values())
    order = sorted(
        grouped,
        key=lambda key: (raw[key] - allocation[key], len(grouped[key]), key),
        reverse=True,
    )
    while remaining:
        progressed = False
        for key in order:
            if allocation[key] < len(grouped[key]):
                allocation[key] += 1
                remaining -= 1
                progressed = True
                if not remaining:
                    break
        if not progressed:
            raise RuntimeError("No fue posible completar la asignación proporcional")
    return allocation


def stratified_sample(
    rows: Sequence[dict[str, object]], target: int, rng: random.Random
) -> list[dict[str, object]]:
    grouped: dict[tuple[str, str], list[dict[str, object]]] = defaultdict(list)
    for row in rows:
        grouped[(str(row["dominio_articulo"]), str(row["anio"]))].append(row)
    allocations = proportional_allocations(grouped, target)
    selected: list[dict[str, object]] = []
    for key in sorted(grouped):
        group = list(grouped[key])
        rng.shuffle(group)
        selected.extend(group[: allocations[key]])
    rng.shuffle(selected)
    return selected


def select_unique_cases(
    candidates: Sequence[dict[str, object]], unique_target: int, rng: random.Random
) -> list[dict[str, object]]:
    special = [row for row in candidates if row["caso_especial"]]
    ordinary = [row for row in candidates if not row["caso_especial"]]
    if len(special) > unique_target:
        LOGGER.warning("Los casos especiales exceden el objetivo; se estratificarán")
        return stratified_sample(special, unique_target, rng)
    selected = list(special)
    selected.extend(stratified_sample(ordinary, unique_target - len(special), rng))
    rng.shuffle(selected)
    return selected


def choose_common_cases(
    selected: Sequence[dict[str, object]], common_count: int, rng: random.Random
) -> list[dict[str, object]]:
    pool = [row for row in selected if not row["caso_especial"]]
    if len(pool) < common_count:
        pool = list(selected)
    by_year: dict[str, list[dict[str, object]]] = defaultdict(list)
    for row in pool:
        by_year[str(row["anio"])].append(row)
    years = sorted(by_year)
    chosen: list[dict[str, object]] = []
    used_areas: Counter[str] = Counter()
    for year in years:
        if len(chosen) >= common_count:
            break
        year_pool = list(by_year[year])
        rng.shuffle(year_pool)
        year_pool.sort(key=lambda row: used_areas[str(row["dominio_articulo"])])
        pick = year_pool[0]
        chosen.append(pick)
        used_areas[str(pick["dominio_articulo"])] += 1
    if len(chosen) < common_count:
        remaining = [row for row in pool if row not in chosen]
        rng.shuffle(remaining)
        remaining.sort(key=lambda row: used_areas[str(row["dominio_articulo"])])
        chosen.extend(remaining[: common_count - len(chosen)])
    if len(chosen) != common_count:
        raise RuntimeError("No fue posible seleccionar los casos comunes")
    return chosen


def assign_exclusive(
    rows: Sequence[dict[str, object]],
    reviewers: Sequence[str],
    per_reviewer: int,
    rng: random.Random,
) -> dict[str, list[dict[str, object]]]:
    expected = len(reviewers) * per_reviewer
    if len(rows) != expected:
        raise ValueError(f"Se esperaban {expected} casos exclusivos y hay {len(rows)}")
    shuffled = list(rows)
    rng.shuffle(shuffled)
    shuffled.sort(key=lambda row: (str(row["dominio_articulo"]), str(row["anio"])))
    assigned = {reviewer: [] for reviewer in reviewers}
    stratum_counts: dict[str, Counter[tuple[str, str]]] = {
        reviewer: Counter() for reviewer in reviewers
    }
    for row in shuffled:
        stratum = (str(row["dominio_articulo"]), str(row["anio"]))
        eligible = [reviewer for reviewer in reviewers if len(assigned[reviewer]) < per_reviewer]
        reviewer = min(
            eligible,
            key=lambda item: (
                stratum_counts[item][stratum],
                len(assigned[item]),
                reviewers.index(item),
            ),
        )
        assigned[reviewer].append(row)
        stratum_counts[reviewer][stratum] += 1
    return assigned


def ordered_review_queue(
    exclusive: Sequence[dict[str, object]],
    common: Sequence[dict[str, object]],
    rng: random.Random,
) -> list[dict[str, object]]:
    exclusive_queue = list(exclusive)
    common_queue = list(common)
    rng.shuffle(exclusive_queue)
    rng.shuffle(common_queue)
    queue: list[dict[str, object]] = []
    if not common_queue:
        return exclusive_queue
    base_chunk, remainder = divmod(len(exclusive_queue), len(common_queue))
    cursor = 0
    for index, common_case in enumerate(common_queue):
        chunk_size = base_chunk + (1 if index < remainder else 0)
        queue.extend(exclusive_queue[cursor : cursor + chunk_size])
        cursor += chunk_size
        queue.append(common_case)
    queue.extend(exclusive_queue[cursor:])
    return queue


def build_outputs(
    candidates: Sequence[dict[str, object]],
    reviewers: Sequence[str],
    per_reviewer: int,
    common_count: int,
    seed: int,
) -> tuple[list[dict[str, object]], list[dict[str, object]], dict[str, object]]:
    exclusive_count = per_reviewer - common_count
    if exclusive_count < 1:
        raise ValueError("Los casos comunes deben ser menos que el total por revisor")
    unique_target = common_count + len(reviewers) * exclusive_count
    if unique_target > len(candidates):
        raise ValueError(f"El diseño requiere {unique_target} casos y solo hay {len(candidates)}")
    rng = random.Random(seed)
    selected = select_unique_cases(candidates, unique_target, rng)
    common = choose_common_cases(selected, common_count, rng)
    common_ids = {str(row["openalex_work_id"]) for row in common}
    exclusive_rows = [row for row in selected if str(row["openalex_work_id"]) not in common_ids]
    assignments_by_reviewer = assign_exclusive(
        exclusive_rows, reviewers, exclusive_count, rng
    )

    cases: list[dict[str, object]] = []
    by_id: dict[str, dict[str, object]] = {}
    for row in selected:
        item = dict(row)
        item["case_code"] = stable_case_code(str(row["openalex_work_id"]), seed)
        item["pdf_file_name"] = f"{item['case_code']}.pdf"
        item["es_comun"] = str(row["openalex_work_id"]) in common_ids
        cases.append(item)
        by_id[str(row["openalex_work_id"])] = item

    assignments: list[dict[str, object]] = []
    for reviewer_index, reviewer in enumerate(reviewers, 1):
        reviewer_rng = random.Random(seed + reviewer_index * 1009)
        queue = ordered_review_queue(assignments_by_reviewer[reviewer], common, reviewer_rng)
        for order, row in enumerate(queue, 1):
            case = by_id[str(row["openalex_work_id"])]
            assignments.append(
                {
                    "assignment_id": f"{reviewer}-{order:03d}",
                    "reviewer_id": reviewer,
                    "review_order": order,
                    "case_code": case["case_code"],
                    "openalex_work_id": case["openalex_work_id"],
                    "pdf_file_name": case["pdf_file_name"],
                    "titulo": case["titulo"],
                    "anio": case["anio"],
                    "macroarea": case["macroarea"],
                    "revista": case["revista"],
                    "doi": case["doi"],
                    "es_comun": case["es_comun"],
                }
            )

    summary = {
        "fecha_generacion": date.today().isoformat(),
        "semilla": seed,
        "articulos_prioritarios_union": sum(not bool(row["es_control"]) for row in candidates),
        "controles_adicionados": sum(bool(row["es_control"]) for row in candidates),
        "marco_revision_unico": len(candidates),
        "articulos_unicos_seleccionados": len(cases),
        "asignaciones_totales": len(assignments),
        "revisores": list(reviewers),
        "articulos_por_revisor": per_reviewer,
        "exclusivos_por_revisor": exclusive_count,
        "comunes_por_revisor": common_count,
        "articulos_comunes_unicos": common_count,
        "estratificacion": ["dominio_articulo", "anio"],
        "pais_como_segmento": False,
        "motivos_candidatos": dict(
            sorted(Counter(str(row["motivos_prioridad"]) for row in candidates).items())
        ),
        "seleccion_por_area": dict(
            sorted(Counter(str(row["macroarea"]) for row in cases).items())
        ),
        "seleccion_por_anio": dict(
            sorted(Counter(str(row["anio"]) for row in cases).items())
        ),
    }
    return cases, assignments, summary


def copy_selected_pdfs(cases: Sequence[dict[str, object]], output_dir: Path) -> None:
    pdf_dir = output_dir / "PDF_PRIVADOS"
    pdf_dir.mkdir(parents=True, exist_ok=True)
    for case in cases:
        source = Path(str(case["ruta_pdf_origen"]))
        source_hash = sha256_file(source)
        expected = str(case.get("sha256_esperado", "")).strip()
        if expected and source_hash != expected:
            raise ValueError(f"Hash inesperado para {case['openalex_work_id']}")
        destination = pdf_dir / str(case["pdf_file_name"])
        if not destination.exists() or sha256_file(destination) != source_hash:
            shutil.copy2(source, destination)
        if sha256_file(destination) != source_hash:
            raise IOError(f"Falló la verificación de copia para {case['openalex_work_id']}")
        case["sha256_pdf"] = source_hash
        case["bytes_pdf"] = destination.stat().st_size


def write_readme(output_dir: Path, summary: Mapping[str, object]) -> None:
    content = f"""# Paquete privado de revisión humana 5×62

Generado el {summary['fecha_generacion']} con semilla `{summary['semilla']}`.

## Diseño

- Cinco estadísticos, 62 artículos por persona.
- 52 casos exclusivos y 10 comunes por persona.
- 310 evaluaciones sobre 270 artículos únicos.
- Los diez comunes permiten calcular acuerdo interevaluador entre los cinco.
- Estratificación por gran área y año, sin país como segmento.

## Archivos

- `asignaciones_5x62.csv`: archivo que se carga en la aplicación.
- `manifiesto_admin_5x62.csv`: trazabilidad privada, incluye decisiones IA; no compartir con revisores.
- `mapeo_revisores_privado.csv`: tabla privada para registrar nombre, correo y código de cada slot.
- `resumen_diseno_5x62.json`: controles del diseño.
- `PDF_PRIVADOS/`: PDFs con nombres codificados; mantener en una carpeta privada de Drive.

## Ceguera y seguridad

Los revisores no deben recibir `manifiesto_admin_5x62.csv`. La aplicación solo
les muestra su lote y nunca expone las decisiones de IA ni los juicios ajenos.
Los PDFs no deben publicarse en GitHub. Compártalos únicamente con las cuentas
autorizadas para la revisión.
"""
    (output_dir / "README.md").write_text(content, encoding="utf-8")


def write_reviewer_protocol(output_dir: Path) -> None:
    content = """# Protocolo para revisores estadísticos

## Objetivo

Clasificar de forma independiente lo que cada PDF permite verificar sobre la
identidad del artículo, su vínculo efectivo con Sudamérica, su carácter
muestral, el mecanismo de selección, las limitaciones reconocidas y el alcance
de sus conclusiones.

## Reglas de codificación

1. **Identidad PDF:** confirme que título, DOI o contenido corresponden al
   artículo asignado.
2. **Estudio sudamericano:** marque “Sí” solo cuando las unidades observadas o
   el fenómeno empírico pertenecen efectivamente a Sudamérica. Una mención en
   antecedentes o afiliaciones no es suficiente.
3. **Estudio basado en muestra:** incluya estudios primarios que analizan un
   subconjunto de unidades y análisis secundarios de datos producidos mediante
   un diseño muestral identificable. Excluya revisiones, editoriales, ensayos y
   estudios puramente teóricos.
4. **Mecanismo:** use “Probabilístico”, “No probabilístico”, “Censo”, “No
   reportado”, “No aplica” o “Incierto”. La ausencia de descripción no demuestra
   que el mecanismo sea no probabilístico.
5. **Limitaciones:** marque “Sí” únicamente si el texto reconoce de forma
   explícita límites de selección, representatividad o generalización.
6. **Extrapolación:** marque “Sí” cuando las conclusiones se extienden a una
   población, profesión, territorio o sistema mayor que las unidades observadas.
7. **Evidencia:** registre página(s), una cita corta o paráfrasis verificable y
   una justificación suficiente para que otra persona pueda auditar el juicio.

## Independencia y ceguera

- No solicite ni consulte las decisiones de IA.
- No intercambie respuestas con los otros revisores antes del cierre.
- No intente identificar cuáles casos son comunes.
- Guarde borradores cuando necesite continuar después.
- Envíe como final solo cuando la fila esté completa; el registro quedará
  bloqueado.

## Incidencias

Si el PDF no abre, no corresponde al artículo o es ilegible, registre la
incidencia mediante los campos de identidad, evidencia y justificación, y
notifíquela al coordinador sin sustituir el archivo por cuenta propia.
"""
    (output_dir / "PROTOCOLO_REVISORES.md").write_text(content, encoding="utf-8")


def write_invitation_template(output_dir: Path, reviewers: Sequence[str]) -> None:
    blocks = []
    for reviewer in reviewers:
        reviewer_label = reviewer.replace("REVISOR-", "Revisor ")
        blocks.append(
            f"""ASUNTO: Invitación a evaluación estadística independiente de artículos

Estimado/a colega:

Le invito a participar como revisor/a estadístico/a independiente de un lote de
62 artículos científicos. El objetivo es validar criterios documentales sobre
identidad, carácter muestral, mecanismo de selección, limitaciones y alcance de
las conclusiones. La aplicación permite guardar borradores y retomar el trabajo.

Seudónimo: {reviewer_label}
Enlace: [PEGAR_URL_APP]?reviewer={reviewer}
Código privado: [PEGAR_CODIGO_{reviewer.replace('-', '_')}]
Fecha solicitada de cierre: [AAAA-MM-DD]

Antes de comenzar, lea PROTOCOLO_REVISORES.md. Le solicito trabajar de forma
independiente y no compartir respuestas con los demás revisores. Los artículos
y el acceso son exclusivamente para esta revisión.

Atentamente,
Diego Meza
"""
        )
    (output_dir / "PLANTILLAS_INVITACION.txt").write_text(
        ("\n" + "=" * 78 + "\n\n").join(blocks), encoding="utf-8"
    )


def validate_design(
    cases: Sequence[dict[str, object]],
    assignments: Sequence[dict[str, object]],
    reviewers: Sequence[str],
    per_reviewer: int,
    common_count: int,
) -> None:
    if len({str(row["case_code"]) for row in cases}) != len(cases):
        raise AssertionError("Los códigos de caso no son únicos")
    per_reviewer_counts = Counter(str(row["reviewer_id"]) for row in assignments)
    if per_reviewer_counts != Counter({reviewer: per_reviewer for reviewer in reviewers}):
        raise AssertionError(f"Asignación por revisor inválida: {per_reviewer_counts}")
    case_counts = Counter(str(row["case_code"]) for row in assignments)
    repeated = [code for code, count in case_counts.items() if count == len(reviewers)]
    invalid = {code: count for code, count in case_counts.items() if count not in (1, len(reviewers))}
    if len(repeated) != common_count or invalid:
        raise AssertionError(
            f"Superposición inválida: comunes={len(repeated)}, inválidos={invalid}"
        )
    for reviewer in reviewers:
        orders = sorted(
            int(row["review_order"])
            for row in assignments
            if row["reviewer_id"] == reviewer
        )
        if orders != list(range(1, per_reviewer + 1)):
            raise AssertionError(f"Orden incompleto para {reviewer}")


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--results", required=True, type=Path)
    parser.add_argument("--inventory", required=True, type=Path)
    parser.add_argument("--design", required=True, type=Path)
    parser.add_argument("--output", required=True, type=Path)
    parser.add_argument(
        "--reviewers",
        default="REVISOR-1,REVISOR-2,REVISOR-3,REVISOR-4,REVISOR-5",
    )
    parser.add_argument("--per-reviewer", default=62, type=int)
    parser.add_argument("--common", default=10, type=int)
    parser.add_argument("--seed", default=20260806, type=int)
    parser.add_argument("--copy-pdfs", action="store_true")
    parser.add_argument("--overwrite", action="store_true")
    return parser.parse_args()


def main() -> None:
    args = parse_args()
    logging.basicConfig(level=logging.INFO, format="%(levelname)s %(message)s")
    reviewers = tuple(part.strip().upper() for part in args.reviewers.split(",") if part.strip())
    if len(reviewers) != 5 or len(set(reviewers)) != 5:
        raise ValueError("Debe indicar exactamente cinco identificadores de revisor distintos")
    if args.output.exists() and any(args.output.iterdir()) and not args.overwrite:
        raise FileExistsError(f"La salida existe; use --overwrite: {args.output}")
    args.output.mkdir(parents=True, exist_ok=True)

    candidates = build_candidates(
        read_csv(args.results), read_csv(args.inventory), read_csv(args.design), args.seed
    )
    cases, assignments, summary = build_outputs(
        candidates, reviewers, args.per_reviewer, args.common, args.seed
    )
    if args.copy_pdfs:
        copy_selected_pdfs(cases, args.output)
    validate_design(cases, assignments, reviewers, args.per_reviewer, args.common)

    assignment_fields = [
        "assignment_id", "reviewer_id", "review_order", "case_code",
        "openalex_work_id", "pdf_file_name", "titulo", "anio", "macroarea",
        "revista", "doi", "es_comun",
    ]
    admin_fields = [
        "case_code", "openalex_work_id", "pdf_file_name", "titulo", "anio",
        "macroarea", "revista", "doi", "licencia", "motivos_prioridad",
        "es_comun", "es_control", "ruta_pdf_origen", "sha256_pdf", "bytes_pdf",
        "elegibilidad_ia", "mecanismo_ia", "limitaciones_ia",
        "extrapolacion_ia", "confianza_ia", "version_protocolo_ia",
    ]
    write_csv(args.output / "asignaciones_5x62.csv", assignments, assignment_fields)
    write_csv(args.output / "manifiesto_admin_5x62.csv", cases, admin_fields)
    write_csv(
        args.output / "mapeo_revisores_privado.csv",
        [
            {"reviewer_id": reviewer, "nombre": "", "email": "", "codigo_acceso": ""}
            for reviewer in reviewers
        ],
        ["reviewer_id", "nombre", "email", "codigo_acceso"],
    )
    (args.output / "resumen_diseno_5x62.json").write_text(
        json.dumps(summary, ensure_ascii=False, indent=2) + "\n", encoding="utf-8"
    )
    write_readme(args.output, summary)
    write_reviewer_protocol(args.output)
    write_invitation_template(args.output, reviewers)
    LOGGER.info(
        "Diseño validado: candidatos=%s, artículos=%s, asignaciones=%s, PDFs=%s",
        len(candidates), len(cases), len(assignments),
        len(cases) if args.copy_pdfs else 0,
    )


if __name__ == "__main__":
    main()
