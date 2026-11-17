package com.queryeer.backend.core;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.CsvSource;

class SemVerTest
{
    @ParameterizedTest(
            name = "{0} satisfies {1}")
    @CsvSource(
            delimiterString = " | ",
            value = { //
                    "1.2.3        | 1.2.3", //
                    "1.2.3        | =1.2.3", //
                    "1.2.3        | v1.2.3", //
                    "1.2.3        | ^1.2.0", //
                    "1.9.9        | ^1.2.0", //
                    "0.20.5       | ^0.20.0", //
                    "0.0.3        | ^0.0.3", //
                    "1.2.9        | ~1.2.3", //
                    "1.5.0        | ~1", //
                    "1.2.3        | >=1.2.3", //
                    "1.2.4        | >1.2.3", //
                    "1.2.2        | <1.2.3", //
                    "1.2.3        | <=1.2.3", //
                    "1.2.9        | <=1.2", //
                    "1.2.9        | 1.2", //
                    "1.2.9        | 1.2.x", //
                    "1.9.0        | 1.x", //
                    "7.0.0        | *", //
                    "1.5.0        | >=1.2.3 <2.0.0", //
                    "1.5.0        | >= 1.2.3 < 2", //
                    "3.1.0        | ^1.0.0 || ^3.0.0", //
                    "1.5.0        | 1.2.3 - 2.0.0", //
                    "2.0.9        | 1.2.3 - 2.0", //
                    "1.2.4-beta.2 | ^1.2.4-beta.1", //
                    "1.2.4-beta.2 | >=1.2.4-alpha", //
                    "0.20.0-SNAPSHOT | ^0.20.0", //
                    "0.20.0-SNAPSHOT | >=0.20.0", //
                    "1.2.3+build.5 | 1.2.3", //
                    "0.20.0-SNAPSHOT | 0.20.0-SNAPSHOT", //
                    "0.20.0       | <=0.20.0-SNAPSHOT", //
                    "1.0.0        | ~*", //
                    "9.9.9        | ~x", //
                    "1.2.5        | ~>1.2.3", //
                    "1.2.5        | ~> 1.2.3" })
    void satisfies(String version, String range)
    {
        assertTrue(SemVer.satisfies(version, range));
    }

    @ParameterizedTest(
            name = "{0} does not satisfy {1}")
    @CsvSource(
            delimiterString = " | ",
            value = { //
                    "1.2.4        | 1.2.3", //
                    "2.0.0        | ^1.2.0", //
                    "1.1.9        | ^1.2.0", //
                    "0.21.0       | ^0.20.0", //
                    "0.19.9       | ^0.20.0", //
                    "0.0.4        | ^0.0.3", //
                    "1.3.0        | ~1.2.3", //
                    "1.2.3        | >1.2.3", //
                    "1.2.3        | <1.2.3", //
                    "1.3.0        | <=1.2", //
                    "2.0.0        | 1.x", //
                    "2.0.0        | >=1.2.3 <2.0.0", //
                    "2.5.0        | ^1.0.0 || ^3.0.0", //
                    "2.0.1        | 1.2.3 - 2.0.0", //
                    "2.1.0        | 1.2.3 - 2.0", //
                    "1.2.0-beta.1 | ^1.0.0", //
                    "1.2.4-beta.1 | ^1.2.4-beta.2", //
                    "1.2.5-beta.1 | ^1.2.4-beta.1", //
                    "1.2.0-beta.1 | *", //
                    "0.20.0-rc.1  | ^0.20.0", //
                    "0.21.0-SNAPSHOT | ^0.20.0", //
                    "1.2.0-beta   | >=1.2.0-alpha <1.2", //
                    "1.2.0        | <1.2", //
                    "0.0.0        | <*", //
                    "1.3.0        | ~>1.2.3" })
    void doesNotSatisfy(String version, String range)
    {
        assertFalse(SemVer.satisfies(version, range));
    }

    @ParameterizedTest(
            name = "invalid range ''{0}''")
    @CsvSource(
            delimiterString = " | ",
            value = { "''", "abc", "^1.x.3", ">=1.2.3 ||", "1.2.3 - 2.0.0 - 3.0.0", "^1.2-beta", ">>1.2.3", ">2147483647", "^99999999999.0.0", "1.2.3-a..b" })
    void rejectsInvalidRange(String range)
    {
        assertThrows(IllegalArgumentException.class, () -> SemVer.validateRange(range));
    }

    @Test
    void rejectsInvalidVersion()
    {
        assertThrows(IllegalArgumentException.class, () -> SemVer.parseVersion("1.2"));
        assertThrows(IllegalArgumentException.class, () -> SemVer.parseVersion("01.2.3"));
        assertThrows(IllegalArgumentException.class, () -> SemVer.satisfies("latest", "^1.0.0"));
        assertThrows(IllegalArgumentException.class, () -> SemVer.parseVersion("1.2.3-a..b"));
        assertThrows(IllegalArgumentException.class, () -> SemVer.parseVersion("1.2.3-"));
        assertThrows(IllegalArgumentException.class, () -> SemVer.parseVersion("2147483647.0.0"));
    }

    @Test
    void comparesLongNumericPrereleases()
    {
        assertTrue(SemVer.parseVersion("1.0.0-99999999999999999999")
                .compareTo(SemVer.parseVersion("1.0.0-100000000000000000000")) < 0);
        assertTrue(SemVer.satisfies("1.0.0-100000000000000000000", ">1.0.0-99999999999999999999"));
    }

    @Test
    void ordersPrereleases()
    {
        String[] ordered = { "1.0.0-alpha", "1.0.0-alpha.1", "1.0.0-alpha.beta", "1.0.0-beta", "1.0.0-beta.2", "1.0.0-beta.11", "1.0.0-rc.1", "1.0.0" };
        for (int i = 1; i < ordered.length; i++)
        {
            assertTrue(SemVer.parseVersion(ordered[i - 1])
                    .compareTo(SemVer.parseVersion(ordered[i])) < 0, ordered[i - 1] + " < " + ordered[i]);
        }
        assertEquals("1.0.0-beta.2", SemVer.parseVersion("v1.0.0-beta.2+build")
                .toString());
    }
}
