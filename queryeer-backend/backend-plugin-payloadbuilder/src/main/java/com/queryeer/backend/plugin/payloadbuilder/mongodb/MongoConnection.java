package com.queryeer.backend.plugin.payloadbuilder.mongodb;

record MongoConnection(String connectionId, String title, String connectionString, String authUsername, Object authPassword, String authDatabase, Boolean enabled)
{
    boolean isEnabled()
    {
        return !Boolean.FALSE.equals(enabled);
    }
}
