package com.queryeer.backend.transport.stdio;

import java.util.List;
import java.util.function.Function;
import java.util.stream.Collectors;

import com.queryeer.backend.api.ChangelogRegistry;
import com.queryeer.backend.api.PluginDescriptor;
import com.queryeer.backend.contract.BackendEnvelope;
import com.queryeer.backend.contract.EnvelopeType;
import com.queryeer.backend.contract.ProtocolVersion;
import com.queryeer.backend.contract.about.PluginChangelogsResult;
import com.queryeer.backend.contract.about.PluginChangelogsResult.BackendPluginChangelog;

final class AboutPluginChangelogsRequestHandler implements RequestHandler
{
    private final ResponseWriter responseWriter;
    private final ChangelogRegistry changelogRegistry;
    private final Function<String, PluginDescriptor> descriptorLookup;

    AboutPluginChangelogsRequestHandler(ResponseWriter responseWriter, ChangelogRegistry changelogRegistry, Function<String, PluginDescriptor> descriptorLookup)
    {
        this.responseWriter = responseWriter;
        this.changelogRegistry = changelogRegistry;
        this.descriptorLookup = descriptorLookup;
    }

    @Override
    public String method()
    {
        return "about.pluginChangelogs";
    }

    @Override
    public void handle(BackendEnvelope envelope)
    {
        List<BackendPluginChangelog> plugins = changelogRegistry.pluginIds()
                .stream()
                .map(pluginId ->
                {
                    PluginDescriptor descriptor = descriptorLookup.apply(pluginId);
                    String name = descriptor != null ? descriptor.name()
                            : pluginId;
                    String version = descriptor != null ? descriptor.version()
                            : "unknown";
                    return new BackendPluginChangelog(pluginId, name, version, changelogRegistry.getChangelog(pluginId));
                })
                .collect(Collectors.toList());

        PluginChangelogsResult result = new PluginChangelogsResult(plugins);

        responseWriter.write(new BackendEnvelope(ProtocolVersion.V1_0_0, EnvelopeType.RESPONSE, envelope.id(), null, null, null, result, null));
    }
}
