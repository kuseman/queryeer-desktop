#!/usr/bin/env python3

import os
import sys
import urllib.error
import urllib.request
import xml.etree.ElementTree as ET
from pathlib import Path


NAMESPACE = {"m": "http://maven.apache.org/POM/4.0.0"}
REPOSITORY_ROOT = Path(os.environ.get("QUERYEER_REPOSITORY_ROOT", Path(__file__).resolve().parents[2]))


def published_artifacts():
    backend_root = REPOSITORY_ROOT / "queryeer-backend"
    root = ET.parse(backend_root / "pom.xml").getroot()
    yield root.findtext("m:artifactId", namespaces=NAMESPACE)
    for module in root.findall("m:modules/m:module", NAMESPACE):
        module_root = ET.parse(backend_root / module.text / "pom.xml").getroot()
        skip_publishing = module_root.findtext("m:properties/m:skipPublishing", namespaces=NAMESPACE)
        skip_deploy = module_root.findtext("m:properties/m:maven.deploy.skip", namespaces=NAMESPACE)
        if skip_publishing == "true" or skip_deploy == "true":
            continue
        yield module_root.findtext("m:artifactId", namespaces=NAMESPACE)


def artifact_status(base_url, artifact, version):
    url = f"{base_url}/com/queryeer/backend/{artifact}/{version}/{artifact}-{version}.pom"
    request = urllib.request.Request(url, method="HEAD")
    try:
        with urllib.request.urlopen(request, timeout=30) as response:
            return response.status
    except urllib.error.HTTPError as error:
        return error.code
    except urllib.error.URLError as error:
        raise RuntimeError(f"Could not query Maven Central for {artifact}: {error.reason}") from error


def write_output(name, value):
    output_path = os.environ.get("GITHUB_OUTPUT")
    if output_path:
        with open(output_path, "a", encoding="ascii") as output:
            output.write(f"{name}={value}\n")


def main():
    if len(sys.argv) != 2:
        raise SystemExit(f"Usage: {Path(sys.argv[0]).name} <release-version>")

    version = sys.argv[1]
    base_url = os.environ.get("MAVEN_CENTRAL_BASE_URL", "https://repo1.maven.org/maven2").rstrip("/")
    artifacts = list(published_artifacts())
    published = []
    missing = []
    for artifact in artifacts:
        status = artifact_status(base_url, artifact, version)
        if status == 200:
            published.append(artifact)
        elif status == 404:
            missing.append(artifact)
        else:
            raise SystemExit(
                f"Maven Central returned HTTP {status} while checking {artifact}. "
                "Refusing to publish with an indeterminate release state."
            )

    if len(published) == len(artifacts):
        print(f"All {len(artifacts)} backend artifacts already exist in Maven Central.")
        write_output("state", "published")
        write_output("published", "true")
    elif len(missing) == len(artifacts):
        print("No backend artifacts exist in Maven Central.")
        write_output("state", "missing")
        write_output("published", "false")
    else:
        raise SystemExit(
            f"Maven Central contains only part of backend release {version}. "
            f"Published: {' '.join(published)}. Missing: {' '.join(missing)}. "
            "Refusing to publish immutable coordinates."
        )


if __name__ == "__main__":
    main()
