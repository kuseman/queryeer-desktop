package com.queryeer.backend.runner;

public final class BackendRunnerApp
{
    private BackendRunnerApp()
    {
    }

    public static void main(String[] args)
    {
        int exitCode = new BackendRunnerModule().run(System.in, System.out);
        System.exit(exitCode);
    }
}
