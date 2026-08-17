package com.queryeer.backend.runner;

import java.io.IOException;
import java.math.BigInteger;
import java.net.URL;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.Collections;
import java.util.HashMap;
import java.util.HashSet;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Set;
import java.util.jar.JarFile;
import java.util.regex.Matcher;
import java.util.regex.Pattern;
import java.util.stream.Stream;

/**
 * Scans {@code <appDir>/libShared} for JAR files and collects their URLs. The caller is expected to build the classloader hierarchy so that these shared URLs sit above the classloader that defines
 * plugin classes — this ensures {@link java.sql.DriverManager#isDriverAllowed} can reach drivers found in {@code libShared} through parent-delegation.
 *
 * <p>
 * Drop {@code mssql-jdbc-*.jar} (or any other JDBC driver) into {@code libShared} to make it available to all dialect plugins without bundling it in the distribution.
 * </p>
 */
final class SharedLibraryLoader
{
    private static final String MANAGED_PREFIX = "000-queryeer-managed-";
    private static final List<String> KNOWN_JDBC_DRIVERS = List.of("org/postgresql/Driver.class", "com/microsoft/sqlserver/jdbc/SQLServerDriver.class", "org/sqlite/JDBC.class");
    private static final Pattern VERSION_PART = Pattern.compile("\\d+|\\D+");

    static List<URL> collect(String appDir)
    {
        if (appDir == null
                || appDir.isBlank())
        {
            return List.of();
        }
        Path libDir = Path.of(appDir.trim(), "libShared");
        if (!Files.isDirectory(libDir))
        {
            return List.of();
        }
        List<Path> paths;
        try (Stream<Path> stream = Files.list(libDir))
        {
            paths = stream.filter(p -> p.getFileName()
                    .toString()
                    .toLowerCase(Locale.ROOT)
                    .endsWith(".jar"))
                    .sorted()
                    .toList();
        }
        catch (IOException e)
        {
            return List.of();
        }
        Set<Path> providerJars = new HashSet<>();
        Map<String, List<Path>> providerCandidates = new HashMap<>();
        for (Path path : paths)
        {
            List<String> drivers = knownDrivers(path);
            if (drivers == null
                    || drivers.size() > 1)
            {
                providerJars.add(path);
                continue;
            }
            for (String driver : drivers)
            {
                providerJars.add(path);
                providerCandidates.computeIfAbsent(driver, ignored -> new ArrayList<>())
                        .add(path);
            }
        }
        Set<Path> selectedJars = new HashSet<>();
        for (List<Path> candidates : providerCandidates.values())
        {
            Path selected = selectProvider(candidates);
            if (selected != null)
            {
                selectedJars.add(selected);
            }
        }
        List<URL> urls = new ArrayList<>();
        for (Path path : paths)
        {
            if (providerJars.contains(path)
                    && !selectedJars.contains(path))
            {
                continue;
            }
            try
            {
                urls.add(path.toUri()
                        .toURL());
            }
            catch (Exception e)
            {
                throw new RuntimeException("Cannot convert path to URL: " + path, e);
            }
        }
        return Collections.unmodifiableList(urls);
    }

    private static List<String> knownDrivers(Path path)
    {
        try (JarFile jar = new JarFile(path.toFile()))
        {
            return KNOWN_JDBC_DRIVERS.stream()
                    .filter(driver -> jar.getJarEntry(driver) != null)
                    .toList();
        }
        catch (IOException e)
        {
            return null;
        }
    }

    private static Path selectProvider(List<Path> candidates)
    {
        List<Path> managed = candidates.stream()
                .filter(SharedLibraryLoader::isManaged)
                .toList();
        List<Path> eligible = managed.isEmpty() ? candidates
                : managed;
        if (eligible.size() == 1)
        {
            return eligible.get(0);
        }
        if (eligible.stream()
                .map(SharedLibraryLoader::implementationVersion)
                .anyMatch(version -> version == null
                        || version.isBlank()))
        {
            return null;
        }
        List<Path> ordered = eligible.stream()
                .sorted((left, right) -> compareVersions(implementationVersion(right), implementationVersion(left)))
                .toList();
        return compareVersions(implementationVersion(ordered.get(0)), implementationVersion(ordered.get(1))) == 0 ? null
                : ordered.get(0);
    }

    private static boolean isManaged(Path path)
    {
        return path.getFileName()
                .toString()
                .toLowerCase(Locale.ROOT)
                .startsWith(MANAGED_PREFIX);
    }

    private static String implementationVersion(Path path)
    {
        try (JarFile jar = new JarFile(path.toFile()))
        {
            return jar.getManifest() == null ? ""
                    : jar.getManifest()
                            .getMainAttributes()
                            .getValue("Implementation-Version");
        }
        catch (IOException e)
        {
            return "";
        }
    }

    private static int compareVersions(String left, String right)
    {
        if (left == null
                || left.isBlank())
        {
            return right == null
                    || right.isBlank() ? 0
                            : -1;
        }
        if (right == null
                || right.isBlank())
        {
            return 1;
        }
        Matcher leftMatcher = VERSION_PART.matcher(left);
        Matcher rightMatcher = VERSION_PART.matcher(right);
        while (leftMatcher.find()
                && rightMatcher.find())
        {
            String leftPart = leftMatcher.group();
            String rightPart = rightMatcher.group();
            int comparison = Character.isDigit(leftPart.charAt(0))
                    && Character.isDigit(rightPart.charAt(0)) ? new BigInteger(leftPart).compareTo(new BigInteger(rightPart))
                            : leftPart.compareToIgnoreCase(rightPart);
            if (comparison != 0)
            {
                return comparison;
            }
        }
        return left.compareToIgnoreCase(right);
    }

    private SharedLibraryLoader()
    {
    }
}
