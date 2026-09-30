#!/bin/bash
# usage: tools/wait.sh job.json  -> submits and waits for the runner
cp "$1" tools/job.json; rm -f shots/done.txt
for i in $(seq 1 120); do [ -f shots/done.txt ] && break; sleep 3; done
grep -v -E "^\[chrome\]" shots/log.txt | cut -c1-${2:-400}
