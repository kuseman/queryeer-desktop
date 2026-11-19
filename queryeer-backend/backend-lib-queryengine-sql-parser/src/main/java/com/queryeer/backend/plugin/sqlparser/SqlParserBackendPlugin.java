package com.queryeer.backend.plugin.sqlparser;

import com.queryeer.backend.api.BackendPlugin;
import com.queryeer.backend.api.BackendPluginContext;
import com.queryeer.backend.api.PluginDescriptor;

/**
 * The built-in plugin {@code queryengine.sql.parser}. It registers nothing: it exists so the SQL parser has one owner that bundles it, with tree-sitter, and exports its API
 * ({@code com.queryeer.backend.queryengine.sql.parser.}) to the plugins that declare a dependency on it.
 */
public final class SqlParserBackendPlugin implements BackendPlugin
{
    @Override
    public void activate(BackendPluginContext context, PluginDescriptor descriptor)
    {
    }
}
