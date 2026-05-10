package com.queryeer.backend.plugin.payloadbuilder.elasticsearch;

record ElasticsearchConnection(String connectionId, String title, String endpoint, String authType, String authUsername, Object authPassword, boolean enabled)
{
}