package com.queryeer.backend.contract.handshake;

import java.util.List;

public record HandshakeResult(ServerIdentity server, String selectedProtocolVersion, List<String> supportedCapabilities)
{
}
