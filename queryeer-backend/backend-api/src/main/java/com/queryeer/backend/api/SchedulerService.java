package com.queryeer.backend.api;

public interface SchedulerService
{
    void schedule(String name, Runnable task);
}
