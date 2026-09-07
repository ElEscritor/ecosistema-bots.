# ecosistema-bots.
# La Biblioteca // C4ISR Command Center & Panóptico Infrastructure

Sistema avanzado de vigilancia pasiva y gestión forense para Discord, compuesto por un enjambre de selfbots operando en modo sigiloso (`stealth mode`) y un panel de control web aislado de alta fidelidad visual (estética Cyber-Abyss / C4ISR).

## 🏛️ Arquitectura del Sistema

La infraestructura opera bajo un modelo estrictamente desacoplado para evitar la correlación de tráfico y proteger a las cuentas frente a baneos por parte de las heurísticas de Discord:

* **Enjambre de Captación (Motor Local):** Múltiples cuentas exploradoras operan en segundo plano con presencia invisible. Utilizan un sistema de caché volátil en memoria RAM (`In-Memory Cache`) para almacenar contexto local de los canales sin realizar peticiones HTTP masivas a la API de Discord, evitando bloqueos por *Rate Limit* (HTTP 429).
* **Proxy Transmisor (`transmisor.js`):** Desacopla la lógica de envío de webhooks y ficheros pesados (HTML/TXT forenses) de los módulos de los bots, ofuscando el tráfico de red mediante envíos externos.
* **Panel Web Aislado (`servidor.js`):** Un servidor Express independiente que alimenta una interfaz Single Page Application (SPA) optimizada para analítica forense, gestión de base de datos y exportación de inteligencia.
* **Capa de Persistencia (MongoDB Atlas):** Almacenamiento optimizado con índices de texto y limitación vectorial mediante `$slice` para prevenir fugas de memoria (*Memory Leaks*) y desbordamientos de BSON.

## 📂 Estructura de Directorios

```text
/ecosistema-bots
 ├── index.js                  # Enrutador central del enjambre, caché local y gestor de eventos
 ├── database.js               # Conexión, índices, funciones CRUD y aislamiento OSINT para MongoDB
 ├── reglas_alertas.json       # Matriz de expresiones regulares (con anclas \b) para detección
 ├── comandos_squads.json      # Catálogo de comandos críticos de destrucción y raids
 ├── whitelist_usuarios.json   # Matriz de inmunidad absoluta para cuentas autorizadas
 ├── package.json              # Dependencias (discord.js-selfbot-v13, express, mongodb, axios)
 └── /web
      ├── panel.html           # Interfaz gráfica C4ISR (ApexCharts, DOMPurify, SPA interactiva)
      ├── servidor.js          # API RESTful y motor de enrutamiento web
      └── transmisor.js        # Proxy de ofuscación de red para Webhooks con archivos adjuntos
 └── /modulos
      ├── modulo_raids.js      # Escáner forense de alusiones a raids, doxxing e IPs
      ├── modulo_squads.js     # Interceptor de comandos críticos de escuadrones hostiles
      ├── modulo_links.js      # Auditoría de vectores de distribución de enlaces y alianzas
      └── modulo_org.js        # Radar de telemetría pasiva para menciones organizacionales

```

## 🔍 Módulos de Inteligencia y Detección

1. **modulo_raids.js**: Analiza patrones léxicos delimitados por expresiones regulares para detectar intenciones de ataques masivos, doxxing o filtración de infraestructura, integrando consultas con la API de reputación externa (CordCat).
2. **modulo_squads.js**: Intercepta la ejecución de comandos predefinidos en `comandos_squads.json`, aplicando fichajes punitivos automáticos ante comandos clasificados como `CRITICO`.
3. **modulo_links.js (LinksPortal)**: Captura invitaciones de Discord y enlaces externos provenientes de campañas de alianzas, aislando el enlace para generar tarjetas nativas y guardando el contexto del servidor emisor.
4. **modulo_org.js**: Monitoreo pasivo enfocado en la recolección de menciones de marcas o entidades clave de la organización, generando un micro-historial del diálogo sin alterar el flujo del chat.

## 📊 Panel Web: La Biblioteca (C4ISR)

La interfaz gráfica opera bajo una estética oscura de alta gama y ofrece cuatro vistas especializadas:

* **Analítica C4ISR (Dashboard):** Métricas en tiempo real con contadores animados, un gráfico de áreas temporal (ApexCharts) filtrable por periodos, y un gráfico de dona interactivo que clasifica la distribución de amenazas capturadas.
* **Expedientes OSINT:** Espacio dedicado al perfilado de identidades que combina los registros crudos interceptados con un editor de notas manuales (con autoguardado asíncrono) para inteligencia analítica.
* **LinksPortal:** Auditoría visual de alianzas y vectores de promoción externa, organizando los servidores de origen, fechas y mensajes promocionales originales.
* **Blacklist Total:** Registro central disciplinario que lista a los infractores con su nivel de reincidencia, evidencia cruda saneada mediante DOMPurify, y un botón de purga permanente. Incluye de forma exclusiva el botón para descargar la base de datos en formato JSON estándar de moderación de seguridad.

## ⚙️ Configuración y Variables de Entorno

Para desplegar la infraestructura correctamente en entornos de producción (como Render), es obligatorio configurar las siguientes variables de entorno:

* `MONGO_URI`: Cadena de conexión cifrada hacia tu clúster de MongoDB Atlas.
* `PANEL_PASSWORD`: Contraseña maestra para autenticarse en el panel web de La Biblioteca (usuario fijo: `admin`).
* `TOKEN_EXPLORADOR_1` al `TOKEN_EXPLORADOR_10`: Tokens de las cuentas de Discord configuradas como unidades de reconocimiento (selfbots).
* `WEBHOOK_Raids`, `WEBHOOK_Links`, `WEBHOOK_Org`, `WEBHOOK_Squads`: URLs de los webhooks de Discord donde el proxy transmisor despachará las alertas forenses.
