package com.queryeer.backend.core.query;

import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

import com.queryeer.backend.api.ErrorMessages;
import com.queryeer.backend.api.QueryEngineProvider;
import com.queryeer.backend.api.QueryEngineRegistry;
import com.queryeer.backend.api.QueryPublisher;
import com.queryeer.backend.api.SecuritySessionClosedException;
import com.queryeer.backend.contract.query.QueryExecuteOptions;
import com.queryeer.backend.core.security.SecretRefPayloadResolver;

public final class QueryExecutionService
{
    private final ExecutorService executor = Executors.newCachedThreadPool();
    private final Map<String, QueryEngineProvider> activeExecutions = new ConcurrentHashMap<>();
    private final QueryEngineRegistry engineRegistry;

    public QueryExecutionService(QueryEngineRegistry engineRegistry)
    {
        this.engineRegistry = engineRegistry;
    }

    public void execute(String queryExecutionId, String engineId, String fileId, String text, Object engineState, QueryPublisher publisher)
    {
        execute(queryExecutionId, engineId, fileId, text, engineState, null, publisher);
    }

    public void execute(String queryExecutionId, String engineId, String fileId, String text, Object engineState, QueryExecuteOptions options, QueryPublisher publisher)
    {
        QueryEngineProvider provider = engineRegistry.getProvider(engineId);
        if (provider == null)
        {
            publisher.failed("ENGINE_NOT_FOUND", "No engine registered for id: " + engineId);
            return;
        }

        activeExecutions.put(queryExecutionId, provider);
        executor.submit(() ->
        {
            try
            {
                provider.execute(queryExecutionId, fileId, text, engineState, options, publisher);
            }
            catch (SecuritySessionClosedException e)
            {
                publisher.failed("SECURITY_SESSION_CLOSED", e.getMessage());
            }
            catch (SecretRefPayloadResolver.SecretResolutionException e)
            {
                publisher.failed("VALIDATION", e.getMessage());
            }
            catch (Throwable e)
            {
                publisher.failed("INTERNAL", ErrorMessages.buildFailureMessage(e));
            }
            finally
            {
                activeExecutions.remove(queryExecutionId);
            }
        });
    }

    public void cancel(String queryExecutionId)
    {
        QueryEngineProvider provider = activeExecutions.get(queryExecutionId);
        if (provider != null)
        {
            provider.cancel(queryExecutionId);
        }
    }
}
