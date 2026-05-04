package com.queryeer.backend.core.engine;

import com.queryeer.backend.api.ErrorMessages;
import com.queryeer.backend.api.QueryEngineProvider;
import com.queryeer.backend.api.QueryEngineRegistry;
import com.queryeer.backend.api.SecuritySessionClosedException;
import com.queryeer.backend.contract.BackendErrorCode;
import com.queryeer.backend.contract.engine.EngineInvokeParams;
import com.queryeer.backend.core.security.SecretRefPayloadResolver;

public final class EngineInvokeService
{
    private final QueryEngineRegistry engineRegistry;
    private final SecretRefPayloadResolver secretResolver;

    public EngineInvokeService(QueryEngineRegistry engineRegistry, SecretRefPayloadResolver secretResolver)
    {
        this.engineRegistry = engineRegistry;
        this.secretResolver = secretResolver;
    }

    public Object invoke(EngineInvokeParams params)
    {
        QueryEngineProvider provider = engineRegistry.getProvider(params.engineId());
        if (provider == null)
        {
            throw new EngineInvokeException(BackendErrorCode.ENGINE_NOT_FOUND, "No engine registered for id: " + params.engineId());
        }

        try
        {
            return provider.invoke(params.fileId(), params.action(), params.payload());
        }
        catch (SecuritySessionClosedException e)
        {
            throw new EngineInvokeException(BackendErrorCode.SECURITY_SESSION_CLOSED, e.getMessage());
        }
        catch (SecretRefPayloadResolver.SecretResolutionException e)
        {
            throw new EngineInvokeException(BackendErrorCode.VALIDATION, e.getMessage());
        }
        catch (IllegalArgumentException e)
        {
            throw new EngineInvokeException(BackendErrorCode.VALIDATION, e.getMessage());
        }
        catch (EngineInvokeException e)
        {
            throw e;
        }
        catch (Exception e)
        {
            throw new EngineInvokeException(BackendErrorCode.INTERNAL, ErrorMessages.buildFailureMessage(e));
        }
    }

    public static final class EngineInvokeException extends RuntimeException
    {
        private final BackendErrorCode code;

        EngineInvokeException(BackendErrorCode code, String message)
        {
            super(message);
            this.code = code;
        }

        public BackendErrorCode code()
        {
            return code;
        }
    }
}
