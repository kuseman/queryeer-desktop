package com.queryeer.backend.core;

import java.util.ArrayList;
import java.util.List;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/**
 * SemVer versions and npm-style ranges, for plugin dependency checks.
 *
 * <p>
 * Ranges: comparators {@code =}, {@code >}, {@code >=}, {@code <}, {@code <=}, caret {@code ^1.2.3}, tilde {@code ~1.2.3}, wildcards {@code 1.x} / {@code 1.2.*} / {@code *}, partial versions
 * {@code 1.2}, hyphen ranges {@code 1.2.3 - 2.0.0}, comparators joined by spaces (and) and sets joined by {@code ||} (or).
 * </p>
 *
 * <p>
 * Prereleases follow npm: {@code 1.2.0-beta.1} satisfies a range only when one of its comparators names a prerelease of the same {@code major.minor.patch}. One exception: {@code -SNAPSHOT}, Maven's
 * development marker, counts as the release it becomes, so a development build of 0.20.0 satisfies {@code ^0.20.0}.
 * </p>
 */
public final class SemVer
{
    /** Dot-separated, non-empty identifiers, for prereleases and build metadata. */
    private static final String IDENTIFIERS = "[0-9A-Za-z-]+(?:\\.[0-9A-Za-z-]+)*";
    private static final Pattern VERSION = Pattern.compile("^v?(0|[1-9]\\d*)\\.(0|[1-9]\\d*)\\.(0|[1-9]\\d*)(?:-(" + IDENTIFIERS + "))?(?:\\+" + IDENTIFIERS + ")?$");
    private static final Pattern PARTIAL = Pattern.compile("^v?(\\d+|[xX*])(?:\\.(\\d+|[xX*]))?(?:\\.(\\d+|[xX*]))?(?:-(" + IDENTIFIERS + "))?(?:\\+" + IDENTIFIERS + ")?$");
    /** {@code ~>} is npm's alias for {@code ~}. */
    private static final Pattern COMPARATOR = Pattern.compile("^(<=|>=|<|>|=|\\^|~>|~)?\\s*(.+)$");
    private static final String SNAPSHOT = "SNAPSHOT";
    /** The largest version part: one below Integer.MAX_VALUE, so the next version up still fits. */
    private static final int MAX_PART = Integer.MAX_VALUE - 1;

    private SemVer()
    {
    }

    /** A parsed version. */
    public record Version(int major, int minor, int patch, List<String> prerelease) implements Comparable<Version>
    {
        public Version
        {
            prerelease = List.copyOf(prerelease);
        }

        boolean isPrerelease()
        {
            return !prerelease.isEmpty();
        }

        boolean sameTuple(Version other)
        {
            return major == other.major
                    && minor == other.minor
                    && patch == other.patch;
        }

        @Override
        public int compareTo(Version other)
        {
            int result = Integer.compare(major, other.major);
            if (result == 0)
            {
                result = Integer.compare(minor, other.minor);
            }
            if (result == 0)
            {
                result = Integer.compare(patch, other.patch);
            }
            if (result != 0)
            {
                return result;
            }
            // A release is greater than its prereleases
            if (prerelease.isEmpty()
                    || other.prerelease.isEmpty())
            {
                return Boolean.compare(prerelease.isEmpty(), other.prerelease.isEmpty());
            }
            for (int i = 0; i < Math.min(prerelease.size(), other.prerelease.size()); i++)
            {
                result = compareIdentifier(prerelease.get(i), other.prerelease.get(i));
                if (result != 0)
                {
                    return result;
                }
            }
            return Integer.compare(prerelease.size(), other.prerelease.size());
        }

        private static int compareIdentifier(String a, String b)
        {
            boolean aNumeric = a.chars()
                    .allMatch(Character::isDigit);
            boolean bNumeric = b.chars()
                    .allMatch(Character::isDigit);
            if (aNumeric
                    && bNumeric)
            {
                // By length, then by digits: no overflow for long identifiers
                String aDigits = a.replaceFirst("^0+(?=.)", "");
                String bDigits = b.replaceFirst("^0+(?=.)", "");
                return aDigits.length() != bDigits.length() ? Integer.compare(aDigits.length(), bDigits.length())
                        : aDigits.compareTo(bDigits);
            }
            if (aNumeric != bNumeric)
            {
                // Numeric identifiers sort before alphanumeric ones
                return aNumeric ? -1
                        : 1;
            }
            return a.compareTo(b);
        }

        @Override
        public String toString()
        {
            return major + "."
                   + minor
                   + "."
                   + patch
                   + (prerelease.isEmpty() ? ""
                           : "-" + String.join(".", prerelease));
        }
    }

    /**
     * Parses a full version ({@code 1.2.3}, {@code 1.2.3-beta.1}, build metadata ignored).
     *
     * @throws IllegalArgumentException when the text is not a version
     */
    public static Version parseVersion(String text)
    {
        Matcher matcher = text == null ? null
                : VERSION.matcher(text.strip());
        if (matcher == null
                || !matcher.matches())
        {
            throw new IllegalArgumentException("Not a SemVer version: '" + text + "'");
        }
        return new Version(part(matcher.group(1), text), part(matcher.group(2), text), part(matcher.group(3), text), identifiers(matcher.group(4)));
    }

    private static int part(String digits, String text)
    {
        long value;
        try
        {
            value = Long.parseLong(digits);
        }
        catch (NumberFormatException e)
        {
            value = Long.MAX_VALUE;
        }
        if (value > MAX_PART)
        {
            throw new IllegalArgumentException("Version number too large in '" + text + "'");
        }
        return (int) value;
    }

    /**
     * Checks a range's syntax.
     *
     * @throws IllegalArgumentException with the reason when the range is not valid
     */
    public static void validateRange(String range)
    {
        parseRange(range);
    }

    /**
     * Whether a version satisfies a range.
     *
     * @throws IllegalArgumentException when the version or the range is not valid
     */
    public static boolean satisfies(String version, String range)
    {
        Version parsed = parseVersion(version);
        parsed = new Version(parsed.major(), parsed.minor(), parsed.patch(), withoutSnapshot(parsed.prerelease()));
        for (List<Comparator> set : parseRange(range))
        {
            if (satisfiesSet(parsed, set))
            {
                return true;
            }
        }
        return false;
    }

    private static boolean satisfiesSet(Version version, List<Comparator> set)
    {
        for (Comparator comparator : set)
        {
            if (!comparator.test(version))
            {
                return false;
            }
        }
        if (!version.isPrerelease())
        {
            return true;
        }
        for (Comparator comparator : set)
        {
            if (comparator.version.isPrerelease()
                    && comparator.version.sameTuple(version))
            {
                return true;
            }
        }
        return false;
    }

    private enum Operator
    {
        EQ,
        GT,
        GTE,
        LT,
        LTE
    }

    private record Comparator(Operator operator, Version version)
    {
        boolean test(Version candidate)
        {
            int result = candidate.compareTo(version);
            return switch (operator)
            {
                case EQ -> result == 0;
                case GT -> result > 0;
                case GTE -> result >= 0;
                case LT -> result < 0;
                case LTE -> result <= 0;
            };
        }
    }

    /** A partial version from a range: missing or wildcard parts are null. */
    private record Partial(Integer major, Integer minor, Integer patch, List<String> prerelease)
    {
        Version floor()
        {
            return new Version(orZero(major), orZero(minor), orZero(patch), prerelease);
        }

        private static int orZero(Integer value)
        {
            return value == null ? 0
                    : value;
        }
    }

    private static List<List<Comparator>> parseRange(String range)
    {
        if (range == null
                || range.isBlank())
        {
            throw new IllegalArgumentException("Version range is empty");
        }
        List<List<Comparator>> sets = new ArrayList<>();
        for (String setText : range.split("\\|\\|", -1))
        {
            sets.add(parseSet(setText.strip(), range));
        }
        return sets;
    }

    private static List<Comparator> parseSet(String set, String range)
    {
        if (set.isEmpty())
        {
            throw new IllegalArgumentException("Empty set in version range '" + range + "'");
        }
        List<Comparator> comparators = new ArrayList<>();
        String[] hyphen = set.split("\\s+-\\s+");
        if (hyphen.length == 2)
        {
            Partial from = parsePartial(hyphen[0], range);
            Partial to = parsePartial(hyphen[1], range);
            comparators.add(new Comparator(Operator.GTE, from.floor()));
            comparators.addAll(upperBound(to, true));
            return comparators;
        }
        if (hyphen.length > 2)
        {
            throw new IllegalArgumentException("Invalid hyphen range in '" + range + "'");
        }
        // Allow a space between an operator and its version: ">= 1.2.3"
        String[] tokens = set.replaceAll("(<=|>=|<|>|=|\\^|~>|~)\\s+", "$1")
                .split("\\s+");
        for (String token : tokens)
        {
            comparators.addAll(parseComparator(token, range));
        }
        return comparators;
    }

    private static List<Comparator> parseComparator(String token, String range)
    {
        Matcher matcher = COMPARATOR.matcher(token);
        if (!matcher.matches())
        {
            throw new IllegalArgumentException("Invalid comparator '" + token + "' in version range '" + range + "'");
        }
        String operator = matcher.group(1) == null ? ""
                : matcher.group(1);
        Partial partial = parsePartial(matcher.group(2), range);
        Version floor = partial.floor();
        List<Comparator> result = new ArrayList<>();
        switch (operator)
        {
            case "^" -> {
                result.add(new Comparator(Operator.GTE, floor));
                result.add(new Comparator(Operator.LT, caretCeiling(partial)));
            }
            case "~", "~>" -> {
                result.add(new Comparator(Operator.GTE, floor));
                if (partial.major() != null)
                {
                    // "~*" is any version, like "*"
                    result.add(new Comparator(Operator.LT, partial.minor() == null ? new Version(floor.major() + 1, 0, 0, List.of("0"))
                            : new Version(floor.major(), floor.minor() + 1, 0, List.of("0"))));
                }
            }
            case ">" -> {
                if (partial.major() == null)
                {
                    // ">*" matches nothing
                    result.add(new Comparator(Operator.LT, new Version(0, 0, 0, List.of("0"))));
                }
                else if (partial.minor() == null)
                {
                    result.add(new Comparator(Operator.GTE, new Version(partial.major() + 1, 0, 0, List.of())));
                }
                else if (partial.patch() == null)
                {
                    result.add(new Comparator(Operator.GTE, new Version(partial.major(), partial.minor() + 1, 0, List.of())));
                }
                else
                {
                    result.add(new Comparator(Operator.GT, floor));
                }
            }
            case ">=" -> result.add(new Comparator(Operator.GTE, floor));
            // "<1.2" is "<1.2.0-0", so no prerelease of 1.2.0 slips through; "<*" matches nothing
            case "<" -> result.add(new Comparator(Operator.LT, partial.patch() == null ? new Version(floor.major(), floor.minor(), 0, List.of("0"))
                    : floor));
            case "<=" -> result.addAll(upperBound(partial, true));
            default -> {
                // "=" or none: an exact version, or a range for a partial one
                if (partial.major() == null)
                {
                    result.add(new Comparator(Operator.GTE, new Version(0, 0, 0, List.of())));
                }
                else if (partial.patch() == null)
                {
                    result.add(new Comparator(Operator.GTE, floor));
                    result.addAll(upperBound(partial, false));
                }
                else
                {
                    result.add(new Comparator(Operator.EQ, floor));
                }
            }
        }
        return result;
    }

    /** {@code <=} a partial version: below the next version up for its missing parts. With {@code inclusive} false, a partial is treated as a wildcard. */
    private static List<Comparator> upperBound(Partial partial, boolean inclusive)
    {
        if (partial.major() == null)
        {
            return List.of();
        }
        if (partial.minor() == null)
        {
            return List.of(new Comparator(Operator.LT, new Version(partial.major() + 1, 0, 0, List.of("0"))));
        }
        if (partial.patch() == null)
        {
            return List.of(new Comparator(Operator.LT, new Version(partial.major(), partial.minor() + 1, 0, List.of("0"))));
        }
        return List.of(new Comparator(inclusive ? Operator.LTE
                : Operator.LT, partial.floor()));
    }

    /** {@code ^}: changes that do not modify the left-most non-zero part. */
    private static Version caretCeiling(Partial partial)
    {
        List<String> lowest = List.of("0");
        if (partial.major() == null)
        {
            return new Version(Integer.MAX_VALUE, 0, 0, lowest);
        }
        if (partial.major() > 0
                || partial.minor() == null)
        {
            return new Version(partial.major() + 1, 0, 0, lowest);
        }
        if (partial.minor() > 0
                || partial.patch() == null)
        {
            return new Version(0, partial.minor() + 1, 0, lowest);
        }
        return new Version(0, 0, partial.patch() + 1, lowest);
    }

    private static Partial parsePartial(String text, String range)
    {
        Matcher matcher = PARTIAL.matcher(text.strip());
        if (!matcher.matches())
        {
            throw new IllegalArgumentException("Invalid version '" + text + "' in version range '" + range + "'");
        }
        Integer major = number(matcher.group(1));
        Integer minor = number(matcher.group(2));
        Integer patch = number(matcher.group(3));
        if ((major == null
                && minor != null)
                || (minor == null
                        && patch != null))
        {
            throw new IllegalArgumentException("Invalid version '" + text + "' in version range '" + range + "'");
        }
        List<String> prerelease = withoutSnapshot(identifiers(matcher.group(4)));
        if (!prerelease.isEmpty()
                && patch == null)
        {
            throw new IllegalArgumentException("A prerelease needs a full version: '" + text + "' in version range '" + range + "'");
        }
        return new Partial(major, minor, patch, prerelease);
    }

    private static Integer number(String part)
    {
        if (part == null
                || part.equalsIgnoreCase("x")
                || part.equals("*"))
        {
            return null;
        }
        return part(part, part);
    }

    /**
     * Whether the version is a development build: it ends with Maven's {@code -SNAPSHOT} (any case, build metadata ignored), which a released Queryeer never reports for itself. Doesn't check that the
     * rest is a valid version.
     */
    public static boolean isDevelopmentBuild(String version)
    {
        if (version == null)
        {
            return false;
        }
        String withoutBuild = version.strip()
                .split("\\+", 2)[0];
        return withoutBuild.regionMatches(true, withoutBuild.length() - SNAPSHOT.length() - 1, "-" + SNAPSHOT, 0, SNAPSHOT.length() + 1);
    }

    /** Maven's {@code -SNAPSHOT} development marker counts as the release it becomes, in versions and in ranges alike. */
    private static List<String> withoutSnapshot(List<String> prerelease)
    {
        return prerelease.size() == 1
                && SNAPSHOT.equalsIgnoreCase(prerelease.get(0)) ? List.of()
                        : prerelease;
    }

    private static List<String> identifiers(String prerelease)
    {
        return prerelease == null ? List.of()
                : List.of(prerelease.split("\\."));
    }
}
