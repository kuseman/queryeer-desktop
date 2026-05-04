package com.queryeer.backend.contract.settings;

public record SettingsModuleChangedNotification(String moduleId, long version)
{
}
