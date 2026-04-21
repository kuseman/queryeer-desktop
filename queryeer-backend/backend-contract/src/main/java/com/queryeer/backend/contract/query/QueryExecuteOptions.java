package com.queryeer.backend.contract.query;

public record QueryExecuteOptions(Integer maxRows, Integer timeoutMs)
{
}
