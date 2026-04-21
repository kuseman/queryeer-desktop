package com.queryeer.backend.transport.stdio;

import com.queryeer.backend.contract.BackendEnvelope;

public interface NotificationHandler
{
    String method();

    void handle(BackendEnvelope envelope);
}
