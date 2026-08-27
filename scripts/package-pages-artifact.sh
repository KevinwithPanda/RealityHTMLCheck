#!/usr/bin/env bash
set -euo pipefail

if [ "$#" -ne 2 ]; then
  echo "Usage: package-pages-artifact.sh <SITE_DIRECTORY> <ARTIFACT_TAR>" >&2
  exit 2
fi

site="$1"
archive="$2"

test -d "$site" || { echo "Pages site directory is missing: $site" >&2; exit 2; }
mkdir -p "$(dirname "$archive")"
test ! -e "$archive" || { echo "Pages artifact target already exists: $archive" >&2; exit 2; }

unsafe_link="$(find -P "$site" -type l -print -quit)"
test -z "$unsafe_link" || { echo "Pages site contains a symbolic link: $unsafe_link" >&2; exit 2; }
unsafe_type="$(find -P "$site" ! -type f ! -type d -print -quit)"
test -z "$unsafe_type" || { echo "Pages site contains a non-regular entry: $unsafe_type" >&2; exit 2; }
unsafe_hardlink="$(find -P "$site" -type f -links +1 -print -quit)"
test -z "$unsafe_hardlink" || { echo "Pages site contains a hard-linked file: $unsafe_hardlink" >&2; exit 2; }
sensitive_tree="$(find -P "$site" \( -name .git -o -name .github \) -print -quit)"
test -z "$sensitive_tree" || { echo "Pages site contains a blocked repository tree: $sensitive_tree" >&2; exit 2; }

temporary="$(mktemp -d)"
cleanup_pages_artifact() {
  rm -rf -- "$temporary"
}
trap cleanup_pages_artifact EXIT

manifest="$temporary/source.sha256"
(
  cd "$site"
  find . -type f -print0 | LC_ALL=C sort -z | xargs -0 sha256sum --binary
) > "$manifest"
test -s "$manifest" || { echo "Pages site contains no files" >&2; exit 2; }

tar --directory "$site" --create --file "$archive" .
mkdir "$temporary/readback"
tar --extract --file "$archive" --directory "$temporary/readback"

readback_link="$(find -P "$temporary/readback" -type l -print -quit)"
test -z "$readback_link" || { echo "Pages artifact read-back contains a symbolic link" >&2; exit 2; }
readback_type="$(find -P "$temporary/readback" ! -type f ! -type d -print -quit)"
test -z "$readback_type" || { echo "Pages artifact read-back contains a non-regular entry" >&2; exit 2; }
(
  cd "$temporary/readback"
  find . -type f -print0 | LC_ALL=C sort -z | xargs -0 sha256sum --binary
) > "$temporary/readback.sha256"
cmp "$manifest" "$temporary/readback.sha256"

sha256sum "$archive"
