package com.queryeer.backend.contract.handshake;

import java.util.List;

public record HandshakeParams(ClientIdentity client, List<Integer> supportedProtocolMajors, List<String> requestedCapabilities)
{
}
