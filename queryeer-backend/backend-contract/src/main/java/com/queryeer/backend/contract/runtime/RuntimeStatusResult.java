package com.queryeer.backend.contract.runtime;

import java.util.List;

public record RuntimeStatusResult(String startedAt, List<RuntimePluginStatus> pluginStatuses, List<String> activatedPluginIds, List<String> providedCapabilities)
{
}
