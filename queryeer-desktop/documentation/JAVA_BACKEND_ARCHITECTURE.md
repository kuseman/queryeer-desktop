# Java Backend Architecture (Standalone + Plugin SPI)

This document defines how the Java backend should be structured so it can be developed and released independently from Electron while still honoring a strict backend contract.

Status: architecture draft.

## 1. Design goals

- Java backend is a standalone Maven project with its own lifecycle.
- Backend plugins use a stable SPI and explicit injected services.
- Transport and process hosting are implementation details, not domain concerns.
- Plugin loading and capability checks mirror Electron plugin runtime behavior.

## 2. Repository and build model

Recommended structure (can start in same git repo, with clear boundaries):

```text
queryeer-backend/
  pom.xml                     (reactor)
  backend-api/
  backend-contract/
  backend-core/
  backend-transport-stdio/
  backend-runner/
  backend-plugin-payloadbuilder/
  backend-plugin-jdbc/
```

### 2.1 Development modes

- **Standalone mode**: run backend locally (`mvn -pl backend-runner exec:java`) without Electron.
- **Embedded process mode**: Electron `backend.gateway` starts backend runner as child process.
- **Test mode**: backend core + in-memory transport for fast contract tests.

## 3. Module responsibilities

## 3.1 `backend-api` (public SPI)

Contains plugin-facing abstractions only:

- `BackendPlugin`
- `BackendPluginContext`
- registry interfaces (`QueryEngineRegistry`, `MetadataRegistry`, ...)
- service interfaces (`ConfigService`, `SecretService`, `LoggerService`, ...)
- plugin metadata/capability descriptors

Must not depend on transport, process, or implementation frameworks.

## 3.2 `backend-contract`

Contains protocol DTOs and shared message models:

- request/response envelopes
- notification payloads
- error models and codes
- handshake and capability models

Should align 1:1 with `queryeer-desktop/documentation/BACKEND_PROTOCOL.md`.

## 3.3 `backend-core`

Contains application/use-case orchestration and plugin runtime:

- plugin discovery/registration
- dependency and capability validation
- service wiring to plugin context
- query execution orchestration
- cancellation routing and lifecycle state

## 3.4 `backend-transport-stdio`

Adapter layer that maps NDJSON/JSON-RPC envelopes to core use-cases.

- parse/validate input envelopes
- dispatch methods to `backend-core`
- serialize responses/notifications
- map exceptions to protocol errors

## 3.5 `backend-runner`

Executable entrypoint:

- bootstrap service registry
- load configured backend plugins
- start stdio transport server
- expose health/handshake

## 3.6 `backend-plugin-*`

Feature plugins implementing backend-api SPI:

- `backend-plugin-payloadbuilder`
- `backend-plugin-jdbc`
- future engine and metadata providers

## 4. Plugin SPI (Java)

The backend plugin contract should be explicit and framework-agnostic.

```java
public interface BackendPlugin {
    PluginDescriptor descriptor();
    void activate(BackendPluginContext context) throws Exception;
    default void deactivate() throws Exception {}
}
```

```java
public interface BackendPluginContext {
    LoggerService logger();
    ConfigService config();
    SecretService secrets();
    QueryEngineRegistry queryEngines();
    MetadataRegistry metadata();
    EventBus events();
    SchedulerService scheduler();
}
```

## 4.1 Plugin descriptor

To avoid manifest/runtime drift, plugin metadata ownership is split explicitly:

- `plugin.json` (manifest) is the source of truth for:
  - `id`, `name`, `version`
  - `dependencies` (plugin ids)
  - `providesCapabilities`
  - `requiredCapabilities`
- `PluginDescriptor` is runtime-facing and should not re-declare manifest metadata.
  - keep runtime-specific information only, or remove descriptor metadata fields over time.

Core validates plugin graph at startup using manifest-backed metadata:

- duplicate ids
- missing dependencies
- cycles
- missing required capabilities

During transition, if both manifest and descriptor expose overlapping metadata, runtime should fail fast on mismatch.

## 5. Service injection rules

- Plugins receive services only via `BackendPluginContext`.
- Plugins must not read global static singletons.
- Credentials/secrets go through `SecretService` boundary only.
- Plugin registries are the only way to register engines/providers.

This keeps plugin behavior deterministic and testable.

## 6. Transport isolation rules

- `backend-core` must not know about stdio, JSON, or Electron.
- `backend-transport-stdio` must not contain business logic.
- `backend-contract` is transport payload schema, not domain logic.

## 7. Alignment with Electron gateway

Electron main process (`backend.gateway`) talks only protocol envelopes.

- startup: `backend.handshake`
- liveness: `health.ping`
- execution: `queryengine.execute` + notifications
- cancellation: `queryengine.cancel`

Java runner is the protocol server, plugins remain transport-agnostic.

## 8. Testing strategy

- **Contract tests**: golden JSON fixtures shared between TS and Java.
- **Plugin runtime tests**: dependency/capability validation and activation order.
- **Use-case tests**: execute/cancel flows without transport.
- **Transport tests**: malformed envelope/error mapping.

## 9. Incremental implementation sequence

1. Create `queryeer-backend` reactor and empty modules.
2. Define `backend-api` SPI and `PluginDescriptor`.
3. Implement `backend-core` plugin runtime and validation.
4. Implement `backend-contract` DTOs matching current protocol draft.
5. Implement `backend-transport-stdio` for handshake + ping.
6. Add mock query engine plugin for execute/cancel scaffolding.
7. Add real payloadbuilder plugin, then JDBC plugin.

## 10. Open decisions to finalize early

- Java serialization stack (`Jackson` strongly recommended for DTO parity).
- plugin packaging/discovery mechanism (ServiceLoader vs explicit classpath scan).
- configuration source hierarchy (env/system/file) and override rules.
- plugin compatibility policy across backend versions.
