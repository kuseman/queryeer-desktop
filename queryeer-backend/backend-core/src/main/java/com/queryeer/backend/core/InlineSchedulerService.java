package com.queryeer.backend.core;

import com.queryeer.backend.api.LoggerService;
import com.queryeer.backend.api.SchedulerService;

final class InlineSchedulerService implements SchedulerService
{
    private final LoggerService logger;

    public InlineSchedulerService(LoggerService logger)
    {
        this.logger = logger;
    }

    @Override
    public void schedule(String name, Runnable task)
    {
        logger.info("Executing scheduled task inline: " + name);
        task.run();
    }
}
