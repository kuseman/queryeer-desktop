package com.queryeer.backend.transport.stdio;

import com.queryeer.backend.contract.BackendEnvelope;

interface NotificationHandler
{
    String method();

    void handle(BackendEnvelope envelope);
}
