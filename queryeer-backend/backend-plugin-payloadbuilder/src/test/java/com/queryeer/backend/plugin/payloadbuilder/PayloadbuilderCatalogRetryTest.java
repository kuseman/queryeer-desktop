package com.queryeer.backend.plugin.payloadbuilder;

import java.util.ArrayList;
import java.util.List;
import java.util.Map;

import org.junit.jupiter.api.Assertions;
import org.junit.jupiter.api.Test;
import org.mockito.Mockito;

import com.queryeer.backend.api.ConfigService;
import com.queryeer.backend.api.OutputEvent;
import com.queryeer.backend.api.PayloadMapper;
import com.queryeer.backend.api.QueryPublisher;
import com.queryeer.backend.api.SecuritySessionClosedException;
import com.queryeer.backend.api.parse.IncrementalParseFunction;
import com.queryeer.backend.api.parse.IncrementalParseSessionService;
import com.queryeer.backend.core.JacksonPayloadMapper;
import com.queryeer.backend.queryengine.payloadbuilder.PayloadbuilderCatalogProviderContributor;
import com.queryeer.backend.queryengine.payloadbuilder.PayloadbuilderCatalogRetry;

import se.kuseman.payloadbuilder.api.QualifiedName;
import se.kuseman.payloadbuilder.api.catalog.Catalog;
import se.kuseman.payloadbuilder.api.catalog.CatalogException;
import se.kuseman.payloadbuilder.api.catalog.Column;
import se.kuseman.payloadbuilder.api.catalog.DatasourceData;
import se.kuseman.payloadbuilder.api.catalog.IDatasource;
import se.kuseman.payloadbuilder.api.catalog.ResolvedType;
import se.kuseman.payloadbuilder.api.catalog.Schema;
import se.kuseman.payloadbuilder.api.catalog.TableSchema;
import se.kuseman.payloadbuilder.api.execution.IExecutionContext;
import se.kuseman.payloadbuilder.api.execution.IQuerySession;
import se.kuseman.payloadbuilder.api.execution.ObjectTupleVector;
import se.kuseman.payloadbuilder.api.execution.TupleIterator;
import se.kuseman.payloadbuilder.api.execution.ValueVector;

/** Running a query again when a catalog asks for it after a failure ({@link PayloadbuilderCatalogProviderContributor#retryAfterFailure}). */
class PayloadbuilderCatalogRetryTest
{
    private static final ConfigService NOOP_CONFIG = _ -> null;
    private static final PayloadMapper TEST_MAPPER = new JacksonPayloadMapper();
    private static final IncrementalParseSessionService PARSE_SESSIONS = Mockito.mock(IncrementalParseSessionService.class);
    private static final IncrementalParseFunction PARSE_FUNCTION = Mockito.mock(IncrementalParseFunction.class);

    @Test
    void runsAgainWithWhatTheCatalogAsksForAndPatchesThePanel()
    {
        CredentialsProvider catalog = new CredentialsProvider(new PayloadbuilderCatalogRetry(Map.of("connectionId", "right"), "Switched to connection 'right'"));
        TestPublisher publisher = new TestPublisher();

        provider(catalog).execute("exec-retry", "file-retry", "select value from items", engineState("wrong"), publisher);

        Assertions.assertNull(publisher.errorMessage, publisher.errorMessage);
        Assertions.assertEquals(List.of(List.of("right")), publisher.rows);
        Assertions.assertEquals(1, catalog.retryCalls);
        Assertions.assertEquals("cred", catalog.lastAlias);
        Assertions.assertEquals(Map.of("connectionId", "wrong"), catalog.lastInputProperties);
        Assertions.assertEquals(Map.of("connectionId", "right"), catalogPatch(publisher.engineState));
        Assertions.assertTrue(publisher.messages.contains("Switched to connection 'right'"), publisher.messages.toString());
        Assertions.assertEquals(1, publisher.resultSets, "The failed run published nothing");
    }

    @Test
    void findsTheCatalogExceptionAmongTheCauses()
    {
        CredentialsProvider catalog = new CredentialsProvider(new PayloadbuilderCatalogRetry(Map.of("connectionId", "right"), null));
        catalog.wrapException = true;
        TestPublisher publisher = new TestPublisher();

        provider(catalog).execute("exec-wrapped", "file-wrapped", "select value from items", engineState("wrong"), publisher);

        Assertions.assertNull(publisher.errorMessage, publisher.errorMessage);
        Assertions.assertEquals(List.of(List.of("right")), publisher.rows);
        Assertions.assertEquals(1, catalog.retryCalls);
    }

    @Test
    void runsAgainOnlyOnce()
    {
        // The catalog keeps asking, but its suggestion doesn't help
        CredentialsProvider catalog = new CredentialsProvider(new PayloadbuilderCatalogRetry(Map.of("connectionId", "also-wrong"), null));
        TestPublisher publisher = new TestPublisher();

        provider(catalog).execute("exec-once", "file-once", "select value from items", engineState("wrong"), publisher);

        Assertions.assertEquals("INTERNAL", publisher.errorCode);
        Assertions.assertTrue(publisher.errorMessage.contains("Invalid username/password"), publisher.errorMessage);
        Assertions.assertEquals(1, catalog.retryCalls);
        // The panel still takes the catalog's change: it's what the query needs, even though it didn't help this time
        Assertions.assertEquals(Map.of("connectionId", "also-wrong"), catalogPatch(engineStateOf(publisher.errorDetails)));
        Assertions.assertTrue(publisher.errorMessage.endsWith("\nCatalog 'cred' was changed to match the query."), publisher.errorMessage);
    }

    @Test
    void doesntRepeatATempTableTheFailedRunCreated()
    {
        // A second "select ... into #t" would fail with "already exists", hiding the real error
        CredentialsProvider catalog = new CredentialsProvider(new PayloadbuilderCatalogRetry(Map.of("connectionId", "right"), null));
        TestPublisher publisher = new TestPublisher();

        provider(catalog).execute("exec-temp", "file-temp", "select 1 x into #t; select value from items", engineState("wrong"), publisher);

        Assertions.assertEquals("INTERNAL", publisher.errorCode);
        Assertions.assertTrue(publisher.errorMessage.contains("Invalid username/password"), publisher.errorMessage);
        Assertions.assertTrue(publisher.errorMessage.endsWith("Catalog 'cred' was changed to match the query: run it again."), publisher.errorMessage);
        Assertions.assertEquals(Map.of("connectionId", "right"), catalogPatch(engineStateOf(publisher.errorDetails)));
        Assertions.assertEquals(0, publisher.resultSets);
    }

    @Test
    void runsAgainAfterSettingAVariable()
    {
        // A query's variables belong to its run, not to the session, so the rerun starts from the same values
        CredentialsProvider catalog = new CredentialsProvider(new PayloadbuilderCatalogRetry(Map.of("connectionId", "right"), null));
        TestPublisher publisher = new TestPublisher();

        provider(catalog).execute("exec-variable", "file-variable", "set @counter = 1; select value from items", engineState("wrong"), publisher);

        Assertions.assertNull(publisher.errorMessage, publisher.errorMessage);
        Assertions.assertEquals(List.of(List.of("right")), publisher.rows);
    }

    @Test
    void matchesTheAliasWhateverItsCase()
    {
        CredentialsProvider catalog = new CredentialsProvider(new PayloadbuilderCatalogRetry(Map.of("connectionId", "right"), null));
        catalog.upperCaseAlias = true;
        TestPublisher publisher = new TestPublisher();

        provider(catalog).execute("exec-case", "file-case", "select value from items", engineState("wrong"), publisher);

        Assertions.assertNull(publisher.errorMessage, publisher.errorMessage);
        Assertions.assertEquals("cred", catalog.lastAlias);
        Assertions.assertEquals(Map.of("connectionId", "right"), catalogPatch(publisher.engineState));
    }

    @Test
    void aLockedVaultInTheRetryAsksToUnlockIt()
    {
        CredentialsProvider catalog = new CredentialsProvider(null);
        catalog.vaultLockedInRetry = true;

        Assertions.assertThrows(SecuritySessionClosedException.class,
                () -> provider(catalog).execute("exec-vault", "file-vault", "select value from items", engineState("wrong"), new TestPublisher()));
    }

    @Test
    void aRetryCanClearAPropertyAndAddsToAnImmutablePatch()
    {
        Map<String, Object> clearIndex = new java.util.HashMap<>();
        clearIndex.put("connectionId", "right");
        clearIndex.put("index", null);
        CredentialsProvider catalog = new CredentialsProvider(new PayloadbuilderCatalogRetry(clearIndex, null));
        // A provider whose own patch is immutable, and reports something else
        catalog.ownPatch = Map.of("database", "sales");
        TestPublisher publisher = new TestPublisher();

        provider(catalog).execute("exec-merge", "file-merge", "select value from items", engineState("wrong"), publisher);

        Assertions.assertNull(publisher.errorMessage, publisher.errorMessage);
        Map<String, Object> expected = new java.util.HashMap<>(clearIndex);
        expected.put("database", "sales");
        Assertions.assertEquals(expected, catalogPatch(publisher.engineState));
    }

    @Test
    void failsWithThePatchInsteadOfShowingResultsTwice()
    {
        CredentialsProvider catalog = new CredentialsProvider(new PayloadbuilderCatalogRetry(Map.of("connectionId", "right"), null));
        TestPublisher publisher = new TestPublisher();

        // The first statement's result set is out before the second fails
        provider(catalog).execute("exec-published", "file-published", "select 1 x; select value from items", engineState("wrong"), publisher);

        Assertions.assertEquals("INTERNAL", publisher.errorCode);
        Assertions.assertTrue(publisher.errorMessage.contains("Catalog 'cred' was changed to match the query: run it again."), publisher.errorMessage);
        Assertions.assertEquals(Map.of("connectionId", "right"), catalogPatch(engineStateOf(publisher.errorDetails)));
        Assertions.assertEquals(1, publisher.resultSets);
        Assertions.assertEquals(1, catalog.retryCalls);
    }

    @Test
    void failsAsBeforeWhenTheCatalogDoesntAskOrThrows()
    {
        CredentialsProvider declines = new CredentialsProvider(null);
        TestPublisher declined = new TestPublisher();
        provider(declines).execute("exec-declined", "file-declined", "select value from items", engineState("wrong"), declined);

        Assertions.assertEquals("INTERNAL", declined.errorCode);
        Assertions.assertTrue(declined.errorMessage.contains("Invalid username/password"), declined.errorMessage);
        Assertions.assertEquals(1, declines.retryCalls);
        Assertions.assertNull(engineStateOf(declined.errorDetails));

        CredentialsProvider throwing = new CredentialsProvider(null);
        throwing.throwFromRetry = true;
        TestPublisher thrown = new TestPublisher();
        provider(throwing).execute("exec-thrown", "file-thrown", "select value from items", engineState("wrong"), thrown);

        Assertions.assertEquals("INTERNAL", thrown.errorCode);
        Assertions.assertTrue(thrown.errorMessage.contains("Invalid username/password"), thrown.errorMessage);
        Assertions.assertNull(engineStateOf(thrown.errorDetails));
    }

    @Test
    void theRightConnectionNeedsNoRetry()
    {
        CredentialsProvider catalog = new CredentialsProvider(new PayloadbuilderCatalogRetry(Map.of("connectionId", "right"), null));
        TestPublisher publisher = new TestPublisher();

        provider(catalog).execute("exec-right", "file-right", "select value from items", engineState("right"), publisher);

        Assertions.assertNull(publisher.errorMessage, publisher.errorMessage);
        Assertions.assertEquals(List.of(List.of("right")), publisher.rows);
        Assertions.assertEquals(0, catalog.retryCalls);
        Assertions.assertEquals(Map.of(), catalogPatch(publisher.engineState));
    }

    private static PayloadbuilderQueryEngineProvider provider(CredentialsProvider catalog)
    {
        PayloadbuilderCatalogProviderRegistry registry = PayloadbuilderCatalogProviderRegistry.defaults();
        registry.registerContributor(catalog);
        return new PayloadbuilderQueryEngineProvider(NOOP_CONFIG, TEST_MAPPER, registry, PARSE_SESSIONS, PARSE_FUNCTION);
    }

    private static Map<String, Object> engineState(String connectionId)
    {
        return Map.of("payloadbuilder",
                Map.of("defaultCatalogAlias", "cred", "catalogs", Map.of("cred", Map.of("catalogId", CredentialsCatalog.CATALOG_ID, "properties", Map.of("connectionId", connectionId)))));
    }

    private static Object engineStateOf(Map<String, Object> details)
    {
        return details == null ? null
                : details.get("engineState");
    }

    /** The properties the patch sets for the catalog alias "cred", empty for none. */
    private static Map<?, ?> catalogPatch(Object engineState)
    {
        Assertions.assertTrue(engineState instanceof Map<?, ?>, "Expected an engine state patch");
        Object payloadbuilder = ((Map<?, ?>) engineState).get("payloadbuilder");
        Object catalogs = payloadbuilder instanceof Map<?, ?> map ? map.get("catalogs")
                : null;
        Object instance = catalogs instanceof Map<?, ?> map ? map.get("cred")
                : null;
        Object properties = instance instanceof Map<?, ?> map ? map.get("properties")
                : null;
        return properties instanceof Map<?, ?> map ? map
                : Map.of();
    }

    /** A catalog whose table answers only when the injected secret is "right", as an endpoint answers only the right credentials. */
    private static final class CredentialsCatalog extends Catalog
    {
        private static final String CATALOG_ID = "test.credentials";
        private static final Schema ITEMS_SCHEMA = Schema.of(Column.of("value", ResolvedType.STRING));
        private final CredentialsProvider provider;

        CredentialsCatalog(CredentialsProvider provider)
        {
            super(CATALOG_ID);
            this.provider = provider;
        }

        @Override
        public TableSchema getTableSchema(IExecutionContext context, String catalogAlias, QualifiedName table)
        {
            return new TableSchema(ITEMS_SCHEMA);
        }

        @Override
        public IDatasource getScanDataSource(IQuerySession session, String catalogAlias, QualifiedName table, DatasourceData data)
        {
            return _ ->
            {
                ValueVector secret = session.getCatalogProperty(catalogAlias, "secret");
                String value = secret == null
                        || secret.isNull(0) ? null
                                : secret.valueAsString(0);
                if (!"right".equals(value))
                {
                    String alias = provider.upperCaseAlias ? catalogAlias.toUpperCase()
                            : catalogAlias;
                    CatalogException failure = new CatalogException(alias, "Invalid username/password in catalog properties for " + alias);
                    throw provider.wrapException ? new IllegalStateException("Request failed", failure)
                            : failure;
                }
                return TupleIterator.singleton(new ObjectTupleVector(ITEMS_SCHEMA, 1, (_, _) -> value));
            };
        }
    }

    /** Injects connection "right" or "wrong" as a secret, and answers a failure with {@code retry}. */
    private static final class CredentialsProvider implements PayloadbuilderCatalogProviderContributor
    {
        private final PayloadbuilderCatalogRetry retry;
        private boolean wrapException;
        private boolean throwFromRetry;
        private boolean upperCaseAlias;
        private boolean vaultLockedInRetry;
        private Map<String, Object> ownPatch;
        private int retryCalls;
        private String lastAlias;
        private Map<String, Object> lastInputProperties;

        CredentialsProvider(PayloadbuilderCatalogRetry retry)
        {
            this.retry = retry;
        }

        @Override
        public String catalogId()
        {
            return CredentialsCatalog.CATALOG_ID;
        }

        @Override
        public Catalog createCatalog()
        {
            return new CredentialsCatalog(this);
        }

        @Override
        public void injectProperties(IQuerySession session, String alias, Map<String, Object> properties)
        {
            session.setCatalogProperty(alias, "secret", (Object) properties.get("connectionId"));
        }

        @Override
        public void clearProperties(IQuerySession session, String alias, Map<String, Object> inputProperties)
        {
            session.setCatalogProperty(alias, "secret", (Object) null);
            session.setCatalogProperty(alias, "connectionId", (Object) null);
        }

        @Override
        public PayloadbuilderCatalogRetry retryAfterFailure(IQuerySession session, String alias, Map<String, Object> inputProperties, CatalogException exception)
        {
            retryCalls++;
            lastAlias = alias;
            lastInputProperties = inputProperties;
            if (throwFromRetry)
            {
                throw new IllegalStateException("Broken retry");
            }
            if (vaultLockedInRetry)
            {
                throw new SecuritySessionClosedException("The vault is locked");
            }
            return retry;
        }

        @Override
        public Map<String, Object> buildCatalogPatch(IQuerySession session, String alias, Map<String, Object> inputProperties)
        {
            return ownPatch != null ? ownPatch
                    : PayloadbuilderCatalogProviderContributor.compareInputProperties(session, alias, inputProperties);
        }
    }

    private static final class TestPublisher implements QueryPublisher
    {
        private final List<List<Object>> rows = new ArrayList<>();
        private final List<String> messages = new ArrayList<>();
        private int resultSets;
        private String errorCode;
        private String errorMessage;
        private Map<String, Object> errorDetails;
        private Object engineState;

        @Override
        public void progress(int percent, String message)
        {
        }

        @Override
        public void resultSetStart(List<String> columnNames, List<String> columnTypes)
        {
            resultSets++;
        }

        @Override
        public void resultSetRows(List<List<Object>> rows)
        {
            this.rows.addAll(rows);
        }

        @Override
        public void resultSetRows(List<List<Object>> rows, List<OutputEvent> messages)
        {
            this.rows.addAll(rows);
            if (messages != null)
            {
                messages.forEach(message -> this.messages.add(message.message()));
            }
        }

        @Override
        public void completed(long durationMs, long rowCount)
        {
        }

        @Override
        public void completed(long durationMs, long rowCount, Object engineState)
        {
            this.engineState = engineState;
        }

        @Override
        public void failed(String errorCode, String errorMessage)
        {
            failed(errorCode, errorMessage, null);
        }

        @Override
        public void failed(String errorCode, String errorMessage, Map<String, Object> details)
        {
            this.errorCode = errorCode;
            this.errorMessage = errorMessage;
            this.errorDetails = details;
        }
    }
}
