---
type: C4 Component
title: Otel
status: stable
groma:
  id: otel
  parent: shared-libraries
  code:
    - scanner: typescript
      file: packages/shared/src/telemetry/otel.ts
    - scanner: typescript
      file: packages/shared/src/telemetry/events.ts
    - scanner: typescript
      file: packages/shared/src/telemetry/index.ts
    - scanner: typescript
      file: packages/shared/src/telemetry/posthog.ts
  technology: OpenTelemetry
description: Sends buffered OTLP/HTTP JSON spans fire-and-forget, swallowing failures so tracing never blocks the app.
---
