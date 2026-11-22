package com.queryeer.backend.transport.stdio;

import java.util.LinkedHashMap;
import java.util.Map;

import com.queryeer.backend.contract.BackendEnvelope;
import com.queryeer.backend.contract.BackendError;
import com.queryeer.backend.contract.BackendErrorCode;
import com.queryeer.backend.contract.EnvelopeType;
import com.queryeer.backend.contract.ProtocolVersion;
import com.queryeer.backend.contract.plugin.PluginInvokeParams;
import com.queryeer.backend.contract.plugin.PluginInvokeResult;
import com.queryeer.backend.core.PluginActionService;

/** {@code plugin.invoke}: a plugin's frontend calling one of its own backend actions. */
final class PluginInvokeRequestHandler implements RequestHandler
{
    private final ResponseWriter responseWriter;
    private final EnvelopeCodec codec;
    private final PluginActionService actions;

    PluginInvokeRequestHandler(ResponseWriter responseWriter, EnvelopeCodec codec, PluginActionService actions)
    {
        this.responseWriter = responseWriter;
        this.codec = codec;
        this.actions = actions;
    }

    @Override
    public String method()
    {
        return "plugin.invoke";
    }

    @Override
    public void handle(BackendEnvelope envelope)
    {
        PluginInvokeParams params = envelope.params() == null ? new PluginInvokeParams(null, null, null)
                : codec.objectMapper()
                        .convertValue(envelope.params(), PluginInvokeParams.class);
        try
        {
            Object result = actions.invoke(params.pluginId(), params.action(), params.payload());
            try
            {
                responseWriter.write(new BackendEnvelope(ProtocolVersion.V1_0_0, EnvelopeType.RESPONSE, envelope.id(), null, null, null, new PluginInvokeResult(result), null));
            }
            catch (RuntimeException e)
            {
                // A result that can't be written as JSON: answer with an error rather than leave the caller waiting
                throw new PluginActionService.PluginActionException(BackendErrorCode.INTERNAL, "The result of backend action '" + params.action() + "' could not be sent: " + e.getMessage(), null, e);
            }
        }
        catch (PluginActionService.PluginActionException e)
        {
            Map<String, Object> details = new LinkedHashMap<>();
            details.put("pluginId", params.pluginId());
            details.put("action", params.action());
            Throwable cause = e.getCause();
            if (cause != null)
            {
                details.put("causeType", cause.getClass()
                        .getSimpleName());
                if (cause.getMessage() != null)
                {
                    details.put("causeMessage", cause.getMessage());
                }
            }
            if (e.details() != null)
            {
                details.putAll(e.details());
            }
            responseWriter.write(new BackendEnvelope(ProtocolVersion.V1_0_0, EnvelopeType.RESPONSE, envelope.id(), null, null, null, null, new BackendError(e.code(), e.getMessage(), details)));
        }
    }
}
