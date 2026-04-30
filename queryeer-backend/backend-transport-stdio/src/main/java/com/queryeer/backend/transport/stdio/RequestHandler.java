package com.queryeer.backend.transport.stdio;

import com.queryeer.backend.contract.BackendEnvelope;

interface RequestHandler
{
    String method();

    void handle(BackendEnvelope envelope);
}
