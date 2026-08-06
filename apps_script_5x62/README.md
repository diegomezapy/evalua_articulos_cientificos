# Aplicación de revisión humana ciega 5×62

Esta aplicación adapta la arquitectura del repositorio original a un operativo
con cinco estadísticos, 62 asignaciones por persona y persistencia centralizada
en Google Sheets.

## Qué protege

- Cada revisor solo puede abrir sus 62 asignaciones.
- La aceptación de la invitación queda registrada bajo el seudónimo, sin nombre real.
- Las decisiones de IA no se cargan en la aplicación.
- Las respuestas de los otros revisores no se muestran.
- Los registros finales quedan bloqueados.
- Las credenciales se almacenan como hashes SHA-256 en las propiedades del
  proyecto, no en el código ni en la hoja.
- Todas las altas y actualizaciones quedan registradas en `auditoria`.

## Preparación privada en Drive

Use el paquete generado fuera del repositorio:

```text
revision_humana_5x62_2026/
├── asignaciones_5x62.csv
├── PDF_PRIVADOS/
├── manifiesto_admin_5x62.csv
├── PROTOCOLO_REVISORES.md
└── PLANTILLAS_INVITACION.txt
```

1. Cree una carpeta privada en Google Drive.
2. Suba los 270 archivos de `PDF_PRIVADOS/` a una única subcarpeta.
3. Comparta esa subcarpeta como lector únicamente con las cinco cuentas Google
   de los revisores. No use acceso público si no es indispensable.
4. Suba `asignaciones_5x62.csv` a Drive, también con acceso restringido.
5. No suba ni comparta `manifiesto_admin_5x62.csv`; contiene la reserva IA.

## Crear el proyecto Apps Script

Con `clasp`:

```bash
cd apps_script_5x62
clasp create --type webapp --title "revision_humana_muestras_5x62"
clasp push -f
```

También puede crear un proyecto en script.google.com y copiar `Code.gs`,
`Index.html`, `Admin.html`, `styles.html` y `appsscript.json`.

## Propiedades del script

En **Configuración del proyecto → Propiedades del script**, agregue:

| Propiedad | Valor |
|---|---|
| `R5X62_ASSIGNMENTS_CSV_FILE_ID` | ID del archivo `asignaciones_5x62.csv` |
| `R5X62_PDF_FOLDER_ID` | ID de la carpeta que contiene los 270 PDF |

Los IDs se obtienen de las URL de Drive. No se deben guardar en GitHub.

## Inicialización

1. En el editor de Apps Script, ejecute `setup_inicial()` una sola vez.
2. Autorice lectura de Drive y escritura en Sheets.
3. Copie inmediatamente el resultado y el registro de ejecución. Contienen:
   - código de administrador;
   - códigos de `REVISOR-1` a `REVISOR-5`;
   - ID de la hoja central creada.
4. Guarde los códigos en un gestor seguro. La aplicación conserva solo hashes.
5. Si pierde los códigos, ejecute `rotarCredencialesDesdeEditor()` como
   propietario desde el editor de Apps Script. La rotación invalida todos los
   códigos anteriores.

## Despliegue

Después de inicializar:

1. **Implementar → Nueva implementación → Aplicación web**.
2. Ejecutar como: **usted, propietario del proyecto**.
3. Acceso: el mínimo que permita ingresar a los cinco revisores. Si pertenecen a
   dominios diferentes, normalmente será “cualquier usuario”; los códigos de la
   aplicación seguirán siendo obligatorios.
4. Verifique que los revisores hayan iniciado sesión en Google con la cuenta a
   la que se compartieron los PDF.
5. Abra la URL y pruebe cada seudónimo con su código. La primera entrada exige
   confirmar la participación bajo el protocolo.

El panel administrativo está en:

```text
URL_DE_LA_APP?view=admin
```

## Cierre del operativo

El panel permite exportar un CSV de 310 filas, incluidas las pendientes. Para
analizar concordancia y corregir las prevalencias, combine esa exportación con
`manifiesto_admin_5x62.csv` por `case_code`, únicamente después de cerrar la
revisión y mantener la reserva fuera del alcance de los revisores.

Los diez casos comunes son evaluados por los cinco revisores y permiten calcular
acuerdo por pares y kappa de Fleiss. La estimación debe informarse con cautela
por el número reducido de casos comunes.
