package com.queryeer.backend.core.engine;

import java.util.Map;

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

    public EngineInvokeService(QueryEngineRegistry engineRegistry)
    {
        this.engineRegistry = engineRegistry;
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
            throw new EngineInvokeException(BackendErrorCode.INTERNAL, ErrorMessages.buildFailureMessage(e), ErrorMessages.buildErrorDetails(e), e);
        }
    }

    public static final class EngineInvokeException extends RuntimeException
    {
        private final BackendErrorCode code;
        private final Map<String, Object> details;

        EngineInvokeException(BackendErrorCode code, String message)
        {
            super(message);
            this.code = code;
            this.details = null;
        }

        EngineInvokeException(BackendErrorCode code, String message, Throwable cause)
        {
            super(message, cause);
            this.code = code;
            this.details = null;
        }

        EngineInvokeException(BackendErrorCode code, String message, Map<String, Object> details, Throwable cause)
        {
            super(message, cause);
            this.code = code;
            this.details = details;
        }

        public BackendErrorCode code()
        {
            return code;
        }

        public Map<String, Object> details()
        {
            return details;
        }
    }
}
