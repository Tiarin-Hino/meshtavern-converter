#!/bin/sh
# Runs inside the test container (docker/test.Dockerfile). stdin is the NUL-separated list of the
# working tree's files, relative to /src (the repo, mounted read-only). They are copied next to the
# baked node_modules in /app, the command runs there, and what it wrote for people to look at is
# copied to /out (the repo's out/docker-test/). The container is removed afterwards.
set -u

tar -C /src --null -T - -cf - | tar -C /app -xf -

"$@"
status=$?

for dir in test-results playwright-report; do
  if [ -d "/app/$dir" ]; then cp -r "/app/$dir" "/out/$dir"; fi
done
exit "$status"
