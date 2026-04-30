package com.queryeer.backend.runner;

public final class BackendRunnerApp
{
    private BackendRunnerApp()
    {
    }

    public static void main(String[] args)
    {
        try
        {
            int exitCode = new BackendRunnerModule().run(System.in, System.out);
            System.exit(exitCode);
        }
        catch (Throwable t)
        {
            System.err.println("[FATAL] Backend runner failed to start: " + t.getMessage());
            t.printStackTrace(System.err);
            System.exit(1);
        }
    }
}
