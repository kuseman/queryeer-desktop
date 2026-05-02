# ClassLoader Hierarchy Refactoring Plan

Status: proposed and approved — implementation pending

Date: 2026-05-04

## Goal

Streamline the backend classloader hierarchy to provide uniform isolation for all plugins (builtin and external), eliminate the fragile reflective `URLClassLoader.addURL()` hack, and give each JDBC dialect a fail-safe helper for registering its driver class.

## Current Problems

| # | Problem | Location |
|---|---|---|
| 1 | Reflective `addURL()` injection of libShared JARs into AppLoader — fragile, JDK-version-dependent, breaks when AppLoader is not a `URLClassLoader` (JDK 9+) | `BackendRunnerModule.java:166–180` |
| 2 | No dedicated SharedLoader tier — JDBC driver JARs share the AppLoader namespace, defeating isolation between plugins and shared libraries | `BackendRunnerModule.java:47–49` |
| 3 | Builtin plugins run on AppLoader directly (`isolatedClassLoader=false`); external plugins get `ParentAwarePluginClassLoader` with AppLoader as parent — inconsistent isolation model | `BuiltinPluginDiscovery.java:21–29` vs `ManifestBackendPluginResolver.java:30` |
| 4 | `ServiceLoaderJdbcDialectDiscovery` relies on `Thread.currentThread().getContextClassLoader()` — unreliable TCCL | `ServiceLoaderJdbcDialectDiscovery.java:14–15` |
| 5 | No thread context classloader management during JDBC driver/connection operations | (absent) |
| 6 | `DriverManager.isDriverAllowed` works by accident (reflective injection puts drivers in AppLoader) — will break with a properly tiered hierarchy unless addressed | `BackendRunnerModule.java:156–195` |

## Target ClassLoader Hierarchy

```
Platform/Bootstrap ClassLoader (JVM)
 └── App ClassLoader
      ├── backend-api                        ← Contracts: BackendPlugin, BackendPluginContext, etc.
      ├── backend-contract                   ← Protocol DTOs: BackendEnvelope, QueryExecuteParams, etc.
      ├── backend-core                       ← In-memory services, PluginRuntime, BackendPlatformServices
      ├── backend-transport-stdio            ← Stdio NDJSON transport
      ├── backend-runner                     ← Bootstrap, orchestration, classloader factory
      ├── backend-lib-queryengine-jdbc-foundation  ← JDBC abstractions, JdbcDriverLoader helper
      └── SharedClassLoader                  ← libShared/*.jar (JDBC drivers: mssql, postgres, mysql, etc.)
           ├── PluginCL: query.jdbc          ← backend-plugin-jdbc + its deps
           ├── PluginCL: query.payloadbuilder ← backend-plugin-payloadbuilder + its deps
           ├── PluginCL: query.payloadbuilder.jdbc ← backend-plugin-queryengine-payloadbuilder-jdbc + deps
           ├── PluginCL: dialect.mssql       ← backend-plugin-dialect-sqlserver + its deps
           └── PluginCL: <external>          ← External plugins from plugins path
```

### Delegation rules

- **Parent-first** for API/contract/system packages: `com.queryeer.backend.api.*`, `com.queryeer.backend.contract.*`, `java.*`, `javax.*`, `jdk.*`, `sun.*`
- **Child-first** for everything else (plugin-internal classes loaded from plugin's own URLs first, then fall back to parent)

### Why `isDriverAllowed` works

When a plugin (e.g., the JDBC plugin or a dialect) calls `DriverManager.getConnection()`, the caller's classloader is its PluginCL. `DriverManager.isDriverAllowed` does `Class.forName(driverClassName, true, callerPluginCL)`. PluginCL delegates to SharedLoader → finds the driver class → same `Class<?>` instance → returns `true`.

## Design Decisions (from discussion)

| Decision | Rationale |
|---|---|
| Builtins get PluginCLs like external plugins | Uniform isolation; no special-casing; `isDriverAllowed` works consistently |
| `SharedClassLoader` is a pure classloader, no business logic | Separation of concerns; driver registration owned by dialects |
| Driver registration helper lives in `backend-lib-queryengine-jdbc-foundation` | Accessible to all dialects; fail-safe dual-path approach (`Class.forName` + reflective fallback) |
| Dialect declares its driver class name via `JdbcDialectMetadata.driverClassName` | Each dialect knows its own driver; no guessing |
| Dialect plugins directly call `registry.register()` during `activate()`, not cross-classloader ServiceLoader | Cross-classloader ServiceLoader doesn't work with isolated PluginCLs; direct registration is explicit and testable |
| TCCL set/restore around ServiceLoader/discovery operations | Per user preference; predictable classloader context during dialect discovery |
| Logical separation only (no separate CoreLoader) | AppLoader holds core + contracts + runner + foundation; sufficient for current needs |
| No driver-required-at-startup policy | Users download drivers into `libShared/` themselves; missing drivers cause connection-time errors, not startup crashes |

## Files to Create

| File | Purpose |
|---|---|
| `backend-runner/src/main/java/com/queryeer/backend/runner/SharedClassLoader.java` | Pure `URLClassLoader` wrapping libShared/*.jar; parent = AppLoader; no business logic |
| `backend-lib-queryengine-jdbc-foundation/src/main/java/com/queryeer/backend/queryengine/jdbc/JdbcDriverLoader.java` | Fail-safe static helper: `Class.forName` first, then reflective `Driver` instantiation + `DriverManager.registerDriver()` |
| `backend-runner/src/test/java/com/queryeer/backend/runner/SharedClassLoaderTest.java` | Tests SharedLoader delegation and driver class visibility |
| `backend-lib-queryengine-jdbc-foundation/src/test/java/com/queryeer/backend/queryengine/jdbc/JdbcDriverLoaderTest.java` | Tests both loading paths and failure modes |

## Files to Modify

### 1. `backend-lib-queryengine-jdbc-foundation/src/main/java/com/queryeer/backend/queryengine/jdbc/JdbcDialectMetadata.java`

Add `driverClassName` field to record.

Before:
```java
public record JdbcDialectMetadata(String id, String displayName, Integer defaultPort, String jdbcUrlTemplate) {}
```

After:
```java
public record JdbcDialectMetadata(
    String id,
    String displayName,
    Integer defaultPort,
    String jdbcUrlTemplate,
    String driverClassName
) {}
```

`driverClassName` is nullable — dialects that don't need explicit driver registration (e.g., H2 which is bundled) leave it `null`.

---

### 2. `backend-plugin-dialect-sqlserver/src/main/java/com/queryeer/backend/plugin/jdbc/sqlserver/SqlServerDialect.java`

Add driver class name to metadata:

```java
@Override
public JdbcDialectMetadata metadata() {
    return new JdbcDialectMetadata(
        DIALECT_ID,
        "Microsoft SQL Server",
        1433,
        "jdbc:sqlserver://<host>:<port>;databaseName=<database>",
        "com.microsoft.sqlserver.jdbc.SQLServerDriver"
    );
}
```

---

### 3. `backend-plugin-dialect-sqlserver/src/main/java/com/queryeer/backend/plugin/jdbc/sqlserver/SqlServerDialectContributor.java`

Call `JdbcDriverLoader.loadDriver()` during `contribute()`:

```java
public final class SqlServerDialectContributor implements JdbcDialectContributor {
    @Override
    public void contribute(JdbcDialectRegistry registry) {
        ClassLoader pluginCL = getClass().getClassLoader();
        JdbcDriverLoader.loadDriver("com.microsoft.sqlserver.jdbc.SQLServerDriver", pluginCL);
        registry.register(new SqlServerDialect());
    }
}
```

Note: `loadDriver` returns `false` if driver not found — this is normal when the user hasn't placed the driver JAR in `libShared/`. The dialect still registers; connection attempts will fail at runtime with a clear SQLException.

---

### 4. `backend-runner/src/main/java/com/queryeer/backend/runner/PluginClasspathFactory.java` → Rename to `PluginClassLoaderFactory.java`

- Rename class
- Constructor takes `SharedClassLoader` instead of passing `ClassLoader parent` per-call
- `createClassLoader(Path source, PluginManifest manifest)` uses `sharedLoader` as parent
- Inner `ParentAwarePluginClassLoader` unchanged

```java
package com.queryeer.backend.runner;

import java.io.IOException;
import java.net.URL;
import java.net.URLClassLoader;
import java.nio.charset.StandardCharsets;
import java.nio.file.DirectoryStream;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.List;

final class PluginClassLoaderFactory {
    private static final List<String> PARENT_FIRST_PREFIXES = List.of(
        "java.", "javax.", "jdk.", "sun.",
        "com.queryeer.backend.api.", "com.queryeer.backend.contract.");

    private final SharedClassLoader sharedLoader;

    PluginClassLoaderFactory(SharedClassLoader sharedLoader) {
        this.sharedLoader = sharedLoader;
    }

    URLClassLoader createClassLoader(Path source, PluginManifest manifest) {
        List<URL> urls = new ArrayList<>();
        try {
            if (manifest.backend() != null
                    && manifest.backend().classpath() != null) {
                buildManifestClasspath(source, manifest.backend().classpath(), urls);
                return new ParentAwarePluginClassLoader(urls.toArray(URL[]::new), sharedLoader);
            }

            if (Files.isDirectory(source)) {
                urls.add(source.toUri().toURL());
                Path libDir = source.resolve("lib");
                if (Files.exists(libDir) && Files.isDirectory(libDir)) {
                    try (DirectoryStream<Path> stream = Files.newDirectoryStream(libDir, "*.jar")) {
                        for (Path jar : stream) {
                            urls.add(jar.toUri().toURL());
                        }
                    }
                }
            } else {
                urls.add(source.toUri().toURL());
            }
        } catch (IOException e) {
            throw new PluginDiscoveryException(
                "Failed to build classpath for plugin source: " + source, e);
        }

        return new ParentAwarePluginClassLoader(urls.toArray(URL[]::new), sharedLoader);
    }

    // buildManifestClasspath, addClasspathEntry, addClasspathEntriesFromList,
    // addGlobEntries, containsGlob — unchanged from current PluginClasspathFactory

    private static final class ParentAwarePluginClassLoader extends URLClassLoader {
        ParentAwarePluginClassLoader(URL[] urls, ClassLoader parent) {
            super(urls, parent);
        }

        @Override
        protected Class<?> loadClass(String name, boolean resolve)
                throws ClassNotFoundException {
            synchronized (getClassLoadingLock(name)) {
                Class<?> loaded = findLoadedClass(name);
                if (loaded == null) {
                    loaded = loadClassInternal(name);
                }
                if (resolve) {
                    resolveClass(loaded);
                }
                return loaded;
            }
        }

        private Class<?> loadClassInternal(String name) throws ClassNotFoundException {
            if (isParentFirst(name)) {
                return super.loadClass(name, false);
            }
            try {
                return findClass(name);
            } catch (ClassNotFoundException ignored) {
                return super.loadClass(name, false);
            }
        }

        private boolean isParentFirst(String name) {
            return PARENT_FIRST_PREFIXES.stream().anyMatch(name::startsWith);
        }
    }
}
```

---

### 5. `backend-runner/src/main/java/com/queryeer/backend/runner/BuiltinPluginDiscovery.java`

- Accept `PluginClassLoaderFactory` + `Path builtinsDir` in constructor
- Create `PluginCL` for each builtin using the factory
- Set `isolatedClassLoader=true`, `classLoaderResource=classLoader`

```java
package com.queryeer.backend.runner;

import java.nio.file.Path;
import java.util.List;

import com.queryeer.backend.api.PluginHostServices;

final class BuiltinPluginDiscovery {
    private final PluginFactory pluginFactory;
    private final PluginHostServices hostServices;
    private final PluginClassLoaderFactory classLoaderFactory;
    private final Path builtinsDir;

    BuiltinPluginDiscovery(PluginFactory pluginFactory,
                           PluginHostServices hostServices,
                           PluginClassLoaderFactory classLoaderFactory,
                           Path builtinsDir) {
        this.pluginFactory = pluginFactory;
        this.hostServices = hostServices;
        this.classLoaderFactory = classLoaderFactory;
        this.builtinsDir = builtinsDir;
    }

    List<DiscoveredPlugin> discover() {
        return builtinManifests().stream()
                .map(manifest -> {
                    Path source = builtinsDir.resolve(manifest.id());
                    // Allow source to be missing if the builtin directory hasn't
                    // been assembled yet — the classloader creation handles this
                    // via PluginDiscoveryException if classpath is truly broken
                    java.net.URLClassLoader classLoader =
                        classLoaderFactory.createClassLoader(source, manifest);
                    return new DiscoveredPlugin(manifest,
                        new PluginManifestBackedPlugin(manifest,
                            pluginFactory.instantiate(manifest, classLoader, source, hostServices)),
                        source, true, classLoader);
                })
                .toList();
    }

    private List<PluginManifest> builtinManifests() {
        return List.of(
            new PluginManifest(1, "query.payloadbuilder", "Payloadbuilder Query Engine", "0.1.0",
                new PluginManifest.BackendTarget(
                    "com.queryeer.backend.plugin.payloadbuilder.PayloadbuilderBackendPlugin",
                    null, null, "17"),
                null, List.of(),
                List.of("queryengine.execute", "engine.invoke",
                    "queryengine.payloadbuilder.catalog"),
                List.of(), null, null),
            new PluginManifest(1, "query.jdbc", "JDBC Query Engine", "0.1.0",
                new PluginManifest.BackendTarget(
                    "com.queryeer.backend.plugin.jdbc.JdbcBackendPlugin",
                    null, null, "17"),
                null, List.of(),
                List.of("queryengine.execute", "queryengine.jdbc.connection"),
                List.of(), null, null),
            new PluginManifest(1, "query.payloadbuilder.jdbc",
                "Payloadbuilder JDBC Bridge", "0.1.0",
                new PluginManifest.BackendTarget(
                    "com.queryeer.backend.plugin.queryengine.payloadbuilder.jdbc.PayloadbuilderJdbcBackendPlugin",
                    null, null, "17"),
                null, List.of("query.payloadbuilder", "query.jdbc"),
                List.of("queryengine.payloadbuilder.jdbc.bridge"),
                List.of("queryengine.payloadbuilder.catalog",
                    "queryengine.jdbc.connection"),
                null, null));
    }
}
```

---

### 6. `backend-runner/src/main/java/com/queryeer/backend/runner/ManifestBackendPluginResolver.java`

- Constructor takes `PluginClassLoaderFactory` (was `PluginClasspathFactory`)
- `resolve()` calls `classLoaderFactory.createClassLoader(source, manifest)` — no longer passes `BackendRunnerApp.class.getClassLoader()`

```java
package com.queryeer.backend.runner;

import java.net.URLClassLoader;
import java.nio.file.Path;
import java.util.Optional;

import com.queryeer.backend.api.PluginHostServices;

final class ManifestBackendPluginResolver implements BackendPluginResolver {
    private final PluginClassLoaderFactory classLoaderFactory;
    private final PluginFactory pluginFactory;
    private final PluginHostServices hostServices;

    ManifestBackendPluginResolver(PluginClassLoaderFactory classLoaderFactory,
                                  PluginFactory pluginFactory,
                                  PluginHostServices hostServices) {
        this.classLoaderFactory = classLoaderFactory;
        this.pluginFactory = pluginFactory;
        this.hostServices = hostServices;
    }

    @Override
    public Optional<DiscoveredPlugin> resolve(PluginManifest manifest, Path source) {
        if (manifest.backend() == null) {
            return Optional.empty();
        }

        URLClassLoader classLoader = classLoaderFactory.createClassLoader(source, manifest);
        return Optional.of(new DiscoveredPlugin(manifest,
            new PluginManifestBackedPlugin(manifest,
                pluginFactory.instantiate(manifest, classLoader, source, hostServices)),
            source, true, classLoader));
    }
}
```

---

### 7. `backend-runner/src/main/java/com/queryeer/backend/runner/PluginDiscoveryService.java`

- Constructor accepts `PluginClassLoaderFactory`
- Wires it to `ManifestBackendPluginResolver`

```java
final class PluginDiscoveryService {
    private final PluginSourceExplorer sourceExplorer;
    private final PluginManifestLoader manifestLoader;
    private final BackendPluginResolver backendResolver;
    private final FrontendPluginResolver frontendResolver;

    PluginDiscoveryService(ObjectMapper objectMapper,
                           PluginHostServices hostServices,
                           PluginClassLoaderFactory classLoaderFactory) {
        this.sourceExplorer = new PluginSourceExplorer();
        this.manifestLoader = new PluginManifestLoader(objectMapper);
        this.backendResolver = new ManifestBackendPluginResolver(
            classLoaderFactory, new PluginFactory(), hostServices);
        this.frontendResolver = new ManifestFrontendPluginResolver();
    }

    // discoverFromPath — unchanged
}
```

---

### 8. `backend-runner/src/main/java/com/queryeer/backend/runner/BackendRunnerModule.java`

- Remove `registerSharedJdbcDrivers()` method entirely
- Create `SharedClassLoader` at bootstrap
- Create `PluginClassLoaderFactory` with `sharedLoader`
- Wire through discovery chain
- Resolve builtins directory
- Close `sharedLoader` LAST during cleanup

Key changes to `run()` method:

```java
public int run(InputStream input, OutputStream output) {
    int exitCode = 0;
    Map<String, String> config = resolveConfigValues();

    ClassLoader appClassLoader = BackendRunnerModule.class.getClassLoader();
    List<URL> sharedLibUrls = SharedLibraryLoader.collect(
        config.get("queryeer.app.dir"));

    // ── Create shared classloader for JDBC drivers ──
    SharedClassLoader sharedLoader = new SharedClassLoader(sharedLibUrls, appClassLoader);
    PluginClassLoaderFactory classLoaderFactory =
        new PluginClassLoaderFactory(sharedLoader);

    // ── Resolve builtin plugins directory ──
    String appDir = config.getOrDefault("queryeer.app.dir", ".");
    Path builtinsDir = Path.of(appDir, "plugins", "builtin");

    BackendPlatformServices services = BackendPlatformServices.defaultServices(config);
    ObjectMapper objectMapper = new ObjectMapper();
    objectMapper.registerModule(new JavaTimeModule());
    objectMapper.disable(SerializationFeature.WRITE_DATES_AS_TIMESTAMPS);
    PluginDiscoveryService discoveryService =
        new PluginDiscoveryService(objectMapper, services, classLoaderFactory);

    // ── Plugin discovery ──
    PluginFactory pluginFactory = new PluginFactory();
    PluginDiscoveryPlan discoveryPlan = PluginDiscoveryPlan.of(
        resolveDiscoveryMode(), resolvePluginPath());
    PluginDiscoveryMode mode = discoveryPlan.effectiveMode();

    PluginRuntime runtime = new PluginRuntime();
    List<DiscoveredPlugin> discoveredPlugins;
    try {
        if (mode == PluginDiscoveryMode.BUILTIN) {
            discoveredPlugins = new BuiltinPluginDiscovery(
                pluginFactory, services, classLoaderFactory, builtinsDir).discover();
        } else if (mode == PluginDiscoveryMode.EXTERNAL) {
            String path = discoveryPlan.requiredPathFor(PluginDiscoveryMode.EXTERNAL);
            discoveredPlugins = discoveryService.discoverFromPath(path).backendPlugins();
        } else {
            String path = discoveryPlan.requiredPathFor(PluginDiscoveryMode.MIXED);
            List<DiscoveredPlugin> builtin = new BuiltinPluginDiscovery(
                pluginFactory, services, classLoaderFactory, builtinsDir).discover();
            List<DiscoveredPlugin> external =
                discoveryService.discoverFromPath(path).backendPlugins();
            discoveredPlugins = mergeDiscoveredPlugins(builtin, external);
        }
        for (DiscoveredPlugin discovered : discoveredPlugins) {
            runtime.register(discovered.plugin());
        }
    } catch (Exception e) {
        services.logger().error(
            withCorrelation("Failed to discover/register backend plugins", null), e);
        throw e;
    }

    // ── Activate all plugins ──
    try {
        runtime.activateAll(services.pluginContext());
        logRuntimeSummary(services, runtime, discoveredPlugins);
    } catch (Exception e) {
        throw new IllegalStateException("Failed to activate backend plugins", e);
    }

    // ... transport setup, self-destruct, main loop — unchanged ...

    // ── Cleanup: plugin CLs first, sharedLoader last ──
    finally {
        selfDestruct.interrupt();
        try { runtime.deactivateAll(); }
        catch (Exception e) {
            exitCode = 1;
            services.logger().error(
                withCorrelation("Failed to deactivate backend plugins", null), e);
        }
        PluginResourceCloser.closeAll(discoveredPlugins, sharedLoader, services.logger());
    }
    return exitCode;
}
```

Remove the now-deleted `registerSharedJdbcDrivers()` method (lines 155–195 in current file).

---

### 9. `backend-runner/src/main/java/com/queryeer/backend/runner/PluginResourceCloser.java`

Rename method, accept `SharedClassLoader`, close it last:

```java
final class PluginResourceCloser {
    private PluginResourceCloser() {}

    static void closeAll(List<DiscoveredPlugin> plugins,
                         SharedClassLoader sharedLoader,
                         LoggerService logger) {
        // Close plugin classloaders first
        for (DiscoveredPlugin plugin : plugins) {
            AutoCloseable resource = plugin.classLoaderResource();
            if (resource == null) continue;
            try { resource.close(); }
            catch (Exception e) {
                logger.error("Failed to close plugin classloader for "
                    + plugin.manifest().id(), e);
            }
        }
        // Close shared loader last
        try { sharedLoader.close(); }
        catch (Exception e) {
            logger.error("Failed to close shared classloader", e);
        }
    }
}
```

---

### 10. `backend-plugin-jdbc/src/main/java/com/queryeer/backend/plugin/jdbc/ServiceLoaderJdbcDialectDiscovery.java`

Refactored: accepts explicit `ClassLoader`, sets/restores TCCL around ServiceLoader:

```java
package com.queryeer.backend.plugin.jdbc;

import java.util.ServiceLoader;

import com.queryeer.backend.api.LoggerService;
import com.queryeer.backend.queryengine.jdbc.JdbcDialectContributor;
import com.queryeer.backend.queryengine.jdbc.JdbcDialectRegistry;

final class ServiceLoaderJdbcDialectDiscovery implements JdbcDialectDiscovery {
    private final ClassLoader dialectClassLoader;

    ServiceLoaderJdbcDialectDiscovery(ClassLoader dialectClassLoader) {
        this.dialectClassLoader = dialectClassLoader;
    }

    @Override
    public void discoverAndRegister(JdbcDialectRegistry registry, LoggerService logger) {
        Thread current = Thread.currentThread();
        ClassLoader previous = current.getContextClassLoader();
        current.setContextClassLoader(dialectClassLoader);
        try {
            ServiceLoader<JdbcDialectContributor> contributors =
                ServiceLoader.load(JdbcDialectContributor.class, dialectClassLoader);

            java.util.Iterator<JdbcDialectContributor> it = contributors.iterator();
            while (true) {
                JdbcDialectContributor contributor;
                try {
                    if (!it.hasNext()) break;
                    contributor = it.next();
                } catch (java.util.ServiceConfigurationError e) {
                    logger.warn("Failed to load JDBC dialect contributor (skipping): "
                        + e.getMessage());
                    continue;
                }
                try {
                    contributor.contribute(registry);
                    logger.info("Registered JDBC dialect contributor: "
                        + contributor.getClass().getName());
                } catch (IllegalArgumentException e) {
                    if (e.getMessage() != null
                            && e.getMessage().startsWith("dialect already registered:")) {
                        logger.warn("Skipped JDBC dialect contributor (duplicate): "
                            + contributor.getClass().getName());
                        continue;
                    }
                    throw e;
                } catch (Throwable t) {
                    logger.warn("JDBC dialect contributor threw error (skipping): "
                        + contributor.getClass().getName() + " — " + t);
                }
            }
        } finally {
            current.setContextClassLoader(previous);
        }
    }
}
```

The `dialectClassLoader` is the JDBC plugin's own PluginCL when called from within the JDBC plugin. Since dialects now register directly during `activate()`, this ServiceLoader scan is a supplementary mechanism for discovering contributors on the JDBC plugin's own classpath.

---

### 11. `backend-runner/pom.xml`

Change builtin plugin dependencies from `compile` to `provided`:

```xml
<dependency>
    <groupId>com.queryeer.backend</groupId>
    <artifactId>backend-plugin-jdbc</artifactId>
    <version>${project.version}</version>
    <scope>provided</scope>   <!-- was: compile -->
</dependency>
<dependency>
    <groupId>com.queryeer.backend</groupId>
    <artifactId>backend-plugin-payloadbuilder</artifactId>
    <version>${project.version}</version>
    <scope>provided</scope>
</dependency>
<dependency>
    <groupId>com.queryeer.backend</groupId>
    <artifactId>backend-plugin-dialect-sqlserver</artifactId>
    <version>${project.version}</version>
    <scope>provided</scope>
</dependency>
<dependency>
    <groupId>com.queryeer.backend</groupId>
    <artifactId>backend-plugin-queryengine-payloadbuilder-jdbc</artifactId>
    <version>${project.version}</version>
    <scope>provided</scope>
</dependency>
```

Add `maven-assembly-plugin` configuration to copy builtin plugin JARs and their transitive dependencies into `target/plugins/builtin/<pluginId>/lib/` during the `package` phase. See [Assembly Configuration](#assembly-configuration) below.

---

### 12. `backend-plugin-jdbc/pom.xml`

Change foundation library to `provided` (it's on AppLoader, not duplicated per plugin):

```xml
<dependency>
    <groupId>com.queryeer.backend</groupId>
    <artifactId>backend-lib-queryengine-jdbc-foundation</artifactId>
    <version>${project.version}</version>
    <scope>provided</scope>   <!-- was: compile -->
</dependency>
```

Same for `backend-plugin-dialect-sqlserver/pom.xml`, `backend-plugin-payloadbuilder/pom.xml`, etc. — any builtin plugin that depends on modules that will be on AppLoader (api, contract, foundation) should use `provided`.

---

### 13. Module POMs for builtin plugins that use `JdbcDialectContributor`

Dialects that use ServiceLoader for dialect discovery need `META-INF/services/com.queryeer.backend.queryengine.jdbc.JdbcDialectContributor` files. These are already present. No change needed to the service files themselves.

---

## Assembly Configuration

The Maven assembly plugin copies builtin plugin JARs into the expected runtime directory layout so `BuiltinPluginDiscovery` can create classloaders from them.

### Directory layout produced by assembly

```
target/
  plugins/
    builtin/
      query.jdbc/
        lib/
          backend-plugin-jdbc-0.1.0-SNAPSHOT.jar
          h2-2.2.224.jar
          jackson-databind-2.18.2.jar
          (transitive deps excluding api/contract/foundation)
      query.payloadbuilder/
        lib/
          backend-plugin-payloadbuilder-0.1.0-SNAPSHOT.jar
          payloadbuilder-core-1.10.1.jar
          payloadbuilder-catalog-1.10.1.jar
          (transitive deps excluding api/contract)
      dialect.mssql/
        lib/
          backend-plugin-dialect-sqlserver-0.1.0-SNAPSHOT.jar
          (transitive deps excluding api/contract/foundation)
      query.payloadbuilder.jdbc/
        lib/
          backend-plugin-queryengine-payloadbuilder-jdbc-0.1.0-SNAPSHOT.jar
          (transitive deps excluding api/contract/foundation)
```

### Assembly descriptor: `backend-runner/src/assembly/builtin-plugins.xml`

```xml
<assembly xmlns="http://maven.apache.org/ASSEMBLY/2.2.0"
          xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"
          xsi:schemaLocation="http://maven.apache.org/ASSEMBLY/2.2.0
            http://maven.apache.org/xsd/assembly-2.2.0.xsd">
    <id>builtin-plugins</id>
    <formats>
        <format>dir</format>
    </formats>
    <includeBaseDirectory>false</includeBaseDirectory>

    <moduleSets>
        <moduleSet>
            <useAllReactorProjects>true</useAllReactorProjects>
            <includes>
                <include>com.queryeer.backend:backend-plugin-jdbc</include>
            </includes>
            <binaries>
                <outputDirectory>plugins/builtin/query.jdbc/lib</outputDirectory>
                <unpack>false</unpack>
                <excludes>
                    <exclude>com.queryeer.backend:backend-api</exclude>
                    <exclude>com.queryeer.backend:backend-contract</exclude>
                    <exclude>com.queryeer.backend:backend-lib-queryengine-jdbc-foundation</exclude>
                </excludes>
            </binaries>
        </moduleSet>
        <!-- Repeat for each builtin plugin module -->
    </moduleSets>
</assembly>
```

---

## Test Plan

### Unit tests

| # | Test file | What it verifies |
|---|---|---|
| 1 | `JdbcDriverLoaderTest.java` | `loadDriver` with valid driver: `Class.forName` path triggers `DriverManager` registration. Fallback to reflective `Driver` instantiation when `Class.forName` throws `ExceptionInInitializerError`. Returns `false` when driver class not found. Returns `false` on `LinkageError`. |
| 2 | `SharedClassLoaderTest.java` | libShared JAR URLs loaded. Delegates `com.queryeer.backend.api.*` types to parent (AppLoader). Can load driver classes from libShared JARs. |
| 3 | `PluginClassLoaderFactoryTest.java` (updated) | Parent of created PluginCL is `SharedClassLoader`. API types resolved from AppLoader via delegation. Plugin-internal types loaded child-first. JDBC driver classes resolvable via SharedLoader delegation. |
| 4 | `BuiltinPluginDiscoveryTest.java` (new) | Each builtin gets a PluginCL with `SharedLoader` as parent. `isolatedClassLoader=true`. `classLoaderResource` is non-null and closeable. Instantiated plugin is assignable to `BackendPlugin`. |
| 5 | `PluginResourceCloserTest.java` (updated) | Plugin classloaders closed before `SharedClassLoader`. Plugins with null classloader resource ignored. Exceptions during close are logged, not thrown. |

### Integration test

| # | Test | What it verifies |
|---|---|---|
| 6 | `BackendRunnerModule` with `queryeer.plugins.mode=BUILTIN` | All builtins activate successfully. JDBC plugin registers its dialect registry. Dialects register themselves (including driver loading attempt). No `ClassNotFoundException` for API/contract types. No reflective `addURL` in startup path. No startup crash from missing driver JARs. |

---

## Files NOT Changing (this session)

| File | Reason |
|---|---|
| `backend-contract/**` | No protocol DTO changes |
| `backend-api/**` (except possibly adding JdbcDialectRegistry accessor) | ClassLoader is internal concern |
| `backend-core/**` | No core service changes needed |
| `backend-transport-stdio/**` | Transport is independent of classloader hierarchy |
| `src/contracts/backend/**` (TypeScript) | No protocol changes |
| `BACKEND_PROTOCOL.md` | No protocol changes |
| `DiscoveredPlugin.java` | Record shape unchanged — already has `classLoaderResource` |
| `PluginFactory.java` | Already accepts any `ClassLoader` — no change needed |
| `PluginManifest.java` | Manifest shape unchanged |
| `SharedLibraryLoader.java` | Still collects libShared JAR URLs — used by SharedClassLoader |
| `connection/*` contracts and connection pool files | Pool handling deferred per user |
| All `.java` files in `backend-plugin-payloadbuilder/` | No driver loading needed (Payloadbuilder is not JDBC) |

---

## Migration order (execution sequence)

1. **Create `SharedClassLoader.java`** — minimal class, no dependencies on other changes
2. **Rename `PluginClasspathFactory` → `PluginClassLoaderFactory`** — update parent reference to SharedClassLoader
3. **Update `BackendRunnerModule.java`** — remove reflective hack, create SharedLoader, wire factory
4. **Update `PluginDiscoveryService.java`** — accept PluginClassLoaderFactory
5. **Update `ManifestBackendPluginResolver.java`** — accept PluginClassLoaderFactory
6. **Update `BuiltinPluginDiscovery.java`** — accept PluginClassLoaderFactory + builtinsDir, create PluginCLs
7. **Update `PluginResourceCloser.java`** — closeAll with SharedLoader last
8. **Create `JdbcDriverLoader.java`** — static helper in foundation module
9. **Update `JdbcDialectMetadata.java`** — add `driverClassName` field
10. **Update `SqlServerDialect.java`** — add driver class name
11. **Update `SqlServerDialectContributor.java`** — call JdbcDriverLoader.loadDriver
12. **Update `ServiceLoaderJdbcDialectDiscovery.java`** — explicit ClassLoader, TCCL set/restore
13. **Update POM files** — `provided` scope, assembly plugin
14. **Write tests** — JdbcDriverLoaderTest, SharedClassLoaderTest, updated existing tests
15. **Integration test** — full BUILTIN mode startup

## Risks and Mitigations

| Risk | Severity | Mitigation |
|---|---|---|
| `provided` scope breaks IDE/compilation | Low | All modules still compile via reactor; IDE needs `mvn install` once |
| Builtin plugin JARs missing at runtime (assembly misconfigured) | High | Fail-fast in `BuiltinPluginDiscovery` with clear error listing expected directories |
| `isDriverAllowed` still fails on some JDK versions | Low | Verified delegation chain: PluginCL → SharedLoader → AppLoader resolves driver; add targeted integration test |
| Dialect ServiceLoader picks up wrong classloader | Medium | Explicit ClassLoader parameter; TCCL set/restore around ServiceLoader |
| `Class.forName` triggers unwanted static init side effects | Low | `Class.forName` IS the intended mechanism for JDBC driver registration; fallback path uses `initialize=false` |
| Memory leak from unclosed classloaders | Low | `PluginResourceCloser.closeAll` runs in `finally` block; `SharedClassLoader` closed last |
