package com.queryeer.backend.transport.stdio;

import com.queryeer.backend.api.QueryEngineProvider;
import com.queryeer.backend.api.QueryEngineRegistry;
import com.queryeer.backend.contract.BackendErrorCode;
import com.queryeer.backend.contract.engine.EngineInvokeParams;

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
            throw new EngineInvokeException(BackendErrorCode.INTERNAL, e.getMessage() != null ? e.getMessage()
                    : e.getClass()
                            .getSimpleName());
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

        BackendErrorCode code()
        {
            return code;
        }
    }
}
